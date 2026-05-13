import { useState } from "react";
import { ExternalLink, Copy, Check, Lock, Unlock, Droplet, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CountdownTimer } from "./CountdownTimer";
import type { LPDetection } from "@shared/schema";

interface LPLogTableProps {
  logs: LPDetection[];
  filter?: "all" | "locked";
  solPrice?: number;
  emptyMessage?: string;
  traderReady?: boolean;
  activeBuyMints?: Set<string>;
  onBuy?: (mintAddress: string, name: string, symbol: string) => void;
}

export function LPLogTable({
  logs,
  filter = "all",
  solPrice,
  emptyMessage,
  traderReady = false,
  activeBuyMints,
  onBuy,
}: LPLogTableProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copyAddress = async (address: string, id: string) => {
    await navigator.clipboard.writeText(address);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const truncateAddress = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-6)}`;

  const getRelativeTime = (timestamp: number) => {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return `${seconds}s önce`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes}dk önce`;
  };

  const filteredLogs = filter === "locked" ? logs.filter((l) => l.isLocked) : logs;

  if (filteredLogs.length === 0) {
    return (
      <div className="text-center py-10 text-muted-foreground" data-testid="text-empty-state">
        <Droplet className="h-8 w-8 mx-auto mb-2 opacity-40" />
        <p className="text-sm">{emptyMessage ?? "LP tespiti bekleniyor..."}</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {filteredLogs.map((log, index) => (
        <div
          key={log.id}
          className={`bg-card border rounded-lg p-3 hover-elevate transition-all ${
            index === 0 ? "animate-in slide-in-from-top-1" : ""
          } ${log.isLocked ? "border-emerald-500/40 bg-emerald-950/10" : "border-card-border"}`}
          data-testid={`row-lp-${log.id}`}
        >
          <div className="flex flex-col sm:flex-row sm:items-start gap-2">
            <div className="flex-1 min-w-0 space-y-1.5">
              {/* Token adı + kilit durumu + platform + likidite */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-foreground text-sm" data-testid="text-lp-name">
                  {log.name}
                </span>
                <span className="text-sm font-medium text-muted-foreground" data-testid="text-lp-symbol">
                  {log.symbol}
                </span>

                {log.isLocked ? (
                  <Badge className="gap-1 bg-emerald-500/15 text-emerald-400 border border-emerald-500/40 text-xs font-semibold" data-testid="badge-lp-locked">
                    <Lock className="h-3 w-3" />
                    Kilitli {log.lockDuration && `· ${log.lockDuration}`}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="gap-1 border-muted-foreground/30 text-muted-foreground/60 text-xs" data-testid="badge-lp-unlocked">
                    <Unlock className="h-3 w-3" />
                    Kilitsiz
                  </Badge>
                )}

                {log.platform && (
                  <Badge variant="secondary" className="text-xs" data-testid="badge-lp-platform">
                    {log.platform}
                  </Badge>
                )}

                {log.liquidityAmount !== undefined && log.liquidityAmount > 0 && (
                  <Badge className="gap-1 bg-chart-4/15 text-chart-4 border border-chart-4/30 text-xs" data-testid="badge-lp-liquidity">
                    <Droplet className="h-3 w-3" />
                    {solPrice != null
                      ? `$${(2 * log.liquidityAmount * solPrice).toLocaleString("en-US", { maximumFractionDigits: 0 })}`
                      : `${log.liquidityAmount.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 4 })} SOL`
                    }
                  </Badge>
                )}

                <span className="text-xs text-muted-foreground ml-auto" data-testid="text-lp-time">
                  {getRelativeTime(log.detectedAt)}
                </span>
              </div>

              {/* Adres + kopyala */}
              <div className="flex items-center gap-1.5">
                <code
                  className="text-xs font-mono text-muted-foreground bg-muted px-2 py-0.5 rounded"
                  data-testid="text-lp-address"
                >
                  {truncateAddress(log.mintAddress)}
                </code>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => copyAddress(log.mintAddress, log.id)}
                  className="h-6 w-6"
                  data-testid="button-copy-lp-address"
                >
                  {copiedId === log.id ? (
                    <Check className="h-3 w-3 text-chart-4" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                </Button>

                {/* Bağlantılar */}
                <div className="flex gap-1 ml-1">
                  {log.pumpfunUrl && (
                    <Button size="sm" variant="ghost" asChild className="h-6 px-1.5 text-xs" data-testid="button-lp-pumpfun">
                      <a href={log.pumpfunUrl} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="h-3 w-3 mr-1" />
                        Pump
                      </a>
                    </Button>
                  )}
                  {log.jupiterUrl && (
                    <Button size="sm" variant="ghost" asChild className="h-6 px-1.5 text-xs" data-testid="button-lp-jupiter">
                      <a href={log.jupiterUrl} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="h-3 w-3 mr-1" />
                        Jupiter
                      </a>
                    </Button>
                  )}
                  {log.dexscreenerUrl && (
                    <Button size="sm" variant="ghost" asChild className="h-6 px-1.5 text-xs" data-testid="button-lp-dex">
                      <a href={log.dexscreenerUrl} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="h-3 w-3 mr-1" />
                        Dex
                      </a>
                    </Button>
                  )}
                </div>
              </div>
            </div>

            <div className="shrink-0 flex items-center gap-2">
              {onBuy && (
                <Button
                  size="sm"
                  variant="default"
                  className="h-7 px-2.5 text-xs"
                  disabled={!traderReady || activeBuyMints?.has(log.mintAddress)}
                  onClick={() => onBuy(log.mintAddress, log.name, log.symbol)}
                  data-testid={`button-lp-buy-${log.id}`}
                  title={!traderReady ? "Trader cüzdanı tanımlı değil" : activeBuyMints?.has(log.mintAddress) ? "Bu token zaten portföyde" : "Otomatik alım yap"}
                >
                  <Zap className="h-3 w-3 mr-1" />
                  {activeBuyMints?.has(log.mintAddress) ? "Var" : "Al"}
                </Button>
              )}
              <CountdownTimer detectedAt={log.detectedAt} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
