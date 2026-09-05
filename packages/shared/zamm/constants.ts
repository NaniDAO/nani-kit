/**
 * ZAMM indexer. The Railway deployment this defaulted to now answers 404
 * "Application not found" for every path, REST and GraphQL alike, so all five
 * ZAMM tools returned nothing but "Failed to fetch …" — a message that reads
 * like "coin not found" rather than "the service is gone".
 *
 * Overridable so a redeployment doesn't need a new release of the tools, and
 * the errors below name the URL they actually called.
 */
export const ZAMM_API =
  (typeof process !== "undefined" ? process.env?.ZAMM_API_URL : undefined) ??
  "https://coinchan-indexer-production.up.railway.app";

export const ZAMM_TIMEOUT_MS = 15_000;

/** REST call against the indexer, with the URL named in any failure. */
export async function zammFetch(path: string): Promise<any> {
  const url = `${ZAMM_API}${path}`;
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(ZAMM_TIMEOUT_MS) });
  } catch (err) {
    throw new Error(
      `ZAMM indexer unreachable at ${url}: ${err instanceof Error ? err.message : String(err)}. Set ZAMM_API_URL to point at a live indexer.`,
    );
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      `ZAMM indexer returned ${res.status} for ${url}${json?.message ? ` — ${json.message}` : ""}. Set ZAMM_API_URL to point at a live indexer.`,
    );
  }
  return json;
}

/** GraphQL call against the indexer, surfacing both HTTP and GraphQL errors. */
export async function zammGraphql(query: string): Promise<any> {
  const url = `${ZAMM_API}/graphql`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(ZAMM_TIMEOUT_MS),
    });
  } catch (err) {
    throw new Error(
      `ZAMM indexer unreachable at ${url}: ${err instanceof Error ? err.message : String(err)}. Set ZAMM_API_URL to point at a live indexer.`,
    );
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      `ZAMM indexer returned ${res.status} for ${url}. Set ZAMM_API_URL to point at a live indexer.`,
    );
  }
  if (json?.errors?.length) {
    throw new Error(`ZAMM GraphQL error: ${JSON.stringify(json.errors)}`);
  }
  return json?.data;
}

export const isCoinchanCoin = (coinId: bigint) => {
  return coinId < 1000000n;
}
