import { z } from "zod";
import { createTool, AgentekClient } from "../client.js";
import { assertOkResponse } from "../utils/fetch.js";

const getLatestCoindeskNewsToolParams = z.object({
  limit: z.number().min(1).max(100).default(10).describe("Number of articles to fetch (1-100). Default: 10"),
});

export type GetLatestCoindeskNewsToolReturnType = {
  articles: any[];
};

export const createCoindeskNewsTool = (apiKey: string) => {
  return createTool({
    name: "getLatestCoindeskNewsTool",
    description:
      "Get the latest cryptocurrency and blockchain news articles from CoinDesk.",
    parameters: getLatestCoindeskNewsToolParams,
    execute: async (
      _client: AgentekClient,
      args: z.infer<typeof getLatestCoindeskNewsToolParams>,
    ): Promise<GetLatestCoindeskNewsToolReturnType> => {
      const { limit } = args;

      const baseUrl = "https://data-api.coindesk.com/news/v1/article/list";
      const params = {
        lang: "EN",
        limit: limit.toString(),
        api_key: apiKey,
      };

      const url = new URL(baseUrl);
      url.search = new URLSearchParams(params).toString();

      const options = {
        method: "GET",
        headers: { "Content-type": "application/json; charset=UTF-8" },
      };

      try {
        const response = await fetch(url.toString(), options);
        await assertOkResponse(response, "Coindesk API error");
        const json = await response.json();
        if (json?.Err && Object.keys(json.Err).length > 0) {
          throw new Error(json.Err.message || JSON.stringify(json.Err));
        }
        // The API answers with a top-level `Data` array. Reading `json.articles`
        // always yielded undefined, so a successful call returned an empty list
        // and the failure looked like a slow news day. An unrecognized shape is
        // an error, not an empty result.
        const articles = Array.isArray(json?.Data) ? json.Data : json?.Data?.LIST ?? json?.articles;
        if (!Array.isArray(articles)) throw new Error("CoinDesk returned an unexpected news response");
        return { articles };
      } catch (err) {
        throw new Error(
          `Failed to fetch latest Coindesk news articles: ${err}`,
        );
      }
    },
  });
};
