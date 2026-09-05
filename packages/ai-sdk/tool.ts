import type { Tool } from "ai";
import { tool } from "ai";
import { z } from "zod";
import type { BaseTool, AgentekClient } from "@agentek/tools/client";

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: z.ZodObject<any>;
}

export interface ToolResult {
  result: any;
}

export default function AgentekTool(
  agentekClient: AgentekClient,
  baseTool: BaseTool,
): Tool {
  return tool({
    description: baseTool.description,
    inputSchema: baseTool.parameters,
    execute: async (args: z.infer<typeof baseTool.parameters>) => {
      // Errors are rethrown rather than returned as the result. Returning
      // `e.message` made a failure indistinguishable from data: the AI SDK saw
      // a successful call whose value happened to be an error sentence, so the
      // model had no signal to retry and nothing downstream could tell that
      // the tool had failed at all.
      return await agentekClient.execute(baseTool.name, args);
    },
  });
}
