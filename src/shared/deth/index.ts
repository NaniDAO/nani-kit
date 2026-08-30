import { BaseTool, createToolCollection } from "../client";
import { intentDepositDETHTool, intentReverseDETHTool } from "./intents";

export function dethTools(): BaseTool[] {
  return createToolCollection([intentDepositDETHTool, intentReverseDETHTool]);
}
