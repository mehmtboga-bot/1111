import fs from "fs";
import path from "path";
import type { Position, TradeConfig } from "@shared/schema";

const DATA_DIR = path.resolve(process.cwd(), "data");
const STORE_PATH = path.join(DATA_DIR, "trades.json");

const DEFAULT_CONFIG: TradeConfig = {
  solAmount: 0.01,
  slippageBps: 5000,
  priorityFeeMicroLamports: 200_000,
};

interface StoreData {
  positions: Position[];
  config: TradeConfig;
}

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function load(): StoreData {
  try {
    ensureDir();
    if (!fs.existsSync(STORE_PATH)) {
      return { positions: [], config: { ...DEFAULT_CONFIG } };
    }
    const raw = fs.readFileSync(STORE_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    return {
      positions: Array.isArray(parsed.positions) ? parsed.positions : [],
      config: { ...DEFAULT_CONFIG, ...(parsed.config || {}) },
    };
  } catch (err) {
    console.error("⚠️ trades.json okunamadı, sıfırlanıyor:", (err as Error).message);
    return { positions: [], config: { ...DEFAULT_CONFIG } };
  }
}

function save(data: StoreData) {
  ensureDir();
  fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2), "utf-8");
}

export class TradeStore {
  private data: StoreData;

  constructor() {
    this.data = load();
  }

  getAll(): Position[] {
    return [...this.data.positions];
  }

  getOpen(): Position[] {
    return this.data.positions.filter((p) => p.status === "open" || p.status === "pending_sell");
  }

  getByMint(mintAddress: string): Position | undefined {
    return this.data.positions.find(
      (p) => p.mintAddress === mintAddress && (p.status === "open" || p.status === "pending_buy" || p.status === "pending_sell"),
    );
  }

  getById(id: string): Position | undefined {
    return this.data.positions.find((p) => p.id === id);
  }

  delete(id: string): void {
    this.data.positions = this.data.positions.filter((p) => p.id !== id);
    save(this.data);
  }

  upsert(position: Position): Position {
    const idx = this.data.positions.findIndex((p) => p.id === position.id);
    if (idx >= 0) {
      this.data.positions[idx] = position;
    } else {
      this.data.positions.unshift(position);
    }
    this.pruneClosed();
    save(this.data);
    return position;
  }

  // Kapanan + Başarısız işlemlerden yalnızca en yeni MAX_CLOSED_HISTORY tanesini sakla
  private static MAX_CLOSED_HISTORY = 4;
  private pruneClosed() {
    const isClosed = (p: Position) => p.status === "closed" || p.status === "failed";
    // En yeni en üstte (unshift kullanıyoruz), buyTimestamp ile garantileyelim
    const closed = this.data.positions
      .filter(isClosed)
      .sort((a, b) => (b.buyTimestamp ?? 0) - (a.buyTimestamp ?? 0));
    const toKeep = new Set(closed.slice(0, TradeStore.MAX_CLOSED_HISTORY).map((p) => p.id));
    this.data.positions = this.data.positions.filter((p) => !isClosed(p) || toKeep.has(p.id));
  }

  getConfig(): TradeConfig {
    return { ...this.data.config };
  }

  updateConfig(partial: Partial<TradeConfig>): TradeConfig {
    this.data.config = { ...this.data.config, ...partial };
    save(this.data);
    return { ...this.data.config };
  }
}
