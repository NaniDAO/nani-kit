import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { type Hex, http, isHex, zeroAddress } from "viem";
import { mainnet, optimism, arbitrum, polygon, base } from "viem/chains";
import { createAgentekClient, type BaseTool } from "@agentek/tools/client";
import { allTools } from "@agentek/tools";
import { privateKeyToAccount } from "viem/accounts";

const VERSION = "0.1.26";

/** Timeout for individual tool executions (2 minutes). */
const TOOL_TIMEOUT_MS = 120_000;

/** stderr logging — safe for stdio transport (never touches stdout). */
const log = (msg: string) => console.error(`[agentek-mcp] ${msg}`);

/** Wrap a promise with a timeout. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

async function main() {
  log("Starting...");

  // ── Environment ──────────────────────────────────────────────────────
  const PRIVATE_KEY = process.env.PRIVATE_KEY;
  const ACCOUNT = process.env.ACCOUNT;
  const SOLANA_PRIVATE_KEY = process.env.SOLANA_PRIVATE_KEY;
  const SOLANA_ACCOUNT = process.env.SOLANA_ACCOUNT;
  const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL;
  const JUPITER_API_KEY = process.env.JUPITER_API_KEY;
  const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;
  const ZEROX_API_KEY = process.env.ZEROX_API_KEY;
  const TALLY_API_KEY = process.env.TALLY_API_KEY;
  const COINDESK_API_KEY = process.env.COINDESK_API_KEY;
  const COINMARKETCAL_API_KEY = process.env.COINMARKETCAL_API_KEY;
  const FIREWORKS_API_KEY = process.env.FIREWORKS_API_KEY;
  const PINATA_JWT = process.env.PINATA_JWT;
  const X_BEARER_TOKEN = process.env.X_BEARER_TOKEN;
  const X_API_KEY = process.env.X_API_KEY;
  const X_API_KEY_SECRET = process.env.X_API_KEY_SECRET;

  if (PRIVATE_KEY && !isHex(PRIVATE_KEY)) {
    throw new Error("Invalid PRIVATE_KEY format, must be hex");
  }

  // ── Blockchain setup ─────────────────────────────────────────────────
  const chains = [mainnet, optimism, arbitrum, polygon, base];
  const transports = chains.map(() => http());
  const account = PRIVATE_KEY
    ? privateKeyToAccount(PRIVATE_KEY as Hex)
    : (ACCOUNT && isHex(ACCOUNT) ? ACCOUNT as Hex : zeroAddress);

  // ── Agentek client ───────────────────────────────────────────────────
  const agentekClient = createAgentekClient({
    transports,
    chains,
    accountOrAddress: account,
    solana: {
      rpcUrl: SOLANA_RPC_URL,
      privateKey: SOLANA_PRIVATE_KEY,
      address: SOLANA_ACCOUNT,
      jupiterApiKey: JUPITER_API_KEY,
    },
    tools: await allTools({
      perplexityApiKey: PERPLEXITY_API_KEY,
      zeroxApiKey: ZEROX_API_KEY,
      tallyApiKey: TALLY_API_KEY,
      coindeskApiKey: COINDESK_API_KEY,
      coinMarketCalApiKey: COINMARKETCAL_API_KEY,
      fireworksApiKey: FIREWORKS_API_KEY,
      pinataJWT: PINATA_JWT,
      xBearerToken: X_BEARER_TOKEN,
      xApiKey: X_API_KEY,
      xApiKeySecret: X_API_KEY_SECRET,
    }),
  });

  const toolsMap = agentekClient.getTools() as Map<string, BaseTool>;
  log(`${toolsMap.size} tools loaded`);

  // ── MCP Server (high-level API) ──────────────────────────────────────
  const server = new McpServer({
    name: "agentek-mcp-server",
    version: VERSION,
  });

  // Register each agentek tool as an MCP tool.
  // McpServer.registerTool handles:
  //   - Zod → JSON Schema conversion
  //   - Input validation
  //   - Error wrapping (returns isError:true instead of crashing)
  //   - Capability negotiation
  for (const [name, tool] of toolsMap) {
    // Extract the raw Zod shape from the tool's ZodObject for registerTool's inputSchema
    const zodShape = tool.parameters.shape;

    server.registerTool(
      name,
      {
        description: tool.description,
        inputSchema: zodShape,
      },
      async (args) => {
        const result = await withTimeout(
          agentekClient.execute(name, args),
          TOOL_TIMEOUT_MS,
          name,
        );

        const text = typeof result === "object"
          ? JSON.stringify(result, null, 2)
          : String(result);

        return { content: [{ type: "text" as const, text }] };
      },
    );
  }

  log(`${toolsMap.size} tools registered with MCP`);

  // ── Connect stdio transport ──────────────────────────────────────────
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("Connected on stdio");

  // Graceful shutdown when parent closes stdin
  process.stdin.on("close", async () => {
    log("stdin closed, shutting down");
    await server.close();
    process.exit(0);
  });
}

// ── Global safety nets ───────────────────────────────────────────────────
process.on("uncaughtException", (err) => {
  log(`Uncaught exception: ${err}`);
});
process.on("unhandledRejection", (reason) => {
  log(`Unhandled rejection: ${reason}`);
});

main().catch((error) => {
  log(`Fatal: ${error}`);
  process.exit(1);
});
