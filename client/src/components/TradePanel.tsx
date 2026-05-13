import { useMemo, useState } from "react";
import { ExternalLink, Copy, Check, TrendingUp, TrendingDown, Wallet, Settings, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Position, TradeConfig } from "@shared/schema";

type Filter = "all" | "open" | "closed";

interface TradePanelProps {
  positions: Position[];
  config: TradeConfig;
  traderPublicKey?: string;
  traderReady: boolean;
  solPriceUsd: number;
  onSell: (positionId: string) => void;
  onDelete: (positionId: string) => void;
  onUpdateConfig: (cfg: Partial<TradeConfig>) => void;
}

// USD fiyatını okunaklı formatla. Çok küçükse 4 anlamlı basamak göster.
const formatUsd = (n?: number) => {
  if (n === undefined || n === null || Number.isNaN(n) || n <= 0) return "—";
  if (n >= 1) return `$${n.toLocaleString("tr-TR", { maximumFractionDigits: 2 })}`;
  if (n >= 0.01) return `$${n.toFixed(4)}`;
  if (n >= 0.0001) return `$${n.toFixed(6)}`;
  const log = Math.floor(Math.log10(n));
  const decimals = Math.min(18, Math.abs(log) + 4);
  return `$${n.toFixed(decimals).replace(/0+$/, "").replace(/\.$/, "")}`;
};

const truncate = (addr?: string) =>
  addr ? `${addr.slice(0, 4)}...${addr.slice(-4)}` : "—";

const formatTime = (ts?: number) => {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
};

const formatNumber = (n?: number, digits = 4) =>
  n === undefined || n === null || Number.isNaN(n) ? "—" : n.toLocaleString("tr-TR", { maximumFractionDigits: digits });

// Çok küçük sayıları bilimsel gösterim yerine okunaklı ondalık olarak gösterir.
// Örn 7.012e-7 → "0.0000007012". 0.005 → "0.005000".
const formatPrice = (n?: number) => {
  if (n === undefined || n === null || Number.isNaN(n) || n <= 0) return "—";
  if (n >= 0.001) return n.toFixed(6);
  // <0.001 için en az 4 anlamlı basamak
  const log = Math.floor(Math.log10(n));
  const decimals = Math.min(18, Math.abs(log) + 4);
  return n.toFixed(decimals).replace(/0+$/, "").replace(/\.$/, "");
};

