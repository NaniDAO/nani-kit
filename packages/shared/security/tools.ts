/**
 * This code uses data from scamsniffer/scam-database
 * Repository: https://github.com/scamsniffer/scam-database
 * License: GNU General Public License v3.0
 * Copyright (c) ScamSniffer
 *
 * Note: The data is updated daily but has a 7-day delay from real-time data
 * to balance between providing free resources and protecting data integrity.
 */
import { createTool } from "../client.js";
import { z } from "zod";
import { assertOkResponse } from "../utils/fetch.js";

// Deliberately not declared: these tools are chain-agnostic, and leaving
// supportedChains undefined is how that is expressed. An empty array used to
// be read as "supports no chain", so a stray chainId was rejected outright.

function normalizeUrl(url: string): string {
  try {
    const urlObj = new URL(url.toLowerCase());
    return urlObj.hostname.replace(/^www\./, "");
  } catch {
    // If URL parsing fails, try basic string manipulation
    const normalized = url
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split("/")[0];
    return normalized || "";
  }
}

// Cache configuration
let addressBlacklist: string[] | null = null;
let domainBlacklist: string[] | null = null;
let lastAddressFetch = 0;
let lastDomainFetch = 0;
const CACHE_DURATION = 1000 * 60 * 60 * 24; // 24 hours to match daily updates

const BLACKLIST_BASE =
  "https://raw.githubusercontent.com/scamsniffer/scam-database/refs/heads/main/blacklist";
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Fetch one blacklist. The status check matters more here than elsewhere: the
 * result is cached for 24 hours, so without it a 404 page or a rate-limit body
 * was parsed as the blacklist and every address looked clean for a day.
 */
async function fetchBlacklist(name: "address" | "domains"): Promise<string[]> {
  const url = `${BLACKLIST_BASE}/${name}.json`;
  const response = await fetch(url, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  await assertOkResponse(response, `Failed to fetch ScamSniffer ${name} blacklist`);
  const list = await response.json();
  if (!Array.isArray(list)) {
    throw new Error(
      `ScamSniffer ${name} blacklist at ${url} was not a JSON array; refusing to cache it.`,
    );
  }
  return list;
}

async function getAddressBlacklist() {
  const now = Date.now();
  if (!addressBlacklist || now - lastAddressFetch > CACHE_DURATION) {
    addressBlacklist = await fetchBlacklist("address");
    lastAddressFetch = now;
  }
  return addressBlacklist;
}

async function getDomainBlacklist() {
  const now = Date.now();
  if (!domainBlacklist || now - lastDomainFetch > CACHE_DURATION) {
    domainBlacklist = await fetchBlacklist("domains");
    lastDomainFetch = now;
  }
  return domainBlacklist;
}

export const checkMaliciousAddress = createTool({
  name: "checkMaliciousAddress",
  description:
    "Check if an Ethereum address has been flagged as malicious in the ScamSniffer blacklist database. Returns whether the address is known to be associated with scams or exploits.",
  parameters: z.object({
    address: z.string().describe("The Ethereum address to check (0x...)"),
  }),
  execute: async (_client, args) => {
    const blacklist = await getAddressBlacklist();
    if (!blacklist) {
      throw new Error("Failed to fetch address blacklist");
    }

    return {
      address: args.address,
      isMalicious: blacklist.includes(args.address.toLowerCase()),
    };
  },
});

export const checkMaliciousWebsite = createTool({
  name: "checkMaliciousWebsite",
  description:
    "Check if a website domain has been flagged in the ScamSniffer blacklist as associated with crypto scams, phishing, or malicious activity.",
  parameters: z.object({
    website: z.string().describe("The website URL or domain to check (e.g. 'https://example.com' or 'example.com')"),
  }),
  execute: async (_client, args) => {
    const blacklist = await getDomainBlacklist();
    if (!blacklist) {
      throw new Error("Failed to fetch domain blacklist");
    }

    const formattedWebsite = normalizeUrl(args.website);

    return {
      website: args.website,
      isMalicious: blacklist.includes(formattedWebsite),
    };
  },
});
