import { getConfigDir, resolveKeys } from "../config.js";

/** Structured error codes for agent-friendly error classification. */
export type ErrorCode =
  | "UNKNOWN_TOOL"
  | "MISSING_API_KEY"
  | "VALIDATION_ERROR"
  | "CHAIN_NOT_SUPPORTED"
  | "TIMEOUT"
  | "EXECUTION_ERROR"
  | "INVALID_ARGS";

/** JSON.stringify replacer that converts BigInt to string. */
export function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

/** Remove configured credentials and local config paths from error output. */
export function scrubSecrets(message: string): string {
  let scrubbed = message;
  const secrets = Object.entries(resolveKeys())
    .filter(
      (entry): entry is [string, string] =>
        Boolean(entry[1]?.length && entry[1].length >= 8),
    )
    .sort((a, b) => b[1].length - a[1].length);
  for (const [name, value] of secrets) {
    // Very short values produce noisy false positives and are not useful
    // credentials. Real private/API keys are substantially longer.
    scrubbed = scrubbed.replaceAll(value, `[REDACTED:${name}]`);
  }
  return scrubbed.replaceAll(getConfigDir(), "[CONFIG_DIR]");
}

/** Write JSON to stdout and exit 0. */
export function outputJson(data: unknown): never {
  process.stdout.write(JSON.stringify(data, bigintReplacer, 2) + "\n");
  process.exit(0);
}

/** Write JSON error to stderr and exit 1. */
export function outputError(
  msg: string,
  opts?: { code?: ErrorCode; hint?: string; retryable?: boolean },
): never {
  const payload: Record<string, unknown> = { error: scrubSecrets(msg) };
  if (opts?.code) payload.code = opts.code;
  if (opts?.hint) payload.hint = scrubSecrets(opts.hint);
  if (opts?.retryable !== undefined) payload.retryable = opts.retryable;
  process.stderr.write(JSON.stringify(payload) + "\n");
  process.exit(1);
}