// Büyük token sayılarını M/K ile özetler (1.234.567 → "1.23M")
const formatCompact = (n?: number) => {
  if (n === undefined || n === null || Number.isNaN(n)) return "—";
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(2)}K`;
  return n.toLocaleString("tr-TR", { maximumFractionDigits: 2 });
};

export function TradePanel({
  positions,
  config,
  traderPublicKey,
  traderReady,
  solPriceUsd,
  onSell,
  onDelete,
  onUpdateConfig,
}: TradePanelProps) {
  const [filter, setFilter] = useState<Filter>("all");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [solAmountInput, setSolAmountInput] = useState(String(config.solAmount));
  const [slippageInput, setSlippageInput] = useState(String(config.slippageBps));
  const [priorityInput, setPriorityInput] = useState(String(config.priorityFeeMicroLamports));

  const copyAddress = async (address: string, id: string) => {
    await navigator.clipboard.writeText(address);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const filtered = useMemo(() => {
    if (filter === "open") return positions.filter((p) => p.status === "open" || p.status === "pending_buy" || p.status === "pending_sell");
    if (filter === "closed") return positions.filter((p) => p.status === "closed" || p.status === "failed");
    return positions;
  }, [positions, filter]);

  const stats = useMemo(() => {
    const open = positions.filter((p) => p.status === "open" || p.status === "pending_sell");
    const closed = positions.filter((p) => p.status === "closed");
    const totalSpent = open.reduce((s, p) => s + p.buySolAmount, 0);
    const realized = closed.reduce((s, p) => s + (p.pnlSol ?? 0), 0);
    return { openCount: open.length, closedCount: closed.length, totalSpent, realized };
  }, [positions]);

  const saveConfig = () => {
    const sol = parseFloat(solAmountInput);
    const slip = parseInt(slippageInput, 10);
    const prio = parseInt(priorityInput, 10);
    const partial: Partial<TradeConfig> = {};
    if (!Number.isNaN(sol) && sol > 0) partial.solAmount = sol;
    if (!Number.isNaN(slip) && slip >= 50 && slip <= 10000) partial.slippageBps = slip;
    if (!Number.isNaN(prio) && prio >= 0) partial.priorityFeeMicroLamports = prio;
    if (Object.keys(partial).length) onUpdateConfig(partial);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      {/* Üst Bilgi: Cüzdan + İstatistikler */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Wallet className="h-5 w-5 text-primary" />
            <h2 className="text-base font-semibold">Trader Cüzdanı</h2>
            {traderReady ? (
              <Badge className="bg-emerald-500/15 text-emerald-400 border border-emerald-500/40">Aktif</Badge>
            ) : (
              <Badge className="bg-destructive/15 text-destructive border border-destructive/40">Devre Dışı</Badge>
            )}
          </div>
          {traderReady && traderPublicKey ? (
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs font-mono text-muted-foreground bg-muted px-2 py-1.5 rounded-md truncate" data-testid="text-trader-pubkey">
                {traderPublicKey}
              </code>
              <Button size="icon" variant="ghost" onClick={() => copyAddress(traderPublicKey, "pubkey")} className="h-8 w-8 shrink-0">
                {copiedId === "pubkey" ? <Check className="h-4 w-4 text-chart-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
          ) : (
            <div className="flex items-start gap-2 text-sm text-muted-foreground">
              <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
              <span>TRADER_PRIVATE_KEY tanımlı değil veya geçersiz. Otomatik alım/satım için Replit Secrets üzerinden geçerli bir base58 anahtar ekleyin.</span>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3 pt-1">
            <Stat label="Açık Pozisyon" value={stats.openCount} color="text-primary" />
            <Stat label="Kapanan" value={stats.closedCount} color="text-chart-2" />
            <Stat
              label="Toplam Yatırım"
              value={`${stats.totalSpent.toFixed(4)} SOL`}
              sub={solPriceUsd > 0 ? formatUsd(stats.totalSpent * solPriceUsd) : undefined}
              color="text-chart-4"
            />
            <Stat
              label="Realize PnL"
              value={`${stats.realized >= 0 ? "+" : ""}${stats.realized.toFixed(4)} SOL`}
              sub={solPriceUsd > 0 ? `${stats.realized >= 0 ? "+" : ""}${formatUsd(Math.abs(stats.realized) * solPriceUsd)}` : undefined}
              color={stats.realized >= 0 ? "text-emerald-400" : "text-destructive"}
            />
          </div>
        </Card>

        <Card className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Settings className="h-5 w-5 text-chart-2" />
            <h2 className="text-base font-semibold">Trade Ayarları</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label htmlFor="sol-amount" className="text-xs">İşlem Başına SOL</Label>
              <Input
                id="sol-amount"
                type="number"
                step="0.01"
                min="0.0001"
                value={solAmountInput}
                onChange={(e) => setSolAmountInput(e.target.value)}
                data-testid="input-sol-amount"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="slippage" className="text-xs">Slippage (bps)</Label>
              <Input
                id="slippage"
                type="number"
                step="50"
                min="50"
                max="50000"
                value={slippageInput}
                onChange={(e) => setSlippageInput(e.target.value)}
                data-testid="input-slippage"
              />
              <p className="text-[10px] text-muted-foreground">500000 = %5000 (yüksek slippage işlemi geçirir)</p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="priority" className="text-xs">Priority Fee (µLamports)</Label>
              <Input
                id="priority"
                type="number"
                step="10000"
                min="0"
                value={priorityInput}
                onChange={(e) => setPriorityInput(e.target.value)}
                data-testid="input-priority"
              />
            </div>
          </div>
          <Button onClick={saveConfig} className="w-full" data-testid="button-save-config">
            Ayarları Kaydet
          </Button>
          <div className="text-xs text-muted-foreground">
            Mevcut: {config.solAmount} SOL · {config.slippageBps} bps (%{(config.slippageBps / 100).toFixed(1)}) · {config.priorityFeeMicroLamports.toLocaleString()} µLamports
          </div>
        </Card>
      </div>

      {/* Filtre */}
      <div className="flex items-center gap-2 flex-wrap">
        <h2 className="text-base font-semibold mr-2">Pozisyonlar</h2>
        {(["all", "open", "closed"] as Filter[]).map((f) => (
          <Button
            key={f}
            variant={filter === f ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter(f)}
            data-testid={`button-filter-${f}`}
          >
            {f === "all" ? "Tümü" : f === "open" ? `Açık (${stats.openCount})` : `Kapanan (${stats.closedCount})`}
          </Button>
        ))}
      </div>

      {/* Pozisyon Listesi */}
      {filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Wallet className="h-10 w-10 mx-auto mb-2 opacity-40" />
          <p className="text-sm">Henüz pozisyon yok. Dashboard'daki "Al" butonuyla işlem başlatın.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((p) => (
            <PositionRow
              key={p.id}
              position={p}
              copiedId={copiedId}
              solPriceUsd={solPriceUsd}
              onCopy={copyAddress}
              onSell={onSell}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color, sub }: { label: string; value: string | number; color: string; sub?: string }) {
  return (
    <div className="bg-muted/30 rounded-md px-3 py-2">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className={`text-sm font-bold ${color}`}>{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground/70 font-mono">{sub}</p>}
    </div>
  );
}

interface PositionRowProps {
  position: Position;
  copiedId: string | null;
  solPriceUsd: number;
  onCopy: (addr: string, id: string) => void;
  onSell: (positionId: string) => void;
  onDelete: (positionId: string) => void;
}

function PositionRow({ position: p, copiedId, solPriceUsd, onCopy, onSell, onDelete }: PositionRowProps) {
  const isOpen = p.status === "open";
  const isPending = p.status === "pending_buy" || p.status === "pending_sell";
  const pnlPositive = (p.pnlSol ?? 0) >= 0;

  return (
    <div
      className={`bg-card border rounded-lg p-3 ${
        p.status === "closed"
          ? pnlPositive
            ? "border-emerald-500/30"
            : "border-destructive/30"
          : p.status === "failed"
          ? "border-destructive/40"
          : isOpen
          ? "border-primary/40"
          : "border-card-border"
      }`}
      data-testid={`row-position-${p.id}`}
    >
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm" data-testid="text-pos-name">{p.name}</span>
            <span className="text-xs text-muted-foreground">{p.symbol}</span>
            <StatusBadge status={p.status} />
            {p.status === "closed" && p.pnlSol !== undefined && (
              <Badge
                className={`text-xs gap-1 ${
                  pnlPositive
                    ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/40"
                    : "bg-destructive/15 text-destructive border border-destructive/40"
                }`}
              >
                {pnlPositive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                {pnlPositive ? "+" : ""}
                {p.pnlSol.toFixed(4)} SOL ({p.pnlPct?.toFixed(1)}%)
              </Badge>
            )}
            <span className="text-[10px] text-muted-foreground ml-auto">{formatTime(p.buyTimestamp)}</span>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            <code className="text-[11px] font-mono text-muted-foreground bg-muted px-2 py-0.5 rounded">
              {truncate(p.mintAddress)}
            </code>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => onCopy(p.mintAddress, p.id)}
              className="h-6 w-6"
              data-testid="button-copy-pos-address"
            >
              {copiedId === p.id ? <Check className="h-3 w-3 text-chart-4" /> : <Copy className="h-3 w-3" />}
            </Button>
            <Button size="sm" variant="ghost" asChild className="h-6 px-1.5 text-xs">
              <a href={`https://dexscreener.com/solana/${p.mintAddress}`} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-3 w-3 mr-1" /> Dex
              </a>
            </Button>
            <Button size="sm" variant="ghost" asChild className="h-6 px-1.5 text-xs">
              <a href={`https://jup.ag/swap/SOL-${p.mintAddress}`} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-3 w-3 mr-1" /> Jup
              </a>
            </Button>
            {p.buyTxSignature && (
              <Button size="sm" variant="ghost" asChild className="h-6 px-1.5 text-xs">
                <a href={`https://solscan.io/tx/${p.buyTxSignature}`} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-3 w-3 mr-1" /> Buy
                </a>
              </Button>
            )}
            {p.sellTxSignature && (
              <Button size="sm" variant="ghost" asChild className="h-6 px-1.5 text-xs">
                <a href={`https://solscan.io/tx/${p.sellTxSignature}`} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-3 w-3 mr-1" /> Sell
                </a>
              </Button>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] pt-1">
            <Cell
              label="Harcanan"
              value={`${p.buySolAmount.toFixed(4)} SOL`}
              sub={solPriceUsd > 0 ? formatUsd(p.buySolAmount * solPriceUsd) : undefined}
            />
            <Cell
              label="Alınan Token"
              value={p.buyTokenAmount ? `${formatCompact(p.buyTokenAmount)} ${p.symbol}` : "—"}
              sub={p.buyTokenAmount ? formatNumber(p.buyTokenAmount, 4) : undefined}
            />
            <Cell
              label={isOpen && p.currentPriceUsd ? "Şu Anki Fiyat" : "Alım Fiyatı"}
              value={
                isOpen && p.currentPriceUsd
                  ? formatUsd(p.currentPriceUsd)
                  : solPriceUsd > 0 && p.buyPriceSol
                    ? formatUsd(p.buyPriceSol * solPriceUsd)
                    : `${formatPrice(p.buyPriceSol)} SOL`
              }
              sub={
                isOpen && p.currentPriceUsd && p.buyPriceSol
                  ? `Aldığın: ${formatUsd(p.buyPriceSol * solPriceUsd)}`
                  : solPriceUsd > 0 && p.buyPriceSol
                    ? `${formatPrice(p.buyPriceSol)} SOL`
                    : undefined
              }
            />
            <Cell
              label={isOpen && p.unrealizedPnlSol !== undefined ? "Unrealized PnL" : "Satış Fiyatı"}
              value={
                isOpen && p.unrealizedPnlSol !== undefined
                  ? `${p.unrealizedPnlSol >= 0 ? "+" : ""}${formatUsd(Math.abs(p.unrealizedPnlSol * solPriceUsd))}`
                  : p.sellPriceSol
                    ? solPriceUsd > 0
                      ? formatUsd(p.sellPriceSol * solPriceUsd)
                      : `${formatPrice(p.sellPriceSol)} SOL`
                    : "—"
              }
              sub={
                isOpen && p.unrealizedPnlPct !== undefined
                  ? `${p.unrealizedPnlPct >= 0 ? "+" : ""}${p.unrealizedPnlPct.toFixed(1)}%`
                  : p.sellPriceSol
                    ? `${formatPrice(p.sellPriceSol)} SOL${
                        p.sellSolAmount
                          ? ` · ${p.sellSolAmount.toFixed(4)} SOL${solPriceUsd > 0 ? ` (${formatUsd(p.sellSolAmount * solPriceUsd)})` : ""}`
                          : ""
                      }`
                    : undefined
              }
            />
          </div>

          {p.error && (
            <div className="text-[11px] text-destructive bg-destructive/10 rounded px-2 py-1">
              ⚠️ {p.error}
            </div>
          )}
        </div>

        <div className="shrink-0 flex gap-2">
          {isOpen && (
            <Button
              size="sm"
              variant="destructive"
              onClick={() => onSell(p.id)}
              data-testid={`button-sell-${p.id}`}
            >
              Sat
            </Button>
          )}
          {isPending && (
            <Button size="sm" variant="outline" disabled>
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              {p.status === "pending_buy" ? "Alınıyor" : "Satılıyor"}
            </Button>
          )}
          <Button
            size="icon"
            variant="ghost"
            onClick={() => {
              if (isPending) {
                const msg = p.status === "pending_buy" ? "Alım iptal edilecek" : "Satış iptal edilecek";
                if (confirm(`${msg}, emin misin?`)) onDelete(p.id);
              } else {
                onDelete(p.id);
              }
            }}
            className="h-8 w-8 text-destructive/60 hover:text-destructive"
            title={isPending ? "İşlemi iptal edip sil" : "Pozisyonu sil"}
          >
            ✕
          </Button>
        </div>
      </div>
    </div>
  );
}

function Cell({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-muted/30 rounded px-2 py-1">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className="font-mono">{value}</p>
      {sub && <p className="text-[9px] text-muted-foreground/70 font-mono truncate" title={sub}>{sub}</p>}
    </div>
  );
}

function StatusBadge({ status }: { status: Position["status"] }) {
  const map: Record<Position["status"], { label: string; cls: string }> = {
    pending_buy: { label: "Alınıyor", cls: "bg-primary/15 text-primary border border-primary/40" },
    open: { label: "Açık", cls: "bg-chart-4/15 text-chart-4 border border-chart-4/40" },
    pending_sell: { label: "Satılıyor", cls: "bg-primary/15 text-primary border border-primary/40" },
    closed: { label: "Kapandı", cls: "bg-muted text-muted-foreground border border-muted-foreground/30" },
    failed: { label: "Başarısız", cls: "bg-destructive/15 text-destructive border border-destructive/40" },
  };
  const cfg = map[status];
  return <Badge className={`text-xs ${cfg.cls}`}>{cfg.label}</Badge>;
}
