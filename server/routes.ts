import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { HeliusMonitor } from "./helius-monitor";
import { JupiterTrader } from "./jupiter-trader";
import { TradeStore } from "./trade-store";
import { PositionPricer } from "./position-pricer";
import { saveSecrets } from "./secrets-loader";
import fs from "fs";
import path from "path";
import { EventStore } from "./event-store";

const ROOT = process.cwd();

const ALLOWED_FILES = [
  "server/helius-monitor.ts",
  "server/routes.ts",
  "server/index.ts",
  "server/storage.ts",
  "server/jupiter-trader.ts",
  "server/trade-store.ts",
  "shared/schema.ts",
  "data/secrets.json",
];

function safeResolvePath(filePath: string): string | null {
  const resolved = path.resolve(ROOT, filePath);
  if (!resolved.startsWith(ROOT)) return null;
  const rel = path.relative(ROOT, resolved).replace(/\\/g, "/");
  if (!ALLOWED_FILES.includes(rel)) return null;
  return resolved;
}


// ---- Console log yakalayıcı ----
// Tüm console çıktılarını hem terminale hem istemcilere iletir.
// _broadcasting flag döngüyü önler.
let _broadcasting = false;
const _origLog   = console.log.bind(console);
const _origWarn  = console.warn.bind(console);
const _origError = console.error.bind(console);

let _broadcast: ((level: "info" | "warn" | "error", msg: string) => void) | null = null;

const capture = (level: "info" | "warn" | "error", orig: (...a: any[]) => void, args: any[]) => {
  orig(...args);
  if (_broadcasting || !_broadcast) return;
  const msg = args
    .map((a) => (typeof a === "string" ? a : a instanceof Error ? a.message : JSON.stringify(a)))
    .join(" ");
  // Çok gürültülü client connect/disconnect satırlarını filtrele
  if (msg.includes("Yeni client") || msg.includes("Client bağlantısı")) return;
  _broadcasting = true;
  _broadcast(level, msg);
  _broadcasting = false;
};

console.log   = (...a) => capture("info",  _origLog,   a);
console.warn  = (...a) => capture("warn",  _origWarn,  a);
console.error = (...a) => capture("error", _origError, a);
// --------------------------------

