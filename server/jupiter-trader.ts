import {
  Connection,
  Keypair,
  VersionedTransaction,
  PublicKey,
} from "@solana/web3.js";
import bs58 from "bs58";
import { TradeStore } from "./trade-store";
import { secrets } from "./secrets-loader";
import type { Position, TradeConfig } from "@shared/schema";

const HELIUS_API_KEY = secrets.HELIUS_API_KEY;
const RPC_URL = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
const JUP_QUOTE = "https://lite-api.jup.ag/swap/v1/quote";
const JUP_SWAP = "https://lite-api.jup.ag/swap/v1/swap";
const JUP_PRICE = "https://lite-api.jup.ag/price/v3";

const SOL_MINT = "So11111111111111111111111111111111111111112";
const SOL_DECIMALS = 9;

type Emitter = (event: string, data: any) => void;

interface QuoteResponse {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  priceImpactPct: string;
  routePlan: any[];
  contextSlot?: number;
}

interface CachedBalance {
  uiAmount: number;
  raw: string;
  decimals: number;
  timestamp: number;
}

export class JupiterTrader {
  private store: TradeStore;
  private emit: Emitter;
  private keypair: Keypair | null = null;
  private connection: Connection | null = null;
  private decimalsCache: Map<string, number> = new Map();
  private balanceCache: Map<string, CachedBalance> = new Map();
  private inFlight: Set<string> = new Set();
  private priceMonitorInterval: NodeJS.Timer | null = null;

  constructor(store: TradeStore, emit: Emitter) {
    this.store = store;
    this.emit = emit;
    this.initWallet();
    this.startPriceMonitor();
  }

  private initWallet() {
    const pk = secrets.TRADER_PRIVATE_KEY;
    if (!pk) {
      console.warn("⚠️ TRADER_PRIVATE_KEY tanımlı değil. Otomatik alım/satım devre dışı.");
      return;
    }
    try {
      const secret = bs58.decode(pk.trim());
      if (secret.length !== 64) {
        throw new Error(`Beklenmeyen anahtar uzunluğu: ${secret.length} (64 olmalı)`);
      }
      this.keypair = Keypair.fromSecretKey(secret);
      this.connection = new Connection(RPC_URL, "confirmed");
      console.log(`💼 Trader cüzdanı yüklendi: ${this.keypair.publicKey.toBase58()}`);
    } catch (err) {
      console.error("❌ TRADER_PRIVATE_KEY çözümlenemedi:", (err as Error).message);
    }
  }

  private startPriceMonitor() {
    // Her 0.5 saniyede open positions'ın fiyatını güncelle
    this.priceMonitorInterval = setInterval(async () => {
      await this.updateOpenPositionsPrices();
    }, 500);
  }

  private async updateOpenPositionsPrices() {
    const openPositions = this.store.getOpen();
    if (openPositions.length === 0) return;

    // Batch price fetch — tüm mint'leri bir istek'te al
    const mints = openPositions.map((p) => p.mintAddress).join(",");
    if (!mints) return;

    try {
      const url = new URL(JUP_PRICE);
      url.searchParams.set("ids", mints);

      const res = await fetch(url.toString());
      if (!res.ok) return;

      const data = (await res.json()) as { data: Record<string, { price: number }> };
      if (!data.data) return;

      const solPriceUsd = this.store.getSolPriceUsd() || 87; // Fallback fiyat

      // Her position'u güncelle
      for (const pos of openPositions) {
        const priceData = data.data[pos.mintAddress];
        if (!priceData || typeof priceData.price !== "number") continue;

        const currentPriceUsd = priceData.price;
        const buyPriceUsd = pos.buyPriceSol * solPriceUsd;

        // Unrealized P&L hesapla
        const unrealizedUsd = (currentPriceUsd - buyPriceUsd) * (pos.buyTokenAmount || 0);
        const unrealizedPnlSol = unrealizedUsd / solPriceUsd;
        const unrealizedPnlPct = buyPriceUsd > 0 ? ((currentPriceUsd - buyPriceUsd) / buyPriceUsd) * 100 : 0;

        // Position'u güncelle (database'e yazma, sadece in-memory + emit)
        const updated: Position = {
          ...pos,
          currentPriceUsd,
          unrealizedPnlSol,
          unrealizedPnlPct,
        };

        // Broadcast et — client'a gönder
        this.emit("position_update", updated);
      }
    } catch (err) {
      // Sessiz fail — price update hatası kritik değil
    }
  }

