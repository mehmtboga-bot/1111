import WebSocket from "ws";
import { secrets } from "./secrets-loader";

const HELIUS_API_KEY = secrets.HELIUS_API_KEY;

// WebSocket: ücretsiz public RPC — swap/remove/claim bildirimleri Helius kredisi yemez
const WS_URL  = `wss://api.mainnet-beta.solana.com`;
// HTTP: Helius — sadece CreatePool tespitinde getTransaction + getAsset için kullanılır
const HTTP_URL = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;

const TELEGRAM_BOT_TOKEN = secrets.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID   = secrets.TELEGRAM_CHAT_ID;

async function sendTelegramNotification(message: string): Promise<void> {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.warn("⚠️ Telegram bilgileri eksik.");
    return;
  }
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: TELEGRAM_CHAT_ID,
          text: message,
          parse_mode: "HTML",
          disable_web_page_preview: true,
        }),
      }
    );
    const data = await res.json();
    if (data.ok) {
      console.log("📲 Telegram bildirimi gönderildi.");
    } else {
      console.error("❌ Telegram hatası:", data.description);
    }
  } catch (err) {
    console.error("❌ Telegram bildirim hatası:", err);
  }
}

// ─── Rate Limiter ─────────────────────────────────────────────────────────────
class RateLimiter {
  private queue: Array<() => void> = [];
  private tokens: number;
  private readonly maxTokens: number;
  private interval: NodeJS.Timeout;

  constructor(requestsPerSecond: number) {
    this.maxTokens = requestsPerSecond;
    this.tokens    = requestsPerSecond;
    this.interval  = setInterval(() => {
      this.tokens = this.maxTokens;
      this.processQueue();
    }, 1000);
    this.interval.unref?.();
  }

  private processQueue() {
    while (this.tokens > 0 && this.queue.length > 0) {
      const next = this.queue.shift();
      if (next) { this.tokens--; next(); }
    }
  }

  acquire(): Promise<void> {
    return new Promise((resolve) => {
      if (this.tokens > 0) {
        this.tokens--;
        resolve();
      } else {
        this.queue.push(resolve);
      }
    });
  }

  destroy() {
    clearInterval(this.interval);
    this.queue.forEach((r) => r());
    this.queue = [];
  }
}

// ─── Sabitler ─────────────────────────────────────────────────────────────────
const PUMPSWAP = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";
const WSOL     = "So11111111111111111111111111111111111111112";

// CreatePool log'unun tam hali — swap/remove/claim'de kesinlikle görünmez
const LP_LOG_PATTERN   = "Program log: Instruction: CreatePool";
// Ek kontrol: PumpSwap programının invoke satırı (derinlik 1)
const PUMPSWAP_INVOKE  = `Program ${PUMPSWAP} invoke [1]`;

const MIN_TVL_USD_NOTIFY = 40000;

const TROJAN_BOT = "solana_trojanbot";
const TROJAN_REF = "mehmtbga";
const trojanUrl  = (mint: string) =>
  `https://t.me/${TROJAN_BOT}?start=r-${TROJAN_REF}-${mint}`;

interface TokenMetadata {
  name: string;
  symbol: string;
}

/**
 * Sadece LP oluşturma (CreatePool) olaylarını dinler.
 * Swap / remove / fee-claim gibi diğer PumpSwap işlemleri
 * herhangi bir HTTP çağrısı tetiklemeden log seviyesinde atlanır.
 */
export class HeliusMonitor {
  private dexWebSocket: WebSocket | null = null;
  private processedDexSignatures: Set<string> = new Set();

  private reconnectTimeoutDex: NodeJS.Timeout | null = null;
  private heartbeatInterval: NodeJS.Timeout | null   = null;
  private pingIntervalDex: NodeJS.Timeout | null     = null;

  private eventEmitter: (event: string, data: any) => void;
  private isRunning = false;
  private solPriceUsd: number = 0;
  private rateLimiter = new RateLimiter(8);

  constructor(eventEmitter: (event: string, data: any) => void) {
    this.eventEmitter = eventEmitter;
  }

  async start() {
    if (this.isRunning) { console.log("⚠️ Monitor zaten çalışıyor"); return; }
    this.isRunning = true;
    console.log("🚀 Helius Monitor başlatılıyor (PumpSwap — sadece CreatePool)...");
    this.eventEmitter("monitoring_state", { isMonitoring: true });

    await this.fetchSolPriceOnce();
    this.connectDex();
    this.startHeartbeat();
  }

