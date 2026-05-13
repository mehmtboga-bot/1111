import { useEffect, useRef, useState } from "react";
import { Coins, Droplet, Lock, Wallet, Zap } from "lucide-react";
import { ConnectionStatus } from "@/components/ConnectionStatus";
import { MintedTokenCard } from "@/components/MintedTokenCard";
import { LPLogTable } from "@/components/LPLogTable";
import { WalletBalance } from "@/components/WalletBalance";
import { FileEditor } from "@/components/FileEditor";
import { TradePanel } from "@/components/TradePanel";
import { Badge } from "@/components/ui/badge";
import type { MintedToken, LPDetection, WSMessage, Position, TradeConfig } from "@shared/schema";
import type { ServerLog } from "@/components/LogPanel";

const MAX_MINTED_TOKENS = 7;
const MAX_LP_LOGS = 30;
const MINT_DISPLAY_DURATION = 3 * 60 * 1000;
const LP_LOG_DURATION = 5 * 60 * 1000;
const SOL_PRICE = 87;

type Tab = "console" | "dashboard" | "trade" | "files";

const DEFAULT_CONFIG: TradeConfig = {
  solAmount: 0.01,
  slippageBps: 5000,
  priorityFeeMicroLamports: 200_000,
};

// ---- Geometrik şekil ikonları ----
function TriangleIcon({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
      <polygon
        points="12,4 22,20 2,20"
        fill={active ? "hsl(var(--primary))" : "none"}
        stroke={active ? "hsl(var(--primary))" : "currentColor"}
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function SquareIcon({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
      <rect
        x="4" y="4" width="16" height="16" rx="1"
        fill={active ? "hsl(var(--primary))" : "none"}
        stroke={active ? "hsl(var(--primary))" : "currentColor"}
        strokeWidth="1.8"
      />
    </svg>
  );
}
function CircleIcon({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
      <circle
        cx="12" cy="12" r="9"
        fill={active ? "hsl(var(--primary))" : "none"}
        stroke={active ? "hsl(var(--primary))" : "currentColor"}
        strokeWidth="1.8"
      />
    </svg>
  );
}
function PlusIcon({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
      <path
        d="M12 4v16M4 12h16"
        stroke={active ? "hsl(var(--primary))" : "currentColor"}
        strokeWidth="2.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ---- Log satır rengi ----
const levelStyle: Record<ServerLog["level"], string> = {
  info:  "text-emerald-400",
  warn:  "text-yellow-400",
  error: "text-red-400",
};
const levelPrefix: Record<ServerLog["level"], string> = {
  info:  "",
  warn:  "[WARN] ",
  error: "[ERR]  ",
};
function formatTime(ts: number) {
  const d = new Date(ts);
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((v) => String(v).padStart(2, "0"))
    .join(":");
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");
  const [isConnected, setIsConnected] = useState(false);
  const [connectionMessage, setConnectionMessage] = useState("");
  const [mintedTokens, setMintedTokens] = useState<MintedToken[]>([]);
  const [lpLogs, setLpLogs] = useState<LPDetection[]>([]);
  const [newTokenId, setNewTokenId] = useState<string | null>(null);
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [walletBalance, setWalletBalance] = useState<number | null>(null);
  const [lastPublicKey, setLastPublicKey] = useState<string | null>(null);
  const [serverLogs, setServerLogs] = useState<ServerLog[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [tradeConfig, setTradeConfig] = useState<TradeConfig>(DEFAULT_CONFIG);
  const [traderPublicKey, setTraderPublicKey] = useState<string | undefined>();
  const [traderReady, setTraderReady] = useState(false);
  const [solPriceUsd, setSolPriceUsd] = useState<number>(0);
  const logIdRef = useRef(0);
  const logBottomRef = useRef<HTMLDivElement>(null);

  const toggleMonitoring = () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "toggle_monitoring", data: { enabled: !isMonitoring } }));
    }
  };

  const handleGetBalance = (publicKey: string) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "get_balance", data: { publicKey } }));
    }
  };

  const handleBuy = (mintAddress: string, name: string, symbol: string) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "buy_token", data: { mintAddress, name, symbol } }));
    }
  };

  const handleSell = (positionId: string) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "sell_token", data: { positionId } }));
    }
  };

  const handleDeletePosition = (positionId: string) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "delete_position", data: { positionId } }));
    }
  };

  const handleConfigUpdate = (cfg: Partial<TradeConfig>) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "trade_config_update", data: cfg }));
    }
  };

  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host || "localhost:5000";
    const wsUrl = `${protocol}//${host}/ws`;
    let wsInstance: WebSocket | null = null;
    let reconnectTimeout: NodeJS.Timeout;

    const connect = () => {
      wsInstance = new WebSocket(wsUrl);
      setWs(wsInstance);

      wsInstance.onopen = () => {
        setIsConnected(true);
        setConnectionMessage("");
      };

      wsInstance.onmessage = (event) => {
        try {
          const message: WSMessage = JSON.parse(event.data);
          if (message.type === "mint_detected") {
            const token = message.data;
            setMintedTokens((prev) => [token, ...prev.filter((t) => t.id !== token.id)].slice(0, MAX_MINTED_TOKENS));
            setNewTokenId(token.id);
            setTimeout(() => setNewTokenId(null), 1000);
          } else if (message.type === "lp_detected") {
            const lpLog = message.data;
            setLpLogs((prev) => [lpLog, ...prev.filter((l) => l.id !== lpLog.id)].slice(0, MAX_LP_LOGS));
          } else if (message.type === "connection_status") {
            setIsConnected(message.data.connected);
            setConnectionMessage(message.data.message || "");
            if (message.data.isMonitoring !== undefined) setIsMonitoring(message.data.isMonitoring);
          } else if (message.type === "monitoring_state") {
            setIsMonitoring(message.data.isMonitoring);
          } else if (message.type === "balance_update") {
            setWalletBalance(message.data.balance);
            setLastPublicKey(message.data.publicKey);
          } else if (message.type === "error") {
            setConnectionMessage(message.data.message);
          } else if (message.type === "server_log") {
            setServerLogs((prev) => [
              ...prev,
              {
                id: ++logIdRef.current,
                level: message.data.level,
                message: message.data.message,
                timestamp: message.data.timestamp,
              },
            ].slice(-300));
          } else if (message.type === "positions_snapshot") {
            setPositions(message.data.positions);
            setTradeConfig(message.data.config);
            setTraderPublicKey(message.data.traderPublicKey);
            setTraderReady(message.data.traderReady);
            if (typeof message.data.solPriceUsd === "number" && message.data.solPriceUsd > 0) {
              setSolPriceUsd(message.data.solPriceUsd);
            }
          } else if (message.type === "position_update") {
            const updated = message.data;
            setPositions((prev) => {
              const idx = prev.findIndex((p) => p.id === updated.id);
              if (idx >= 0) {
                const next = [...prev];
                next[idx] = updated;
                return next;
              }
              return [updated, ...prev];
            });
          } else if (message.type === "trade_config_update") {
            setTradeConfig(message.data);
          }
        } catch { /* ignore */ }
      };

      wsInstance.onerror = () => { setIsConnected(false); setConnectionMessage("Bağlantı hatası"); };
      wsInstance.onclose = () => {
        setIsConnected(false);
        setConnectionMessage("Yeniden bağlanıyor...");
        setWs(null);
        reconnectTimeout = setTimeout(connect, 3000);
      };
    };

    connect();

    const cleanupInterval = setInterval(() => {
      const now = Date.now();
      setMintedTokens((prev) => prev.filter((t) => t.expiresAt > now));
      setLpLogs((prev) => prev.filter((l) => l.expiresAt > now));
    }, 1000);

    return () => {
      clearInterval(cleanupInterval);
      clearTimeout(reconnectTimeout);
      if (wsInstance) wsInstance.close();
    };
  }, []);

  // Konsol sekmesine geçince en alta kaydır
  useEffect(() => {
    if (activeTab === "console") {
      setTimeout(() => logBottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    }
  }, [activeTab, serverLogs]);

  const lockedLogs = lpLogs.filter((l) => l.isLocked);
  const totalSol = lpLogs.reduce((s, l) => s + (l.liquidityAmount ?? 0), 0);
  const totalUsd = totalSol * SOL_PRICE;
  const openPositionCount = positions.filter((p) => p.status === "open" || p.status === "pending_buy" || p.status === "pending_sell").length;

  const activeBuyMints = new Set(
    positions
      .filter((p) => p.status === "open" || p.status === "pending_buy" || p.status === "pending_sell")
      .map((p) => p.mintAddress),
  );

  const TABS: { id: Tab; label: string; icon: (a: boolean) => JSX.Element }[] = [
    { id: "console",   label: "Konsol",   icon: (a) => <TriangleIcon active={a} /> },
    { id: "dashboard", label: "Dashboard", icon: (a) => <SquareIcon  active={a} /> },
    { id: "trade",     label: "Trade",    icon: (a) => <PlusIcon    active={a} /> },
    { id: "files",     label: "Dosyalar", icon: (a) => <CircleIcon   active={a} /> },
  ];

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      {/* ===== HEADER ===== */}
      <header className="sticky top-0 z-50 bg-card border-b border-card-border backdrop-blur-sm bg-card/95 shrink-0">
        <div className="px-4 sm:px-6 py-3">
          <div className="flex items-center justify-between gap-4 flex-wrap">

            {/* Sol: Logo + Başlık */}
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-primary to-chart-2 flex items-center justify-center shrink-0">
                <Coins className="h-5 w-5 text-primary-foreground" />
              </div>
              <div>
                <h1
                  className="text-lg sm:text-xl font-bold bg-gradient-to-r from-primary to-chart-2 bg-clip-text text-transparent"
                  data-testid="text-title"
                >
                  MEMO s KİNGDOM
                </h1>
                <p className="text-[10px] text-muted-foreground hidden sm:block">
                  Gerçek zamanlı mint ve LP tespiti
                </p>
              </div>
            </div>

            {/* Orta: Sekme Butonları */}
            <div className="flex items-center gap-1 bg-muted/40 rounded-lg p-1">
              {TABS.map((tab) => {
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    data-testid={`button-tab-${tab.id}`}
                    title={tab.label}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-150 ${
                      isActive
                        ? "bg-card text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {tab.icon(isActive)}
                    <span className="hidden sm:inline">{tab.label}</span>
                    {tab.id === "trade" && openPositionCount > 0 && (
                      <Badge className="ml-1 px-1.5 py-0 text-[10px] bg-primary/20 text-primary border-0">
                        {openPositionCount}
                      </Badge>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Sağ: Bağlantı durumu */}
            <ConnectionStatus
              isConnected={isConnected}
              message={connectionMessage}
              isMonitoring={isMonitoring}
              onToggleMonitoring={toggleMonitoring}
            />
          </div>
        </div>
      </header>

      {/* ===== İÇERİK ===== */}
      <div className="flex-1 min-h-0 overflow-hidden">

        {/* ▲ KONSOL SEKMESİ */}
        <div className={`h-full flex-col bg-zinc-950 ${activeTab === "console" ? "flex" : "hidden"}`}>
          <div className="flex items-center gap-2 px-4 py-2 border-b border-zinc-800 bg-zinc-900 shrink-0">
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-sm font-mono font-semibold text-zinc-200">Sunucu Logları</span>
            <span className="text-xs text-zinc-500 font-mono">({serverLogs.length} satır)</span>
            <button
              onClick={() => setServerLogs([])}
              className="ml-auto text-xs hover:text-zinc-300 text-zinc-500 transition-colors"
              title="Logları temizle"
            >
              ✕ Temizle
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-3 py-2 font-mono text-xs leading-5 space-y-0.5">
            {serverLogs.length === 0 ? (
              <p className="text-zinc-600 pt-8 text-center">Sunucu logları bekleniyor...</p>
            ) : (
              serverLogs.map((log) => (
                <div key={log.id} className="flex gap-2 items-start">
                  <span className="text-zinc-600 shrink-0 select-none">{formatTime(log.timestamp)}</span>
                  <span className={`${levelStyle[log.level]} break-all whitespace-pre-wrap`}>
                    {levelPrefix[log.level]}{log.message}
                  </span>
                </div>
              ))
            )}
            <div ref={logBottomRef} />
          </div>
        </div>

        {/* ■ DASHBOARD SEKMESİ */}
        <div className={`h-full overflow-y-auto ${activeTab === "dashboard" ? "block" : "hidden"}`}>
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
            {/* Cüzdan */}
            <WalletBalance
              onGetBalance={handleGetBalance}
              balance={walletBalance}
              lastPublicKey={lastPublicKey}
              setWalletBalance={setWalletBalance}
            />

            {/* İstatistik kartları */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard label="Aktif Mint"   value={mintedTokens.length} color="text-primary"  icon={<Coins   className="h-4 w-4" />} />
              <StatCard label="Tüm LP"       value={lpLogs.length}       color="text-chart-4"  icon={<Droplet className="h-4 w-4" />} />
              <StatCard label="Kilitli LP"   value={lockedLogs.length}   color="text-chart-2"  icon={<Lock    className="h-4 w-4" />} />
              <StatCard
                label="Toplam TVL"
                value={`$${(2 * totalUsd).toLocaleString("en-US", { maximumFractionDigits: 0 })}`}
                color="text-chart-3"
                icon={<Wallet className="h-4 w-4" />}
              />
            </div>

            {/* Ana grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Sol: LP Tespitleri */}
              <div className="lg:col-span-2">
                <div className="flex items-center gap-2 mb-3 flex-wrap">
                  <Droplet className="h-5 w-5 text-chart-4" />
                  <h2 className="text-base font-semibold text-foreground">LP Tespitleri</h2>
                  <Badge variant="secondary" data-testid="badge-lp-all-count">{lpLogs.length}</Badge>
                  {lockedLogs.length > 0 && (
                    <Badge className="bg-chart-2/15 text-chart-2 border border-chart-2/30 text-xs" data-testid="badge-lp-locked-count">
                      <Lock className="h-3 w-3 mr-1" />{lockedLogs.length} kilitli
                    </Badge>
                  )}
                  <span className="text-xs text-muted-foreground ml-auto">1 SOL = ${SOL_PRICE} · TVL = 2×SOL×$92</span>
                </div>
                <LPLogTable
                  logs={lpLogs}
                  filter="all"
                  solPrice={SOL_PRICE}
                  emptyMessage="LP tespiti bekleniyor..."
                  traderReady={traderReady}
                  activeBuyMints={activeBuyMints}
                  onBuy={handleBuy}
                />
              </div>

              {/* Sağ: Yeni Mintler */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Coins className="h-5 w-5 text-primary" />
                  <h2 className="text-base font-semibold text-foreground">Yeni Mintler</h2>
                  <Badge variant="secondary" data-testid="badge-mint-count">{mintedTokens.length}/{MAX_MINTED_TOKENS}</Badge>
                </div>
                {mintedTokens.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground" data-testid="text-mint-empty">
                    <Coins className="h-10 w-10 mx-auto mb-2 opacity-40" />
                    <p className="text-sm">Yeni mint bekleniyor...</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {mintedTokens.map((token) => (
                      <MintedTokenCard
                        key={token.id}
                        token={token}
                        isNew={token.id === newTokenId}
                        traderReady={traderReady}
                        hasOpenPosition={activeBuyMints.has(token.mintAddress)}
                        onBuy={handleBuy}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* + TRADE SEKMESİ */}
        <div className={`h-full overflow-y-auto ${activeTab === "trade" ? "block" : "hidden"}`}>
          <TradePanel
            positions={positions}
            config={tradeConfig}
            traderPublicKey={traderPublicKey}
            traderReady={traderReady}
            solPriceUsd={solPriceUsd}
            onSell={handleSell}
            onDelete={handleDeletePosition}
            onUpdateConfig={handleConfigUpdate}
          />
        </div>

        {/* ● DOSYALAR SEKMESİ */}
        <div className={`h-full ${activeTab === "files" ? "block" : "hidden"}`}>
          <FileEditor />
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label, value, color, icon,
}: { label: string; value: string | number; color: string; icon: React.ReactNode }) {
  return (
    <div className="bg-card border border-card-border rounded-lg p-3 space-y-1">
      <div className={`flex items-center gap-1.5 text-xs text-muted-foreground ${color}`}>
        {icon}<span>{label}</span>
      </div>
      <p className={`text-xl font-bold ${color}`}>{value}</p>
    </div>
  );
}