  isReady(): boolean {
    return !!(this.keypair && this.connection);
  }

  cancel(positionId: string): boolean {
    const pos = this.store.getById(positionId);
    if (!pos) return false;
    if (pos.status === "pending_buy") {
      this.inFlight.delete(`buy:${pos.mintAddress}`);
      console.log(`🛑 ALIM İPTAL EDİLDİ: ${pos.symbol} (${positionId})`);
      return true;
    }
    if (pos.status === "pending_sell") {
      this.inFlight.delete(`sell:${positionId}`);
      console.log(`🛑 SATIŞ İPTAL EDİLDİ: ${pos.symbol} (${positionId})`);
      return true;
    }
    return false;
  }

  getPublicKey(): string | undefined {
    return this.keypair?.publicKey.toBase58();
  }

  private async fetchDecimals(mint: string): Promise<number> {
    if (mint === SOL_MINT) return SOL_DECIMALS;
    const cached = this.decimalsCache.get(mint);
    if (cached !== undefined) return cached;
    if (!this.connection) throw new Error("RPC bağlantısı yok");
    const info = await this.connection.getParsedAccountInfo(new PublicKey(mint));
    const dec =
      (info.value?.data as any)?.parsed?.info?.decimals ?? 6;
    this.decimalsCache.set(mint, dec);
    return dec;
  }

  private async getTokenBalance(mint: string): Promise<{ uiAmount: number; raw: string; decimals: number } | null> {
    if (!this.keypair || !this.connection) return null;
    
    // Balance cache kontrol (2 saniye geçerliliği)
    const cached = this.balanceCache.get(mint);
    if (cached && Date.now() - cached.timestamp < 2000) {
      return { uiAmount: cached.uiAmount, raw: cached.raw, decimals: cached.decimals };
    }

    try {
      const res = await this.connection.getParsedTokenAccountsByOwner(this.keypair.publicKey, {
        mint: new PublicKey(mint),
      });
      let totalRaw = 0n;
      let decimals = 6;
      for (const acc of res.value) {
        const info = (acc.account.data as any).parsed?.info?.tokenAmount;
        if (!info) continue;
        decimals = info.decimals ?? decimals;
        totalRaw += BigInt(info.amount);
      }
      const uiAmount = Number(totalRaw) / Math.pow(10, decimals);
      
      // Cache'e kaydet
      this.balanceCache.set(mint, { uiAmount, raw: totalRaw.toString(), decimals, timestamp: Date.now() });
      
      return { uiAmount, raw: totalRaw.toString(), decimals };
    } catch (err) {
      console.error("❌ Token bakiye okunamadı:", (err as Error).message);
      return null;
    }
  }

