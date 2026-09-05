import z from "zod";
import { createTool } from "../client.js";
import type { BaseTool, AgentekClient } from "../client.js";
import { assertOkResponse } from "../utils/fetch.js";

export function createAskPerplexitySearchTool(
  perplexityApiKey: string,
): BaseTool {
  return createTool({
    name: "askPerplexitySearch",
    description: "Search the web using Perplexity AI and get a concise, sourced answer. Good for current events, crypto news, protocol documentation, and general knowledge questions.",
    supportedChains: [],
    parameters: z.object({
      searchString: z.string().describe("The question or search query to ask Perplexity (e.g. 'What is the current TVL of Aave?')"),
    }),
    execute: async (_client: AgentekClient, args) => {
      const options = {
        method: "POST",
        signal: AbortSignal.timeout(60_000),
        headers: {
          Authorization: `Bearer ${perplexityApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "sonar",
          messages: [
            {
              role: "system",
              content: "Be precise and concise.",
            },
            {
              role: "user",
              content: args.searchString,
            },
          ],
          temperature: 0.2,
          top_p: 0.9,
          search_domain_filter: [],
          return_images: false,
          return_related_questions: false,
          search_recency_filter: "month",
          top_k: 0,
          stream: false,
          presence_penalty: 0,
          frequency_penalty: 1,
          response_format: null,
        }),
      };

      try {
        const response = await fetch(
          "https://api.perplexity.ai/chat/completions",
          options,
        );
        // Without this, a 401 or 429 body was handed back as if it were an
        // answer, and the model had no way to tell the difference.
        await assertOkResponse(response, "Perplexity API error");
        return await response.json();
      } catch (err) {
        throw new Error(`Perplexity API Error: ${err}`);
      }
    },
  });
}
