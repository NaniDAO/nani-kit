import z from "zod";
import { createTool } from "../client.js";
import type { BaseTool, AgentekClient } from "../client.js";
import { getGovernorBySlug } from "./utils.js";
import { TALLY_API_URL, TALLY_TIMEOUT_MS } from "./constants.js";

export function createTallyProposalsTool(tallyApiKey: string): BaseTool {
  return createTool({
    name: "tallyProposals",
    description:
      "Fetch proposals from the Tally governance API for a specified DAO/space.",
    supportedChains: [],
    parameters: z.object({
      space: z
        .string()
        .describe("The DAO or space identifier e.g. uniswap, hai, nounsdao"),
      limit: z
        .number()
        .optional()
        .default(10)
        .describe("Maximum number of proposals to fetch"),
    }),
    execute: async (_client: AgentekClient, args) => {
      const governor = await getGovernorBySlug(args.space, tallyApiKey);
      const governorId = governor.id;

      // Then get proposals using governor ID
      const getProposalsQuery = `
        query GetProposals($governorId: AccountID!, $limit: Int!) {
          proposals(
            input: {
              filters: { governorId: $governorId }
              page: { limit: $limit }
              sort: { isDescending: true, sortBy: id }
            }
          ) {
            nodes {
              ... on Proposal {
                id
                onchainId
                metadata {
                  title
                  description
                }
                status
                start {
                  ... on Block {
                    number
                    timestamp
                  }
                  ... on BlocklessTimestamp {
                    timestamp
                  }
                }
                end {
                  ... on Block {
                    number
                    timestamp
                  }
                  ... on BlocklessTimestamp {
                    timestamp
                  }
                }
                voteStats {
                  type
                  votesCount
                  votersCount
                  percent
                }
              }
            }
            pageInfo {
              firstCursor
              lastCursor
              count
            }
          }
        }
      `;

      const proposalsResponse = await fetch(TALLY_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Api-Key": tallyApiKey,
        },
        signal: AbortSignal.timeout(TALLY_TIMEOUT_MS),
        body: JSON.stringify({
          query: getProposalsQuery,
          variables: {
            governorId,
            limit: args.limit || 10,
          },
        }),
      });

      const result = await proposalsResponse.json();
      if (result.errors) {
        throw new Error(`Tally API Error: ${JSON.stringify(result.errors)}`);
      }
      return result.data;
    },
  });
}

export function createTallyChainsTool(tallyApiKey: string): BaseTool {
  return createTool({
    name: "tallyChains",
    description: "Fetch all chains supported by the Tally governance API.",
    supportedChains: [],
    parameters: z.object({}),
    execute: async (_client: AgentekClient, _args) => {
      const query = `
        query Chains {
          chains {
            id
            layer1Id
            name
            mediumName
            shortName
            blockTime
            isTestnet
            nativeCurrency {
              name
              symbol
              decimals
            }
            chain
            useLayer1VotingPeriod
          }
        }
      `;

      const response = await fetch(TALLY_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Api-Key": tallyApiKey,
        },
        signal: AbortSignal.timeout(TALLY_TIMEOUT_MS),
        body: JSON.stringify({ query }),
      });

      const result = await response.json();
      if (result.errors) {
        throw new Error(`Tally API Error: ${JSON.stringify(result.errors)}`);
      }
      return result.data;
    },
  });
}

export function createTallyUserDaosTool(tallyApiKey: string): BaseTool {
  return createTool({
    name: "tallyUserDaos",
    description:
      "Fetch all DAOs a user is a member of from the Tally governance API.",
    supportedChains: [],
    parameters: z.object({
      address: z
        .string()
        .describe("The Ethereum address to check DAO membership for"),
    }),
    execute: async (_client: AgentekClient, args) => {
      const query = `
        query Organizations($input: OrganizationsInput) {
          organizations(input: $input) {
            nodes {
              ... on Organization {
                id
                slug
                name
                chainIds
                tokenIds
                governorIds
                metadata {
                  color
                  description
                  icon
                }
              }
            }
            pageInfo {
              firstCursor
              lastCursor
              count
            }
          }
        }
      `;

      const response = await fetch(TALLY_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Api-Key": tallyApiKey,
        },
        signal: AbortSignal.timeout(TALLY_TIMEOUT_MS),
        body: JSON.stringify({
          query,
          variables: {
            input: {
              filters: {
                address: args.address,
                isMember: true,
              },
            },
          },
        }),
      });

      const result = await response.json();

      if (result.errors) {
        throw new Error(`Tally API Error: ${JSON.stringify(result.errors)}`);
      }

      return result.data;
    },
  });
}