  private async getQuote(params: {
    inputMint: string;
    outputMint: string;
    amount: string;
    slippageBps: number;
  }, opts: { retries?: number; retryDelayMs?: number } = {}): Promise<QuoteResponse> {
    // Agresif ayarlar: 2 retry, 300ms aralık
    const retries = opts.retries ?? 2;
    const retryDelayMs = opts.retryDelayMs ?? 300;
    const url = new URL(JUP_QUOTE);
    url.searchParams.set("inputMint", params.inputMint);
    url.searchParams.set("outputMint", params.outputMint);
    url.searchParams.set("amount", params.amount);
    url.searchParams.set("slippageBps", String(params.slippageBps));
    url.searchParams.set("onlyDirectRoutes", "false");
    url.searchParams.set("asLegacyTransaction", "false");
    url.searchParams.set("restrictIntermediateTokens", "true");

    let lastErr: Error | null = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await fetch(url.toString());
        const bodyText = await res.text();
        if (res.ok) {
          const json = JSON.parse(bodyText) as QuoteResponse;
          if (json && json.outAmount && BigInt(json.outAmount) > BigInt(0)) {
            return json;
          }
          lastErr = new Error(`Jupiter quote: route bulunamadı (outAmount=${json?.outAmount})`);
        } else {
          lastErr = new Error(`Jupiter quote ${res.status}: ${bodyText.slice(0, 200)}`);
        }
      } catch (err) {
        lastErr = err as Error;
      }
      if (attempt < retries) {
        console.warn(`⏳ Quote denemesi ${attempt + 1}/${retries + 1} başarısız (${lastErr?.message?.slice(0, 100)}) — ${retryDelayMs}ms bekleniyor...`);
        await new Promise((r) => setTimeout(r, retryDelayMs));
      }
    }
    throw lastErr ?? new Error("Jupiter quote alınamadı");
  }

  private async swap(quote: QuoteResponse, priorityFeeMicroLamports: number): Promise<string> {
    if (!this.keypair || !this.connection) throw new Error("Cüzdan/RPC hazır değil");

    const swapBody = {
      quoteResponse: quote,
      userPublicKey: this.keypair.publicKey.toBase58(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: {
        priorityLevelWithMaxLamports: {
          maxLamports: Math.max(priorityFeeMicroLamports, 1),
          priorityLevel: "veryHigh",
        },
      },
    };

    const swapRes = await fetch(JUP_SWAP, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(swapBody),
    });
    if (!swapRes.ok) {
      const text = await swapRes.text().catch(() => "");
      throw new Error(`Jupiter swap ${swapRes.status}: ${text.slice(0, 200)}`);
    }
    const swapJson = (await swapRes.json()) as { swapTransaction: string };
    if (!swapJson.swapTransaction) throw new Error("swapTransaction alınamadı");

    const txBuf = Buffer.from(swapJson.swapTransaction, "base64");
    const tx = VersionedTransaction.deserialize(txBuf);
    tx.sign([this.keypair]);

    const raw = tx.serialize();
    const signature = await this.connection.sendRawTransaction(raw, {
      skipPreflight: true,
      maxRetries: 3,
    });

    const latest = await this.connection.getLatestBlockhash("confirmed");
    const conf = await this.connection.confirmTransaction(
      {
        signature,
        blockhash: latest.blockhash,
        lastValidBlockHeight: latest.lastValidBlockHeight,
      },
      "confirmed",
    );
    if (conf.value.err) {
      throw new Error(`İşlem hata ile sonuçlandı: ${JSON.stringify(conf.value.err)}`);
    }
    return signature;
  }

  private updateAndEmit(position: Position) {
    this.store.upsert(position);
    this.emit("position_update", position);
  }

  async buy(input: { mintAddress: string; name: string; symbol: string }): Promise<Position | null> {
    const { mintAddress, name, symbol } = input;
    if (!this.isReady()) {
      console.error("❌ Cüzdan hazır değil — alım atlandı");
      return null;
    }
    if (this.inFlight.has(`buy:${mintAddress}`)) {
      console.warn(`⏳ ${symbol} için alım zaten devam ediyor — atlandı`);
      return null;
    }
    const existing = this.store.getByMint(mintAddress);
    if (existing && (existing.status === "open" || existing.status === "pending_buy" || existing.status === "pending_sell")) {
      console.warn(`⚠️ ${symbol} zaten portföyde (${existing.status}) — alım atlandı`);
      return existing;
    }

    this.inFlight.add(`buy:${mintAddress}`);
    const config = this.store.getConfig();
    const lamports = Math.floor(config.solAmount * 1e9);
    const id = `pos-${mintAddress}-${Date.now()}`;
    let position: Position = {
      id,
      mintAddress,
      name,
      symbol,
      status: "pending_buy",
      buyTimestamp: Date.now(),
      buySolAmount: config.solAmount,
    };
    this.updateAndEmit(position);
    console.log(`🛒 ALIM başlıyor: ${symbol} (${mintAddress}) — ${config.solAmount} SOL`);

    try {
      const quote = await this.getQuote({
        inputMint: SOL_MINT,
        outputMint: mintAddress,
        amount: String(lamports),
        slippageBps: config.slippageBps,
      }, { retries: 2, retryDelayMs: 300 });
      const decimals = await this.fetchDecimals(mintAddress);
      const tokensOut = Number(quote.outAmount) / Math.pow(10, decimals);
      const pricePerToken = tokensOut > 0 ? config.solAmount / tokensOut : 0;

      // 2x priority fee — daha hızlı execution
      const sig = await this.swap(quote, config.priorityFeeMicroLamports * 2);

      position = {
        ...position,
        status: "open",
        buyTokenAmount: tokensOut,
        buyPriceSol: pricePerToken,
        buyTxSignature: sig,
      };
      this.updateAndEmit(position);
      console.log(`✅ ALIM tamam: ${symbol} | ${tokensOut.toFixed(4)} ${symbol} | tx ${sig.slice(0, 16)}...`);
      return position;
    } catch (err) {
      const message = (err as Error).message || String(err);
      position = { ...position, status: "failed", error: message };
      this.updateAndEmit(position);
      console.error(`❌ ALIM hatası ${symbol}:`, message);
      return position;
    } finally {
      this.inFlight.delete(`buy:${mintAddress}`);
    }
  }

  async sell(positionId: string): Promise<Position | null> {
    const pos = this.store.getById(positionId);
    if (!pos) {
      console.warn(`⚠️ Pozisyon bulunamadı: ${positionId}`);
      return null;
    }
    if (pos.status !== "open") {
      console.warn(`⚠️ Pozisyon satışa uygun değil (${pos.status}): ${pos.symbol}`);
      return pos;
    }
    if (!this.isReady()) {
      console.error("❌ Cüzdan hazır değil — satış atlandı");
      return null;
    }
    if (this.inFlight.has(`sell:${pos.id}`)) return pos;
    this.inFlight.add(`sell:${pos.id}`);

    const config = this.store.getConfig();
    let updated: Position = { ...pos, status: "pending_sell" };
    this.updateAndEmit(updated);
    console.log(`💸 SATIŞ başlıyor: ${pos.symbol} (${pos.mintAddress})`);

    try {
      // Token balance — retry ile (eğer henüz account'a oturmamışsa)
      let balance = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        balance = await this.getTokenBalance(pos.mintAddress);
        if (balance && BigInt(balance.raw) > 0n) break;
        if (attempt < 2) {
          console.warn(`⏳ Token balance deneme ${attempt + 1}/3 — 300ms bekleniyor...`);
          await new Promise((r) => setTimeout(r, 300));
        }
      }

      if (!balance || BigInt(balance.raw) === 0n) {
        throw new Error("Cüzdanda token bakiyesi bulunamadı");
      }

      // Agresif quote settings
      const quote = await this.getQuote({
        inputMint: pos.mintAddress,
        outputMint: SOL_MINT,
        amount: balance.raw,
        slippageBps: config.slippageBps,
      }, { retries: 2, retryDelayMs: 300 });
      const solOut = Number(quote.outAmount) / 1e9;
      const sellPricePerToken = balance.uiAmount > 0 ? solOut / balance.uiAmount : 0;

      // 2x priority fee — daha hızlı execution
      const sig = await this.swap(quote, config.priorityFeeMicroLamports * 2);

      const pnlSol = solOut - pos.buySolAmount;
      const pnlPct = pos.buySolAmount > 0 ? (pnlSol / pos.buySolAmount) * 100 : 0;

      updated = {
        ...updated,
        status: "closed",
        sellTimestamp: Date.now(),
        sellSolAmount: solOut,
        sellPriceSol: sellPricePerToken,
        sellTxSignature: sig,
        pnlSol,
        pnlPct,
      };
      this.updateAndEmit(updated);
      console.log(`✅ SATIŞ tamam: ${pos.symbol} | ${solOut.toFixed(4)} SOL | PnL ${pnlSol >= 0 ? "+" : ""}${pnlSol.toFixed(4)} SOL (${pnlPct.toFixed(1)}%)`);
      return updated;
    } catch (err) {
      const message = (err as Error).message || String(err);
      updated = { ...pos, status: "open", error: message };
      this.updateAndEmit(updated);
      console.error(`❌ SATIŞ hatası ${pos.symbol}:`, message);
      return updated;
    } finally {
      this.inFlight.delete(`sell:${pos.id}`);
    }
  }

  updateConfig(partial: Partial<TradeConfig>): TradeConfig {
    const cfg = this.store.updateConfig(partial);
    this.emit("trade_config_update", cfg);
    return cfg;
  }

  destroy() {
    if (this.priceMonitorInterval) {
      clearInterval(this.priceMonitorInterval);
      this.priceMonitorInterval = null;
    }
  }
}
