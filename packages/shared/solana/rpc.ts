import { assertOkResponse } from "../utils/fetch.js";

let requestId = 0;

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

/**
 * Solana returns u64 fields (lamports, rentEpoch) as JSON numbers, which
 * JSON.parse silently rounds past 2^53 - a 10M SOL account would report the
 * wrong balance. Quote those literals so they survive as exact strings. The
 * scan is string-aware, so digits inside program logs are left alone.
 */
export function quoteUnsafeIntegers(json: string): string {
  let out = "";
  let i = 0;
  let inString = false;

  while (i < json.length) {
    const char = json[i];

    if (inString) {
      out += char;
      if (char === "\\") {
        out += json[i + 1] ?? "";
        i += 2;
        continue;
      }
      if (char === '"') inString = false;
      i++;
      continue;
    }

    if (char === '"') {
      inString = true;
      out += char;
      i++;
      continue;
    }

    const isNumberStart =
      (char >= "0" && char <= "9") ||
      (char === "-" && json[i + 1] >= "0" && json[i + 1] <= "9");

    if (isNumberStart) {
      let end = char === "-" ? i + 1 : i;
      while (end < json.length && json[end] >= "0" && json[end] <= "9") end++;

      const literal = json.slice(i, end);
      const next = json[end];
      // Leave floats and exponents alone - quoting them would change the type
      // of values like uiAmount that callers expect to be numbers.
      const isInteger = next !== "." && next !== "e" && next !== "E";
      const magnitude = BigInt(char === "-" ? literal.slice(1) : literal);

      out += isInteger && magnitude > MAX_SAFE ? `"${literal}"` : literal;
      i = end;
      continue;
    }

    out += char;
    i++;
  }

  return out;
}

/**
 * Minimal Solana JSON-RPC caller. The read tools go through this rather than
 * @solana/web3.js so they stay dependency-free and return the raw RPC shape.
 */
export async function solanaRpc<T = any>(
  rpcUrl: string,
  method: string,
  params: unknown[] = [],
): Promise<T> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    // RPC state is only trusted from the endpoint the user configured. Do not
    // let a redirect silently substitute a different node or receive a URL
    // credential embedded in a private provider endpoint.
    redirect: "error",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++requestId, method, params }),
  });

  await assertOkResponse(response, `Solana RPC ${method} failed`);

  const body = JSON.parse(quoteUnsafeIntegers(await response.text())) as {
    result?: T;
    error?: { code: number; message: string };
  };

  if (body.error) {
    throw new Error(
      `Solana RPC ${method} failed: ${body.error.message} (code ${body.error.code})`,
    );
  }

  return body.result as T;
}
