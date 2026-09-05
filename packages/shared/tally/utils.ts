import { TALLY_API_URL, TALLY_TIMEOUT_MS } from "./constants.js";

import { getAddress } from "viem";

export function parseCaip10(caip10: string) {
  const parts = caip10.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid CAIP‑10 format");
  }
  const [namespace, chainRef, accountAddress] = parts;
  if (namespace !== "eip155") {
    throw new Error("Only eip155 is supported in this app");
  }
  const chainId = Number(chainRef);
  if (isNaN(chainId)) {
    throw new Error("Chain reference is not a valid number");
  }
  if (!accountAddress) {
    throw new Error("Missing address in CAIP‑10 format");
  }
  const address = getAddress(accountAddress);
  return { namespace, chainId, address };
}

export async function getGovernorBySlug(slug: string, tallyApiKey: string) {
  // Handle arbitrum slug special case
  if (slug === "arbitrum") {
    slug = "arbitrum-core";
  }

  const getGovernorQuery = `
    query GetGovernorBySlug($slug: String!) {
      governor(input: { slug: $slug }) {
        id
        name
        type
      }
    }
  `;

  const governorResponse = await fetch(TALLY_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Api-Key": tallyApiKey,
    },
    signal: AbortSignal.timeout(TALLY_TIMEOUT_MS),
    body: JSON.stringify({
      query: getGovernorQuery,
      variables: { slug },
    }),
  });

  const governorResult = await governorResponse.json();
  if (governorResult.errors || !governorResult.data?.governor?.id) {
    throw new Error("DAO not supported");
  }

  return governorResult.data.governor;
}