  private async fetchSolPriceOnce(): Promise<void> {
    const FALLBACK = 87;
    const SOL_MINT = "So11111111111111111111111111111111111111112";

    try {
      const res  = await fetch(`https://lite-api.jup.ag/price/v3?ids=${SOL_MINT}`);
      const data = await res.json();
      const price = data?.[SOL_MINT]?.usdPrice;
      if (typeof price === "number" && price > 0) {
        this.solPriceUsd = price;
        console.log(`💵 SOL/USD (Jupiter): $${price.toFixed(2)}`);
        return;
      }
    } catch (err) {
      console.warn("⚠️ Jupiter API başarısız, CoinGecko deneniyor...", (err as Error).message);
    }

    try {
      const res  = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd");
      const data = await res.json();
      const price = data?.solana?.usd;
      if (typeof price === "number" && price > 0) {
        this.solPriceUsd = price;
        console.log(`💵 SOL/USD (CoinGecko): $${price.toFixed(2)}`);
        return;
      }
    } catch (err) {
      console.error("❌ CoinGecko da başarısız:", (err as Error).message);
    }

    this.solPriceUsd = FALLBACK;
    console.warn(`⚠️ Fiyat API'si çalışmadı, sabit $${FALLBACK} kullanılıyor.`);
  }

  private toUsd(sol: number | undefined): { usd?: number; tvlUsd?: number } {
    if (!sol || !this.solPriceUsd) return {};
    const usd = sol * this.solPriceUsd;
    return { usd, tvlUsd: usd * 2 };
  }

  getState() { return this.isRunning; }
  getSolPriceUsd(): number { return this.solPriceUsd; }

  private startHeartbeat() {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    this.sendHeartbeat();
    this.heartbeatInterval = setInterval(() => this.sendHeartbeat(), 60 * 60 * 1000);
  }

  private sendHeartbeat() {
    const now = new Date().toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" });
    sendTelegramNotification(
      `📡 <b>Sistem Aktif — Taranıyor</b>\n\n` +
      `🕐 <b>Saat:</b> ${now}\n` +
      `✅ Bağlantı canlı (Public RPC → WS | Helius → HTTP)\n` +
      `🔍 Yalnızca PumpSwap LP oluşturmaları izleniyor\n\n` +
      `<i>LP tespit edildiği anda bildirim alacaksınız.</i>`
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // WebSocket — PumpSwap logsSubscribe
  // Public RPC üzerinden dinlenir → Helius kredisi yok.
  // Sadece CreatePool logları içeren TX'ler işlenir;
  // swap / remove / claim / diğerleri sıfır HTTP çağrısıyla atlanır.
  // ═══════════════════════════════════════════════════════════════════════════
  private connectDex() {
    this.dexWebSocket = new WebSocket(WS_URL);

    this.dexWebSocket.on("open", () => {
      console.log("✅ [WS] DEX WebSocket bağlandı (Public RPC — PumpSwap LP only)");
      this.dexWebSocket?.send(JSON.stringify({
        jsonrpc: "2.0",
        id: 100,
        method: "logsSubscribe",
        params: [{ mentions: [PUMPSWAP] }, { commitment: "confirmed" }],
      }));

      if (this.pingIntervalDex) clearInterval(this.pingIntervalDex);
      this.pingIntervalDex = setInterval(() => {
        if (this.dexWebSocket?.readyState === WebSocket.OPEN) {
          this.dexWebSocket.ping();
        }
      }, 10000);
    });

    this.dexWebSocket.on("message", async (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString());
        const value = msg?.params?.result?.value;
        if (!value) return;

        const logs: string[] | undefined = value.logs;
        const signature: string | undefined = value.signature;
        if (!logs || !signature) return;

        // ── LP filtresi (çift kontrol) ───────────────────────────────────────
        // 1. PumpSwap programının doğrudan (depth=1) çağrıldığını doğrula
        // 2. Tam "CreatePool" talimat logunu ara
        // Bu iki koşul yalnızca yeni havuz oluşturma TX'lerinde aynı anda bulunur.
        // Swap, RemoveLiquidity, CollectFees vb. işlemlerde bulunmaz → sıfır HTTP çağrısı.
        const hasInvoke     = logs.includes(PUMPSWAP_INVOKE);
        const hasCreatePool = logs.some((l) => l === LP_LOG_PATTERN);
        if (!hasInvoke || !hasCreatePool) return;

        // Tekrar işleme koruması
        if (this.processedDexSignatures.has(signature)) return;
        this.processedDexSignatures.add(signature);
        if (this.processedDexSignatures.size > 500) {
          const first = this.processedDexSignatures.values().next().value;
          if (first) this.processedDexSignatures.delete(first);
        }

        await this.handleDexLP(signature);
      } catch (err) {
        console.error("❌ [WS] Mesaj hatası:", err);
      }
    });

    this.dexWebSocket.on("error", (err) => {
      console.error("❌ [WS] Hata:", err);
    });

    this.dexWebSocket.on("close", () => {
      console.log("🔌 [WS] DEX bağlantısı kapandı");
      if (this.pingIntervalDex) { clearInterval(this.pingIntervalDex); this.pingIntervalDex = null; }
      if (this.isRunning) {
        this.reconnectTimeoutDex = setTimeout(() => this.connectDex(), 3000);
      }
    });
  }

