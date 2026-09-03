import { type BaseTool, createToolCollection } from "../client.js";
import { researchCA } from "./tools.js";

export function researchCATools(): BaseTool[] {
  return createToolCollection([researchCA]);
}

export { researchCA } from "./tools.js";
