import { useState } from "react";
import { ExternalLink, Copy, Check, Lock, Unlock, Droplet, Zap } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CountdownTimer } from "./CountdownTimer";
import type { MintedToken } from "@shared/schema";

interface MintedTokenCardProps {
  token: MintedToken;
  isNew?: boolean;
  traderReady?: boolean;
  hasOpenPosition?: boolean;
  onBuy?: (mintAddress: string, name: string, symbol: string) => void;
}

export function MintedTokenCard({
  token,
  isNew = false,
  traderReady = false,
  hasOpenPosition = false,
  onBuy,
}: MintedTokenCardProps) {
  const [copied, setCopied] = useState(false);

  const copyAddress = async () => {
    await navigator.clipboard.writeText(token.mintAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const truncateAddress = (addr: string) => {
    return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
  };

  const raydiumUrl = `https://raydium.io/swap/?inputCurrency=sol&outputCurrency=${token.mintAddress}`;
  const jupiterUrl = `https://jup.ag/swap/SOL-${token.mintAddress}`;
  const dexscreenerUrl = `https://dexscreener.com/solana/${token.mintAddress}`;

  return (
    <Card
      className={`p-4 hover-elevate transition-all duration-300 ${
        isNew ? "animate-in slide-in-from-top-2 border-primary" : ""
      }`}
      data-testid={`card-token-${token.id}`}
    >
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-semibold text-foreground truncate" data-testid="text-token-name">
              {token.name}
            </h3>
            <div className="flex items-center gap-2 mt-1">
              <Badge
                className="bg-gradient-to-r from-primary to-chart-2 text-primary-foreground border-0"
                data-testid="badge-symbol"
              >
                {token.symbol}
              </Badge>
              {token.isLocked ? (
                <Badge variant="outline" className="gap-1 border-chart-2 text-chart-2 bg-chart-2/10" data-testid="badge-token-locked">
                  <Lock className="h-3 w-3" />
                  Kilitli {token.lockDuration && `(${token.lockDuration})`}
                </Badge>
              ) : (
                <Badge variant="outline" className="gap-1 border-destructive text-destructive bg-destructive/10" data-testid="badge-token-unlocked">
                  <Unlock className="h-3 w-3" />
                  Kilit Açık
                </Badge>
              )}
              {token.liquidityAmount !== undefined && (
                <Badge variant="secondary" className="bg-chart-4/10 text-chart-4 border-chart-4/20" data-testid="badge-token-liquidity">
                  <Droplet className="h-3 w-3 mr-1" />
                  {token.liquidityAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })} SOL
                </Badge>
              )}
            </div>
          </div>
          <CountdownTimer detectedAt={token.detectedAt} />
        </div>

        <div className="flex items-center gap-2">
          <code
            className="flex-1 text-xs font-mono text-muted-foreground bg-muted px-2 py-1.5 rounded-md truncate"
            data-testid="text-mint-address"
          >
            {truncateAddress(token.mintAddress)}
          </code>
          <Button
            size="icon"
            variant="ghost"
            onClick={copyAddress}
            className="h-8 w-8 shrink-0"
            data-testid="button-copy-address"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-chart-4" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>

        <div className="flex flex-wrap gap-2">
          {onBuy && (
            <Button
              size="sm"
              variant="default"
              disabled={!traderReady || hasOpenPosition}
              onClick={() => onBuy(token.mintAddress, token.name, token.symbol)}
              className="flex-1 min-w-[80px]"
              data-testid="button-buy-token"
              title={!traderReady ? "Trader cüzdanı tanımlı değil" : hasOpenPosition ? "Bu token zaten portföyde" : "Otomatik alım yap"}
            >
              <Zap className="h-3.5 w-3.5 mr-1.5" />
              {hasOpenPosition ? "Portföyde" : "Al"}
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            asChild
            className="flex-1 min-w-[80px]"
            data-testid="button-jupiter"
          >
            <a href={jupiterUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
              Jupiter
            </a>
          </Button>
          <Button
            size="sm"
            variant="outline"
            asChild
            className="flex-1 min-w-[80px]"
            data-testid="button-dexscreener"
          >
            <a href={dexscreenerUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
              Dex
            </a>
          </Button>
        </div>
      </div>
    </Card>
  );
}