  private async handleDexLP(signature: string) {
    try {
      const { tokenMint, lpMint, liquidityAmount } =
        await this.extractMintsFromDexTx(signature);

      if (!tokenMint) {
        console.warn(`⚠️ [WS] PumpSwap — token mint bulunamadı: ${signature.slice(0, 8)}...`);
        return;
      }

      const metadata = await this.fetchTokenMetadata(tokenMint);

      const name       = metadata?.name   || "Bilinmiyor";
      const symbol     = metadata?.symbol || "?";
      const detectedAt = Date.now();
      const expiresAt  = detectedAt + 5 * 60 * 1000;

      const { usd: liquidityUsd, tvlUsd } = this.toUsd(liquidityAmount);
      const sol    = liquidityAmount ? `${liquidityAmount.toFixed(4)} SOL` : "?";
      const usdStr = liquidityUsd ? ` ($${liquidityUsd.toFixed(0)})` : "";
      const tvlStr = tvlUsd ? ` | TVL ~$${tvlUsd.toFixed(0)}` : "";
      console.log(`💧 [LP] ${name} (${symbol}) | PumpSwap | ${sol}${usdStr}${tvlStr}`);

      this.eventEmitter("lp_detected", {
        id: `${tokenMint}-${detectedAt}`,
        mintAddress: tokenMint,
        lpMint,
        name, symbol,
        detectedAt, expiresAt,
        liquidityAmount, liquidityUsd, tvlUsd,
        platform: "PumpSwap",
        jupiterUrl:     `https://jup.ag/swap/SOL-${tokenMint}`,
        dexscreenerUrl: `https://dexscreener.com/solana/${tokenMint}`,
        pumpfunUrl:     `https://pump.fun/${tokenMint}`,
      });

      const meetsThreshold = (tvlUsd ?? 0) >= MIN_TVL_USD_NOTIFY;
      if (!meetsThreshold) {
        console.log(
          `🚫 [LP] Telegram atlandı | ${symbol} | TVL=$${tvlUsd?.toFixed(0) ?? "?"} | eşik=$${MIN_TVL_USD_NOTIFY}`
        );
        return;
      }

      const usdLine = liquidityUsd ? `\n💵 <b>USD:</b> $${liquidityUsd.toFixed(2)}` : "";
      const tvlLine = tvlUsd       ? `\n📊 <b>TVL (~×2):</b> $${tvlUsd.toFixed(2)}` : "";
      sendTelegramNotification(
        `💰 <b>YENİ LP TESPİT EDİLDİ! TVL: $${(tvlUsd ?? 0).toFixed(0)}</b>\n\n` +
        `🏊 <b>Platform:</b> PumpSwap\n` +
        `🪙 <b>Token:</b> ${name} (${symbol})\n` +
        `💧 <b>Likidite:</b> ${sol}${usdLine}${tvlLine}\n` +
        `📋 <b>Token Mint:</b> <code>${tokenMint}</code>\n` +
        `🔗 <b>LP Mint:</b> <code>${lpMint ?? "Yok"}</code>\n\n` +
        `🔍 <a href="https://dexscreener.com/solana/${tokenMint}">Dexscreener</a> | ` +
        `🪐 <a href="https://jup.ag/swap/SOL-${tokenMint}">Jupiter</a> | ` +
        `🤖 <a href="${trojanUrl(tokenMint)}">Trojan ile Aç</a> | ` +
        `🌊 <a href="https://pump.fun/${tokenMint}">Pump.fun</a>`
      );
    } catch (err) {
      console.error("❌ [WS] DEX LP hatası:", err);
    }
  }

