import { BaseTool, createToolCollection } from "../client.js";
import { getAcrossFeeQuote, getAcrossRoutes } from "./tools.js";
import { intentDepositAcross } from "./intents.js";

export function acrossTools(): BaseTool[] {
  return createToolCollection([getAcrossRoutes, getAcrossFeeQuote, intentDepositAcross]);
}