export async function registerRoutes(app: Express): Promise<Server> {
  const httpServer = createServer(app);

  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  const clients = new Set<WebSocket>();

  // Persistent event store (server-side)
  const eventStore = new EventStore();

  const broadcastToClients = (message: any) => {
    // message expected: { type: string, data: any }
    try {
      const stored = eventStore.append(message.type || "unknown", message.data ?? null);
      const payload = JSON.stringify(stored);
      clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(payload);
        }
      });
    } catch (err) {
      _origError("❌ broadcastToClients error:", err);
    }
  };

  // Console yakalayıcıya broadcast fonksiyonunu bağla
  _broadcast = (level, message) => {
    broadcastToClients({
      type: "server_log",
      data: { level, message, timestamp: Date.now() },
    });
  };

  // ---- Dosya Editörü API ----
  app.get("/api/files/list", (_req, res) => {
    res.json({ files: ALLOWED_FILES });
  });

  app.get("/api/files/read", (req, res) => {
    const filePath = req.query.path as string;
    if (!filePath) return res.status(400).json({ error: "path gerekli" });
    const resolved = safeResolvePath(filePath);
    if (!resolved) return res.status(403).json({ error: "İzin verilmeyen dosya" });
    try {
      const content = fs.readFileSync(resolved, "utf-8");
      res.json({ content });
    } catch {
      res.status(404).json({ error: "Dosya bulunamadı" });
    }
  });

  app.post("/api/files/write", (req, res) => {
    const { path: filePath, content } = req.body as { path: string; content: string };
    if (!filePath || content === undefined) return res.status(400).json({ error: "path ve content gerekli" });
    const resolved = safeResolvePath(filePath);
    if (!resolved) return res.status(403).json({ error: "İzin verilmeyen dosya" });
    try {
      fs.writeFileSync(resolved, content, "utf-8");
      _origLog(`📝 Dosya güncellendi: ${filePath}`);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Yeni endpoint: kaçırılan (persisted) eventleri al
  app.get("/api/events", (req, res) => {
    const afterId = Number(req.query.afterId || 0) || 0;
    try {
      const events = eventStore.getAfter(afterId);
      res.json({ events });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });


  app.post("/api/update-secrets", (req, res) => {
    const { HELIUS_API_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, TRADER_PRIVATE_KEY } = req.body || {};
    try {
      if (HELIUS_API_KEY !== undefined || TELEGRAM_BOT_TOKEN !== undefined || TELEGRAM_CHAT_ID !== undefined || TRADER_PRIVATE_KEY !== undefined) {
        const updates: Record<string, string> = {};
        if (typeof HELIUS_API_KEY === "string") updates.HELIUS_API_KEY = HELIUS_API_KEY;
        if (typeof TELEGRAM_BOT_TOKEN === "string") updates.TELEGRAM_BOT_TOKEN = TELEGRAM_BOT_TOKEN;
        if (typeof TELEGRAM_CHAT_ID === "string") updates.TELEGRAM_CHAT_ID = TELEGRAM_CHAT_ID;
        if (typeof TRADER_PRIVATE_KEY === "string") updates.TRADER_PRIVATE_KEY = TRADER_PRIVATE_KEY;
        if (Object.keys(updates).length > 0) {
          saveSecrets(updates);
          _origLog("🔐 Secrets güncellendu (⚠️ Restart gerekli)");
          res.json({ ok: true, message: "Secrets güncellendi. Değişikliklerin etkili olması için uygulamayı yeniden başlatın." });
        } else {
          res.status(400).json({ error: "Güncellenecek alan bulunamadı" });
        }
      } else {
        res.status(400).json({ error: "En az bir secret alanı gerekli" });
      }
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });
  // --------------------------

  // ---- Trade store + Jupiter ----
  const tradeStore = new TradeStore();
  const trader = new JupiterTrader(tradeStore, (event, data) => {
    if (event === "position_update") {
      broadcastToClients({ type: "position_update", data });
    } else if (event === "trade_config_update") {
      broadcastToClients({ type: "trade_config_update", data });
    }
  });

  const sendPositionsSnapshot = (ws: WebSocket) => {
    ws.send(
      JSON.stringify({
        type: "positions_snapshot",
        data: {
          positions: tradeStore.getAll(),
          config: tradeStore.getConfig(),
          traderPublicKey: trader.getPublicKey(),
          traderReady: trader.isReady(),
          solPriceUsd: monitor.getSolPriceUsd(),
        },
      }),
    );
  };
  // -------------------------------

  const monitor = new HeliusMonitor((event: string, data: any) => {
    if (event === "mint_detected") {
      broadcastToClients({ type: "mint_detected", data });
    } else if (event === "lp_detected") {
      broadcastToClients({ type: "lp_detected", data });
    } else if (event === "connection_status") {
      broadcastToClients({ type: "connection_status", data });
    } else if (event === "monitoring_state") {
      broadcastToClients({ type: "monitoring_state", data });
    } else if (event === "error") {
      broadcastToClients({ type: "error", data });
    }
  });

  monitor.start();

  // Canlı fiyat güncelleme (açık pozisyonlar için)
  const pricer = new PositionPricer(tradeStore, monitor.getSolPriceUsd(), (event: string, data: any) => {
    if (event === "position_update") {
      broadcastToClients({ type: "position_update", data });
    }
  });
  pricer.start();

  wss.on("connection", (ws: WebSocket) => {
    _origLog("👤 Yeni client bağlandı");
    clients.add(ws);

    ws.send(
      JSON.stringify({
        type: "monitoring_state",
        data: { isMonitoring: monitor.getState() },
      })
    );
    sendPositionsSnapshot(ws);

    ws.on("message", async (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        if (message.type === "toggle_monitoring") {
          if (message.data.enabled) {
            monitor.start();
          } else {
            monitor.stop();
          }
        } else if (message.type === "get_balance") {
          const publicKey = message.data.publicKey;
          try {
            const balance = await monitor.getWalletBalance(publicKey);
            ws.send(JSON.stringify({ type: "balance_update", data: { balance, publicKey } }));
          } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            console.error("get_balance hatası:", reason);
            // İstemcinin yükleme durumunu temizleyebilmesi için balance:null dönüyoruz
            ws.send(JSON.stringify({ type: "balance_update", data: { balance: null, publicKey, error: reason } }));
            ws.send(JSON.stringify({
              type: "error",
              data: { message: `Bakiye çekilemedi: ${reason}` },
            }));
          }
        } else if (message.type === "buy_token") {
          const { mintAddress, name, symbol } = message.data || {};
          if (mintAddress) {
            trader.buy({
              mintAddress,
              name: name || "Bilinmiyor",
              symbol: symbol || "?",
            }).catch((err) => console.error("buy_token hatası:", err));
          }
        } else if (message.type === "sell_token") {
          const { positionId } = message.data || {};
          if (positionId) {
            trader.sell(positionId).catch((err) => console.error("sell_token hatası:", err));
          }
        } else if (message.type === "trade_config_update") {
          const { solAmount, slippageBps, priorityFeeMicroLamports } = message.data || {};
          const partial: Record<string, number> = {};
          if (typeof solAmount === "number" && solAmount > 0) partial.solAmount = solAmount;
          if (typeof slippageBps === "number" && slippageBps >= 50 && slippageBps <= 10000) partial.slippageBps = slippageBps;
          if (typeof priorityFeeMicroLamports === "number" && priorityFeeMicroLamports >= 0) partial.priorityFeeMicroLamports = priorityFeeMicroLamports;
          if (Object.keys(partial).length) trader.updateConfig(partial as any);
        } else if (message.type === "delete_position") {
          const { positionId } = message.data || {};
          if (positionId) {
            const pos = tradeStore.getById(positionId);
            if (pos && (pos.status === "pending_buy" || pos.status === "pending_sell")) {
              trader.cancel(positionId);
            }
            tradeStore.delete(positionId);
            broadcastToClients({
              type: "positions_snapshot",
              data: {
                positions: tradeStore.getAll(),
                config: tradeStore.getConfig(),
                traderPublicKey: trader.getPublicKey(),
                traderReady: trader.isReady(),
                solPriceUsd: monitor.getSolPriceUsd(),
              },
            });
          }
        } else if (message.type === "request_positions") {
          sendPositionsSnapshot(ws);
        }
      } catch {
        // ignore
      }
    });

    ws.on("close", () => {
      _origLog("👋 Client bağlantısı kesildi");
      clients.delete(ws);
    });

    ws.on("error", () => {
      clients.delete(ws);
    });
  });

  wss.on("error", (error) => {
    _origError("❌ WebSocket Server hatası:", error);
  });

  process.on("SIGTERM", () => { monitor.stop(); wss.close(); });
  process.on("SIGINT",  () => { monitor.stop(); wss.close(); });

  return httpServer;
}
