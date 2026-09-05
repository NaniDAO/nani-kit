import {
  BaseTool,
  createAgentekClient,
  AgentekClient,
  type SolanaConfig,
} from "@agentek/tools/client";
import type { Tool } from "ai";
import AgentekTool from "./tool.js";
import { Account, Address, Chain, Transport } from "viem";

class AgentekToolkit {
  private _agent: AgentekClient;
  tools: { [key: string]: Tool };

  constructor({
    accountOrAddress,
    chains,
    transports,
    tools,
    solana,
  }: {
    accountOrAddress: Account | Address;
    chains: Chain[];
    transports: Transport[];
    tools: BaseTool[];
    /** Solana settings. Without this the twelve Solana tools have no account. */
    solana?: SolanaConfig;
  }) {
    this._agent = createAgentekClient({
      accountOrAddress,
      chains,
      transports,
      tools,
      solana,
    });

    this.tools = {};
    tools.forEach((tool) => {
      this.tools[tool.name] = AgentekTool(this._agent, tool);
    });
  }

  getTools(): { [key: string]: Tool } {
    return this.tools;
  }
}

export default AgentekToolkit;
