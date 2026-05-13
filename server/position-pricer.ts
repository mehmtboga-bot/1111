import { TradeStore } from "./trade-store";
import type { Position } from "@shared/schema";
import { secrets } from "./secrets-loader";

const JUP_PRICE_API = "https://lite-api.jup.ag/price/v3";
const SOL_MINT = "So11111111111111111111111111111111111111112";

export class PositionPricer {
  private store: TradeStore;
  private solPriceUsd: number = 0;
  private emit: (event: string, data: any) => void;
  private updateInterval: NodeJS.Timer | null = null;

  constructor(store: TradeStore, solPriceUsd: number, emit: (event: string, data: any) => void) {
    this.store = store;
    this.solPriceUsd = solPriceUsd;
    this.emit = emit;
  }

  setSolPrice(price: number) {
    this.solPriceUsd = price;
  }

  start() {
    if (this.updateInterval) return;
    this.updateInterval = setInterval(() => this.updatePrices(), 5000);
    this.updatePrices();
  }

  stop() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }

  private async updatePrices() {
    const positions = this.store.getAll();
    const openPositions = positions.filter((p) => p.status === "open" && p.buyTokenAmount && p.buyPriceSol);

    if (openPositions.length === 0) return;

    const mints = openPositions.map((p) => p.mintAddress).join(",");
    try {
      const res = await fetch(`${JUP_PRICE_API}?ids=${mints}`);
      const data = (await res.json()) as Record<string, { price: number }>;

      for (const pos of openPositions) {
        const priceData = data[pos.mintAddress];
        if (priceData && priceData.price > 0) {
          const currentPriceUsd = priceData.price;
          const unrealizedPnlSol = pos.buyTokenAmount! * (priceData.price / this.solPriceUsd - pos.buyPriceSol!);
          const unrealizedPnlPct =
            pos.buyPriceSol! > 0 ? ((priceData.price / this.solPriceUsd - pos.buyPriceSol!) / pos.buyPriceSol!) * 100 : 0;

          const updated = { ...pos, currentPriceUsd, unrealizedPnlSol, unrealizedPnlPct };
          this.store.upsert(updated);
          this.emit("position_update", updated);
        }
      }
    } catch (err) {
      // Sessiz hata, fiyat çekilmesi başarısız oldu
    }
  }
}
