import { z } from "zod";
import { createTool } from "../client.js";
import type { AgentekClient } from "../client.js";
import { clean } from "../utils.js";
import { assertOkResponse } from "../utils/fetch.js";

const getFearAndGreedIndexToolParams = z.object({});

export type GetFearAndGreedIndexToolReturnType = {
  value: string;
};

export const fearGreedIndexTool = createTool({
  name: "getFearAndGreedIndex",
  description:
    "Retrieves the current Fear and Greed Index value from Alternative.me API.",
  parameters: getFearAndGreedIndexToolParams,
  execute: async (
    _client: AgentekClient,
    _args: z.infer<typeof getFearAndGreedIndexToolParams>,
  ): Promise<GetFearAndGreedIndexToolReturnType> => {
    try {
      const response = await fetch("https://api.alternative.me/fng/", {
        signal: AbortSignal.timeout(15_000),
      });
      await assertOkResponse(response, "Fear and Greed API error");
      const data = await response.json();
      if (
        !data ||
        !data.data ||
        !Array.isArray(data.data) ||
        !data.data[0] ||
        !data.data[0].value
      ) {
        throw new Error("Invalid response format from Fear and Greed API.");
      }

      return clean(data.data[0]);
    } catch (error: any) {
      throw new Error(`Failed to fetch Fear and Greed Index: ${error.message}`);
    }
  },
});
