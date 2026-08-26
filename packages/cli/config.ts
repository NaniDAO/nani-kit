import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ── Known keys ──────────────────────────────────────────────────────────────

export interface KnownKey {
  name: string;
  description: string;
}

export const KNOWN_KEYS: KnownKey[] = [
  { name: "PRIVATE_KEY", description: "Hex-encoded private key for signing transactions" },
  { name: "ACCOUNT", description: "Hex address to use as the sender (read-only)" },
  { name: "SOLANA_PRIVATE_KEY", description: "Base58 or JSON-array Solana secret key for signing Solana transactions" },
  { name: "SOLANA_ACCOUNT", description: "Base58 Solana address to use as the sender (read-only)" },
  { name: "SOLANA_RPC_URL", description: "Solana JSON-RPC endpoint (defaults to the public mainnet-beta endpoint)" },
  { name: "PERPLEXITY_API_KEY", description: "Perplexity AI search tools" },
  { name: "ZEROX_API_KEY", description: "0x swap/quote tools" },
  { name: "TALLY_API_KEY", description: "Tally governance tools" },
  { name: "COINDESK_API_KEY", description: "CoinDesk news/data tools" },
  { name: "COINMARKETCAL_API_KEY", description: "CoinMarketCal event tools" },
  { name: "FIREWORKS_API_KEY", description: "Fireworks AI tools" },
  { name: "PINATA_JWT", description: "Pinata IPFS tools" },
  { name: "X_BEARER_TOKEN", description: "X/Twitter read tools (Bearer token)" },
  { name: "X_API_KEY", description: "X/Twitter OAuth application key" },
  { name: "X_API_KEY_SECRET", description: "X/Twitter OAuth application secret" },
  { name: "X_ACCESS_TOKEN", description: "X/Twitter OAuth user access token" },
  { name: "X_ACCESS_TOKEN_SECRET", description: "X/Twitter OAuth user access token secret" },
];

const KNOWN_KEY_NAMES = new Set(KNOWN_KEYS.map((k) => k.name));

// ── Config file I/O ─────────────────────────────────────────────────────────

export interface AgentekConfig {
  version: number;
  keys: Record<string, string>;
}

function defaultConfig(): AgentekConfig {
  return { version: 1, keys: {} };
}

export function getConfigDir(): string {
  return process.env.AGENTEK_CONFIG_DIR || join(homedir(), ".agentek");
}

export function getConfigPath(): string {
  return join(getConfigDir(), "config.json");
}

export function readConfig(): AgentekConfig {
  const configPath = getConfigPath();
  if (!existsSync(configPath)) return defaultConfig();
  try {
    const raw = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return defaultConfig();
    return {
      version: typeof parsed.version === "number" ? parsed.version : 1,
      keys: typeof parsed.keys === "object" && parsed.keys !== null ? parsed.keys : {},
    };
  } catch {
    return defaultConfig();
  }
}

export function writeConfig(config: AgentekConfig): void {
  const dir = getConfigDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  const configPath = getConfigPath();
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  chmodSync(configPath, 0o600);
}

// ── Key resolution ──────────────────────────────────────────────────────────

export interface ResolvedKey {
  name: string;
  description: string;
  value: string | undefined;
  source: "env" | "config" | undefined;
}

export function resolveAllKeys(): ResolvedKey[] {
  const config = readConfig();
  return KNOWN_KEYS.map((k) => {
    const envVal = process.env[k.name];
    if (envVal !== undefined && envVal !== "") {
      return { name: k.name, description: k.description, value: envVal, source: "env" as const };
    }
    const cfgVal = config.keys[k.name];
    if (cfgVal !== undefined && cfgVal !== "") {
      return { name: k.name, description: k.description, value: cfgVal, source: "config" as const };
    }
    return { name: k.name, description: k.description, value: undefined, source: undefined };
  });
}

/** Resolve keys into a flat Record suitable for destructuring. */
export function resolveKeys(): Record<string, string | undefined> {
  const resolved = resolveAllKeys();
  const result: Record<string, string | undefined> = {};
  for (const r of resolved) {
    result[r.name] = r.value;
  }
  return result;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

export function isKnownKey(name: string): boolean {
  return KNOWN_KEY_NAMES.has(name);
}

export function redactValue(value: string): string {
  if (value.length <= 8) return "****";
  return value.slice(0, 4) + "..." + value.slice(-4);
}
