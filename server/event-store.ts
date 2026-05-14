import fs from "fs";
import path from "path";

const DATA_DIR = path.resolve(process.cwd(), "data");
const STORE_PATH = path.join(DATA_DIR, "events.json");
const MAX_EVENTS = 20; // maksimum saklanacak event sayısı

type StoredEvent = {
  id: number;
  type: string;
  data: any;
  timestamp: number;
};

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadStore(): { lastId: number; events: StoredEvent[] } {
  try {
    ensureDir();
    if (!fs.existsSync(STORE_PATH)) return { lastId: 0, events: [] };
    const raw = fs.readFileSync(STORE_PATH, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    console.error("events.json okunamadı, sıfırlanıyor:", (err as Error).message);
    return { lastId: 0, events: [] };
  }
}

function saveStore(store: { lastId: number; events: StoredEvent[] }) {
  ensureDir();
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), "utf-8");
}

export class EventStore {
  private store: { lastId: number; events: StoredEvent[] };

  constructor() {
    this.store = loadStore();
  }

  // Yeni event ekle, entry döndür
  append(type: string, data: any) {
    const entry: StoredEvent = {
      id: ++this.store.lastId,
      type,
      data,
      timestamp: Date.now(),
    };
    this.store.events.push(entry);

    // Retention: sadece son MAX_EVENTS kadarını sakla
    if (this.store.events.length > MAX_EVENTS) {
      this.store.events = this.store.events.slice(-MAX_EVENTS);
    }

    saveStore(this.store);
    return entry;
  }

  // afterId'den büyük eventleri sırayla döndür
  getAfter(afterId = 0, limit = 1000) {
    return this.store.events.filter((e) => e.id > afterId).slice(0, limit);
  }
}
