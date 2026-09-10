import { observeTokenPermissionTool, observeNFTOperatorTool, planSelectedRevocationsTool } from "./observations.js";
export { observeTokenPermissionTool, observeNFTOperatorTool, planSelectedRevocationsTool } from "./observations.js";
import { discoverTokenPermissionsTool } from "./discovery.js";
export { discoverTokenPermissionsTool } from "./discovery.js";
import type { BaseTool } from "../client.js";
import { createToolCollection } from "../client.js";
import {
  getActiveApprovalsTool,
  intentRevokeApprovalTool,
  intentRevokeAllApprovalsTool,
} from "./tools.js";

export function approvalTools(): BaseTool[] {
  return createToolCollection([
    discoverTokenPermissionsTool,
    observeTokenPermissionTool,
    observeNFTOperatorTool,
    planSelectedRevocationsTool,
    getActiveApprovalsTool,
    intentRevokeApprovalTool,
    intentRevokeAllApprovalsTool,
  ]);
}
