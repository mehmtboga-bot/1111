import fs from "fs";
import path from "path";

const SECRETS_PATH = path.resolve(process.cwd(), "data", "secrets.json");

interface Secrets {
  HELIUS_API_KEY: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
  TRADER_PRIVATE_KEY: string;
}

const DEFAULT_SECRETS: Secrets = {
  HELIUS_API_KEY: process.env.HELIUS_API_KEY || "",
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || "",
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID || "",
  TRADER_PRIVATE_KEY: process.env.TRADER_PRIVATE_KEY || "",
};

function loadSecrets(): Secrets {
  try {
    if (fs.existsSync(SECRETS_PATH)) {
      const raw = fs.readFileSync(SECRETS_PATH, "utf-8");
      const parsed = JSON.parse(raw) as Secrets;
      return { ...DEFAULT_SECRETS, ...parsed };
    }
  } catch (err) {
    console.warn("⚠️ secrets.json okunamadı, env vars kullanılıyor");
  }
  return DEFAULT_SECRETS;
}

function saveSecrets(secrets: Partial<Secrets>): void {
  const current = loadSecrets();
  const updated = { ...current, ...secrets };
  try {
    const dir = path.dirname(SECRETS_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(SECRETS_PATH, JSON.stringify(updated, null, 2), "utf-8");
  } catch (err) {
    console.error("❌ secrets.json yazılamadı:", (err as Error).message);
    throw err;
  }
}

export const secrets = loadSecrets();
export { saveSecrets };