  private async extractMintsFromDexTx(
    signature: string
  ): Promise<{ tokenMint: string | null; lpMint: string | null; liquidityAmount?: number }> {
    try {
      let meta: any = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        await this.rateLimiter.acquire();
        const res  = await fetch(HTTP_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0", id: 1,
            method: "getTransaction",
            params: [
              signature,
              { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" },
            ],
          }),
        });
        const data = await res.json();
        meta = data.result?.meta;
        if (meta) break;
        if (attempt < 3) await new Promise((r) => setTimeout(r, 1500));
      }

      if (!meta) {
        console.warn(`⚠️ [LP] TX indexlenemedi, atlanıyor: ${signature.slice(0, 8)}...`);
        return { tokenMint: null, lpMint: null };
      }

      const post: any[] = meta.postTokenBalances || [];
      const pre: any[]  = meta.preTokenBalances  || [];
      const preMints    = new Set(pre.map((p: any) => p.mint));

      const newMints      = post.filter((p: any) => !preMints.has(p.mint) && p.mint !== WSOL);
      const existingMints = post.filter((p: any) =>  preMints.has(p.mint) && p.mint !== WSOL);

      const lpMint =
        newMints.find((p: any) => p.uiTokenAmount?.amount !== "0")?.mint ??
        newMints[0]?.mint ??
        null;

      const tokenMint = existingMints.length > 0
        ? existingMints[0].mint
        : (newMints.length > 1 ? newMints[1].mint : lpMint);

      // Likidite: net WSOL girişi
      let liquidityAmount: number | undefined;
      let totalWsolIn = BigInt(0);
      for (const wp of post.filter((p: any) => p.mint === WSOL)) {
        const prevEntry = pre.find((x: any) => x.accountIndex === wp.accountIndex);
        const postAmt   = BigInt(wp.uiTokenAmount?.amount || "0");
        const preAmt    = BigInt(prevEntry?.uiTokenAmount?.amount || "0");
        const net = postAmt - preAmt;
        if (net > BigInt(0)) totalWsolIn += net;
      }
      if (totalWsolIn > BigInt(0)) liquidityAmount = Number(totalWsolIn) / 1e9;

      // Fallback: native SOL bakiye değişimi
      if (!liquidityAmount) {
        const preBalances: number[]  = meta.preBalances  || [];
        const postBalances: number[] = meta.postBalances || [];
        let maxNativeSolIn = 0;
        for (let i = 0; i < postBalances.length; i++) {
          const diff = (postBalances[i] || 0) - (preBalances[i] || 0);
          if (diff > 10_000_000) maxNativeSolIn = Math.max(maxNativeSolIn, diff);
        }
        if (maxNativeSolIn > 0) liquidityAmount = maxNativeSolIn / 1e9;
      }

      return { tokenMint, lpMint, liquidityAmount };
    } catch (err) {
      console.error("❌ extractMintsFromDexTx hatası:", err);
      return { tokenMint: null, lpMint: null };
    }
  }

  private async fetchTokenMetadata(mintAddress: string): Promise<TokenMetadata | null> {
    try {
      await this.rateLimiter.acquire();
      const res  = await fetch(HTTP_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0", id: 1,
          method: "getAsset",
          params: { id: mintAddress },
        }),
      });
      const data   = await res.json();
      const result = data.result;
      if (!result) return null;
      const name   = result.content?.metadata?.name   || "Bilinmiyor";
      const symbol = result.content?.metadata?.symbol || "?";
      if (name === "Bilinmiyor" && symbol === "?") return null;
      return { name, symbol };
    } catch { return null; }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Stop
  // ═══════════════════════════════════════════════════════════════════════════
  stop() {
    if (!this.isRunning) { console.log("⚠️ Monitor zaten durdurulmuş"); return; }
    console.log("🛑 Helius Monitor durduruluyor...");
    this.isRunning = false;

    if (this.reconnectTimeoutDex) { clearTimeout(this.reconnectTimeoutDex);  this.reconnectTimeoutDex = null; }
    if (this.heartbeatInterval)   { clearInterval(this.heartbeatInterval);   this.heartbeatInterval   = null; }
    if (this.pingIntervalDex)     { clearInterval(this.pingIntervalDex);      this.pingIntervalDex     = null; }

    if (this.dexWebSocket) {
      this.dexWebSocket.removeAllListeners();
      this.dexWebSocket.terminate();
      this.dexWebSocket = null;
    }

    this.processedDexSignatures.clear();
    this.rateLimiter.destroy();

    this.eventEmitter("monitoring_state", { isMonitoring: false });
    this.eventEmitter("connection_status", {
      connected: false,
      message: "Monitor durduruldu",
      isMonitoring: false,
    });
  }
}
