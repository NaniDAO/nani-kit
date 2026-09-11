import { BaseTool, createToolCollection } from "../client.js";
import { observeLPPositionTool } from "./observation.js";
export { observeLPPositionTool } from "./observation.js";
import { discoverLPPositionsTool } from "./discovery.js";
export { discoverLPPositionsTool } from "./discovery.js";
import {
  intentMintPosition,
  intentIncreaseLiquidity,
  intentDecreaseLiquidity,
  intentCollectFees,
  intentTransferPosition,
} from "./intents.js";
import {
  getUniV3Pool,
  getUserPositions,
  getPoolFeeData,
  getPositionDetails,
} from "./tools.js";

export function uniV3Tools(): BaseTool[] {
  return createToolCollection([
    observeLPPositionTool,
    discoverLPPositionsTool,
    // read
    getUniV3Pool,
    getUserPositions,
    getPoolFeeData,
    getPositionDetails,

    // write
    intentMintPosition,
    intentIncreaseLiquidity,
    intentDecreaseLiquidity,
    intentCollectFees,
    intentTransferPosition,
  ]);
}
