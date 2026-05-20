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
    
    // Balance cache kontrol (3 saniye geçerliliği — satış için çok hızlı)
    const cached = this.balanceCache.get(mint);
    if (cached && Date.now() - cached.timestamp < 3000) {
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
        console.warn(`⏳ Quote denemesi ${attempt + 1}/${retries + 1} başarısız — ${retryDelayMs}ms bekleniyor...`);
        await new Promise((r) => setTimeout(r, retryDelayMs));
      }
    }
    throw lastErr ?? new Error("Jupiter quote alınamadı");
  }

  private async swap(quote: QuoteResponse, priorityFeeMicroLamports: number): Promise<string> {
    if (!this.keypair || !this.connection) throw new Error("Cüzdan/RPC hazır değil");

    // ═══════════════════════════════════════════════════════════════
    // 1️⃣ DİNAMİK PRIORITY FEE (ağ yoğunluğuna göre)
    // ═══════════════════════════════════════════════════════════════
    const solPrice = this.store.getSolPriceUsd() || 87;
    let dynamicFee = priorityFeeMicroLamports;
    
    if (solPrice > 200) {
      dynamicFee = priorityFeeMicroLamports * 5;
      console.log(`⚡ SOL=$${solPrice} | 5x priority fee`);
    } else if (solPrice > 150) {
      dynamicFee = priorityFeeMicroLamports * 4;
      console.log(`⚡ SOL=$${solPrice} | 4x priority fee`);
    } else if (solPrice > 100) {
      dynamicFee = priorityFeeMicroLamports * 3;
      console.log(`⚡ SOL=$${solPrice} | 3x priority fee`);
    } else {
      dynamicFee = priorityFeeMicroLamports * 2;
      console.log(`🟡 SOL=$${solPrice} | 2x priority fee`);
    }

    // ═══════════════════════════════════════════════════════════════
    // 2️⃣ SWAP BODY HAZIRLA
    // ═══════════════════════════════════════════════════════════════
    const swapBody = {
      quoteResponse: quote,
      userPublicKey: this.keypair.publicKey.toBase58(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: {
        priorityLevelWithMaxLamports: {
          maxLamports: Math.max(dynamicFee, 1),
          priorityLevel: "veryHigh",
        },
      },
    };

    // ═══════════════════════════════════════════════════════════════
    // 3️⃣ JUPITER API'YE SWAP İSTEĞİ GÖNDER (10s timeout)
    // ═══════════════════════════════════════════════════════════════
    let swapRes: Response;
    try {
      swapRes = await Promise.race([
        fetch(JUP_SWAP, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(swapBody),
        }),
        new Promise<Response>((_, reject) =>
          setTimeout(() => reject(new Error("Jupiter API timeout 10s")), 10000)
        ),
      ]);
    } catch (err) {
      throw new Error(`Jupiter API başarısız: ${(err as Error).message}`);
    }

    if (!swapRes.ok) {
      const text = await swapRes.text().catch(() => "");
      throw new Error(`Jupiter ${swapRes.status}: ${text.slice(0, 200)}`);
    }

    const swapJson = (await swapRes.json()) as { swapTransaction: string };
    if (!swapJson.swapTransaction) {
      throw new Error("swapTransaction alınamadı");
    }

    console.log(`✅ Jupiter swap işlem binary'si alındı`);

    // ═══════════════════════════════════════════════════════════════
    // 4️⃣ İŞLEMİ DESERIALIZE ET VE İMZALA
    // ═══════════════════════════════════════════════════════════════
    const txBuf = Buffer.from(swapJson.swapTransaction, "base64");
    const tx = VersionedTransaction.deserialize(txBuf);
    tx.sign([this.keypair]);
    const raw = tx.serialize();

    console.log(`✅ İşlem imzalandı`);

    // ═══════════════════════════════════════════════════════════════
    // 5️⃣ BLOCKCHAIN'E GÖNDER (agresif retry + timeout)
    // ═══════════════════════════════════════════════════════════════
    let signature: string | null = null;
    const maxAttempts = 5;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        signature = await Promise.race([
          this.connection!.sendRawTransaction(raw, {
            skipPreflight: true,
            maxRetries: 3,
          }),
          new Promise<string>((_, reject) =>
            setTimeout(() => reject(new Error("SendTx timeout 5s")), 5000)
          ),
        ]);

        console.log(`✅ Deneme ${attempt + 1}: TX blockchain'e gönderildi: ${signature.slice(0, 16)}...`);
        break;
      } catch (err) {
        const message = (err as Error).message;
        console.warn(`⚠️ Deneme ${attempt + 1}/${maxAttempts} başarısız: ${message}`);

        if (attempt < maxAttempts - 1) {
          const waitMs = 100 * Math.pow(2, attempt);
          console.log(`⏳ ${waitMs}ms bekleniyor, tekrar deneniyor...`);
          await new Promise((r) => setTimeout(r, waitMs));
        } else {
          throw new Error(`TX ${maxAttempts} kez başarısız: ${message}`);
        }
      }
    }

    if (!signature) {
      throw new Error("TX signature alınamadı");
    }

    // ═══════════════════════════════════════════════════════════════
    // 6️⃣ FAST CONFIRM POLLING (20s timeout, 300ms interval)
    // ═══════════════════════════════════════════════════════════════
    const confirmed = await this.waitForConfirmationFast(signature);
    
    if (!confirmed) {
      console.warn(`⚠️ TX onay timeout (20s), ama blockchain'e gitti: ${signature}`);
    }

    return signature;
  }

  private async waitForConfirmationFast(signature: string): Promise<boolean> {
    const startTime = Date.now();
    const timeoutMs = 20000;
    const pollIntervalMs = 300;

    let lastStatus = "";

    while (Date.now() - startTime < timeoutMs) {
      try {
        const status = await this.connection!.getSignatureStatus(signature);

        if (status.value?.confirmationStatus === "confirmed" || status.value?.confirmationStatus === "finalized") {
          console.log(`✅ TX CONFIRMED: ${signature.slice(0, 16)}...`);
          return true;
        }

        if (status.value?.confirmationStatus === "processed") {
          if (lastStatus !== "processed") {
            console.log(`🟡 TX PROCESSED (blok bekleme)...`);
            lastStatus = "processed";
          }
        }
      } catch (err) {
        console.error(`⚠️ Status check hatası: ${(err as Error).message}`);
      }

      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }

    console.warn(`⚠️ Onay timeout: ${signature.slice(0, 16)}...`);
    return false;
  }

  private updateAndEmit(position: Position) {
    this.store.upsert(position);
    this.emit("position_update", position);
  }

  async buy(input: { mintAddress: string; name: string; symbol: string }): Promise<Position | null> {
    const { mintAddress, name, symbol } = input;

    // 1️⃣ HAZIRLIK KONTROLLERI
    if (!this.isReady()) {
      console.error("❌ Cüzdan hazır değil");
      return null;
    }

    if (this.inFlight.has(`buy:${mintAddress}`)) {
      console.warn(`⏳ ${symbol} için alım zaten devam ediyor`);
      return null;
    }

    const existing = this.store.getByMint(mintAddress);
    if (existing && (existing.status === "open" || existing.status === "pending_buy" || existing.status === "pending_sell")) {
      console.warn(`⚠️ ${symbol} zaten portföyde (${existing.status})`);
      return existing;
    }

    // 2️⃣ POSITION'U KAYDET (pending durumda)
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
    console.log(`🛒 HIZLI ALIM BAŞLADI: ${symbol} | ${config.solAmount} SOL`);

    try {
      // 3️⃣ QUOTE + DECIMALS PARALEL AL (⚡ HIZLI)
      console.log(`📊 Quote ve decimals alınıyor...`);
      const [quote, decimals] = await Promise.all([
        this.getQuote(
          {
            inputMint: SOL_MINT,
            outputMint: mintAddress,
            amount: String(lamports),
            slippageBps: config.slippageBps,
          },
          { retries: 1, retryDelayMs: 100 }
        ),
        this.fetchDecimals(mintAddress),
      ]);

      const tokensOut = Number(quote.outAmount) / Math.pow(10, decimals);
      const pricePerToken = tokensOut > 0 ? config.solAmount / tokensOut : 0;

      console.log(`📈 Quote alındı: ${tokensOut.toFixed(4)} ${symbol} | Price: ${pricePerToken.toFixed(9)} SOL/token`);

      // 4️⃣ SWAP İŞLEMİ BAŞLAT (3x priority fee = çok hızlı)
      console.log(`🚀 Blockchain'e gönderiliyor (3x priority fee)...`);
      const sig = await this.swap(quote, config.priorityFeeMicroLamports * 3);

      // 5️⃣ BAŞARILI - POSITION'U GÜNCELLE
      position = {
        ...position,
        status: "open",
        buyTokenAmount: tokensOut,
        buyPriceSol: pricePerToken,
        buyTxSignature: sig,
      };

      this.updateAndEmit(position);
      console.log(`✅ ALIM BAŞARILI: ${tokensOut.toFixed(4)} ${symbol}`);
      console.log(`   TX: https://solscan.io/tx/${sig}`);
      console.log(`   Fiyat: ${pricePerToken.toFixed(9)} SOL/token`);

      return position;
    } catch (err) {
      // ❌ HATA - POSITION'U BAŞARISIZ OLARAK KAYDET
      const message = (err as Error).message || String(err);
      position = {
        ...position,
        status: "failed",
        error: message,
      };

      this.updateAndEmit(position);
      console.error(`❌ ALIM HATASI ${symbol}: ${message}`);

      return position;
    } finally {
      // 6️⃣ LOCK'U KALDIR
      this.inFlight.delete(`buy:${mintAddress}`);
      console.log(`🔓 ${symbol} lock kaldırıldı`);
    }
  }

  async sell(positionId: string): Promise<Position | null> {
    const pos = this.store.getById(positionId);
    
    // 1️⃣ HAZIRLIK KONTROLLERI
    if (!pos) {
      console.warn(`⚠️ Pozisyon bulunamadı: ${positionId}`);
      return null;
    }

    if (pos.status !== "open") {
      console.warn(`⚠️ Pozisyon satışa uygun değil (${pos.status}): ${pos.symbol}`);
      return pos;
    }

    if (!this.isReady()) {
      console.error("❌ Cüzdan hazır değil");
      return null;
    }

    if (this.inFlight.has(`sell:${pos.id}`)) {
      console.warn(`⏳ ${pos.symbol} için satış zaten devam ediyor`);
      return pos;
    }

    // 2️⃣ POSITION'U KAYDET (pending durumda)
    this.inFlight.add(`sell:${pos.id}`);
    const config = this.store.getConfig();
    let updated: Position = { ...pos, status: "pending_sell" };
    this.updateAndEmit(updated);
    console.log(`💸 HIZLI SATIŞ BAŞLADI: ${pos.symbol} | ${pos.buyTokenAmount?.toFixed(4)} token`);

    try {
      // 3️⃣ BAKIYE AL (cache'ten, 3 saniye geçerli)
      console.log(`📊 Token bakiyesi alınıyor...`);
      const balance = await this.getTokenBalance(pos.mintAddress);
      
      if (!balance || BigInt(balance.raw) === 0n) {
        throw new Error("Cüzdanda token bakiyesi bulunamadı");
      }

      console.log(`✅ Bakiye alındı: ${balance.uiAmount.toFixed(4)} ${pos.symbol}`);

      // 4️⃣ QUOTE AL (hızlı, minimal retry)
      console.log(`📈 Quote alınıyor...`);
      const quote = await this.getQuote(
        {
          inputMint: pos.mintAddress,
          outputMint: SOL_MINT,
          amount: balance.raw,
          slippageBps: config.slippageBps,
        },
        { retries: 1, retryDelayMs: 100 }  // ⚡ Hızlı
      );

      const solOut = Number(quote.outAmount) / 1e9;
      const sellPricePerToken = balance.uiAmount > 0 ? solOut / balance.uiAmount : 0;

      console.log(`📈 Quote alındı: ${solOut.toFixed(4)} SOL | Price: ${sellPricePerToken.toFixed(9)} SOL/token`);

      // 5️⃣ SWAP İŞLEMİ BAŞLAT (4x priority fee = EN HIZLI SATIŞ)
      console.log(`🚀 Blockchain'e gönderiliyor (4x priority fee - AGRESIF)...`);
      const sig = await this.swap(quote, config.priorityFeeMicroLamports * 4);

      // 6️⃣ PNL HESAPLA
      const pnlSol = solOut - pos.buySolAmount;
      const pnlPct = pos.buySolAmount > 0 ? (pnlSol / pos.buySolAmount) * 100 : 0;

      // 7️⃣ BAŞARILI - POSITION'U GÜNCELLE
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
      console.log(`✅ SATIŞ BAŞARILI: ${pos.symbol}`);
      console.log(`   Satış Fiyatı: ${solOut.toFixed(4)} SOL`);
      console.log(`   PnL: ${pnlSol >= 0 ? "+" : ""}${pnlSol.toFixed(4)} SOL (${pnlPct.toFixed(1)}%)`);
      console.log(`   TX: https://solscan.io/tx/${sig}`);

      return updated;
    } catch (err) {
      // ❌ HATA - POSITION'U OPEN OLARAK GERI DÖNDÜR (tekrar satış denesin)
      const message = (err as Error).message || String(err);
      updated = { ...pos, status: "open", error: message };
      this.updateAndEmit(updated);
      console.error(`❌ SATIŞ HATASI ${pos.symbol}: ${message}`);

      return updated;
    } finally {
      // 8️⃣ LOCK'U KALDIR
      this.inFlight.delete(`sell:${pos.id}`);
      console.log(`🔓 ${pos.symbol} lock kaldırıldı`);
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
