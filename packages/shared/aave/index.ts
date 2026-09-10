import { BaseTool, createToolCollection } from "../client.js";
import { observeAaveAccountTool } from "./observation.js";
export { observeAaveAccountTool } from "./observation.js";
import { getAaveUserData, getAaveReserveData } from "./tools.js";
import {
  intentAaveDeposit,
  intentAaveWithdraw,
  intentAaveBorrow,
  intentAaveRepay,
} from "./intents.js";

export function aaveTools(): BaseTool[] {
  return createToolCollection([
    observeAaveAccountTool,
    getAaveUserData,
    getAaveReserveData,
    intentAaveDeposit,
    intentAaveWithdraw,
    intentAaveBorrow,
    intentAaveRepay,
  ]);
}
