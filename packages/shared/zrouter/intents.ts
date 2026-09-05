import { z } from "zod";
import { AgentekClient, createTool, Intent } from "../client.js";
import { Address, Hex, encodeFunctionData } from "viem";
import { mainnet, base } from "viem/chains";
import {
  buildRoutePlan,
  checkRouteApprovals,
  erc20Abi,
  erc6909Abi,
  findRoute,
  getConfig,
  zRouterAbi,
  type RouteStep,
} from "zrouter-sdk";
import { supportedChains } from './constants.js';
import { AmountSchema, SymbolOrTokenSchema } from "./types.js";
import { addressSchema } from "../utils.js";
import { asToken, resolveInputToToken, toBaseUnits } from "./utils.js";
import { fetchApiRoutes } from "./api.js";
import { buildBestSwap, isNativeETH, zRouterAddress } from "./zquoter.js";

const swapParameters = z.object({
  chainId: z.number().default(1).describe("Chain ID (1 for Mainnet, 8453 for Base). Default: 1"),
  tokenIn: SymbolOrTokenSchema.describe('Input token — either a symbol string (e.g. "USDT", "ETH") or an object { address, id? } for ERC6909 tokens'),
  tokenOut: SymbolOrTokenSchema.describe('Output token — either a symbol string (e.g. "IZO", "WETH") or an object { address, id? } for ERC6909 tokens'),
  amount: AmountSchema.describe("Amount in human-readable units (e.g. 1.5 or '1.5'). Refers to tokenIn for EXACT_IN, tokenOut for EXACT_OUT."),
  side: z.enum(["EXACT_IN", "EXACT_OUT"]).describe("EXACT_IN: specify the input amount and get the best output. EXACT_OUT: specify the desired output and get the required input."),
  slippageBps: z.number().int().min(0).max(10_000).default(50).describe("Max slippage in basis points (e.g. 50 = 0.50%, 100 = 1%). Default: 50"),
  // 20 minutes, not 5. The deadline starts when this tool runs, but the swap
  // isn't signed until a human has read the confirmation sheet — and this
  // wallet's whole premise is that they should read it, decode the calldata and
  // check it elsewhere before signing. A 5-minute window meant a user who did
  // exactly what we ask them to do watched the final step revert on deadline
  // while every earlier step still simulated fine.
  //
  // The deadline is not the thing protecting them from a stale price: minOut
  // does that, and it is unchanged. The deadline only bounds how long a signed
  // transaction may sit in the mempool, and 20 minutes is still conservative.
  deadlineSeconds: z.number().int().positive().default(1200).describe("Transaction deadline in seconds from now (e.g. 1200 = 20 minutes). Default: 1200"),
  owner: addressSchema.optional().describe("The address that owns the input tokens (0x...). Defaults to the connected wallet."),
  finalTo: addressSchema.optional().describe("Address to receive the output tokens (0x...). Defaults to the owner address."),
  router: addressSchema.optional().describe("Override the zRouter contract address (0x...). Defaults to the canonical zRouter for the chain."),
});

export const intentSwap = createTool({
  name: "intentSwap",
  description: "Swap ERC20 or ERC6909 tokens via the zRouter. Automatically handles token approvals, finds the best route (including Matcha/0x aggregation), and executes the swap.",
  supportedChains,
  parameters: swapParameters,
  execute: async (client: AgentekClient, args: z.infer<typeof swapParameters>): Promise<Intent> => {
    const chainId = args.chainId as 1 | 8453;
    if (chainId !== mainnet.id && chainId !== base.id) {
      throw new Error(`Unsupported chain ID ${chainId}. Supported: 1 (Mainnet), 8453 (Base).`);
    }
    const walletClient = client.getWalletClient(chainId);
    const publicClient = client.getPublicClient(chainId);

    // client.getAddress() covers the watch-only case — an address configured
    // without a private key — which every other intent tool in the library
    // already supports. Reading only walletClient.account made intentSwap the
    // one tool that couldn't build an unsigned intent for such a client.
    const owner: Address =
      args.owner ??
      (walletClient?.account?.address as Address) ??
      (await client.getAddress());

    if (!owner || owner === "0x0000000000000000000000000000000000000000") {
      throw new Error(
        "Owner address is required (connect a wallet, configure ACCOUNT, or pass 'owner').",
      );
    }

    const finalTo: Address = args.finalTo ?? owner;

    // Resolve tokens
    const [tIn, tOut] = await Promise.all([
      resolveInputToToken(args.tokenIn, chainId, publicClient),
      resolveInputToToken(args.tokenOut, chainId, publicClient),
    ]);

    // Parse human amount -> base units (by side)
    const humanAmount = typeof args.amount === "number" ? String(args.amount) : args.amount;
    const baseAmount =
      args.side === "EXACT_IN" ? toBaseUnits(humanAmount, tIn) : toBaseUnits(humanAmount, tOut);

    // Deadline/slippage
    const deadline = BigInt(Math.floor(Date.now() / 1000) + args.deadlineSeconds);

    // --- Route on-chain via zQuoter, before anything else ---
    //
    // The contract routes and encodes the swap itself, so there is no
    // client-side hop chaining to get wrong. The SDK's findRoute produced a
    // two-hop route whose second hop took the first hop's *minimum* output as
    // its input while demanding ~135.7 ETH out — it reverted with Slippage()
    // every time. A zQuoter-built swap for the same pair simulates clean.
    // Native ETH inputs go through here too — they ride in msgValue and skip
    // the approval op below, which is the only thing that differed. The
    // `|| true` this replaces made the guard read as a restriction that hadn't
    // applied for some time.
    {
      const built = await buildBestSwap(publicClient, {
        chainId,
        to: finalTo,
        exactOut: args.side === "EXACT_OUT",
        tokenIn: asToken(tIn).address as Address,
        tokenOut: asToken(tOut).address as Address,
        swapAmount: baseAmount,
        slippageBps: args.slippageBps,
        deadline,
      });

      if (built) {
        // Must be the router this quoter built for, not the SDK's pinned one.
        const routerAddr: Address =
          args.router ?? zRouterAddress(chainId) ?? getConfig(chainId).router;
        const ops: { target: Address; value: string; data: Hex }[] = [];

        // ETH inputs ride in msgValue, so only a token input needs an
        // allowance — and only for exactly what this swap spends.
        if (!isNativeETH(asToken(tIn))) {
          ops.push({
            target: asToken(tIn).address as Address,
            value: "0",
            data: encodeFunctionData({
              abi: erc20Abi,
              functionName: "approve",
              args: [routerAddr, built.amountIn],
            }) as Hex,
          });
        }

        ops.push({
          target: routerAddr,
          value: built.msgValue.toString(),
          data: built.callData,
        });

        const label = `${args.side === "EXACT_IN" ? "Swap" : "Receive"} ${humanAmount} ${
          typeof args.tokenIn === "string" ? args.tokenIn.toUpperCase() : tIn.symbol ?? "TOKEN"
        } → ${typeof args.tokenOut === "string" ? args.tokenOut.toUpperCase() : tOut.symbol ?? "TOKEN"}${
          built.venue ? ` (via ${built.venue})` : ""
        }`;

        if (!walletClient) return { intent: label, ops, chain: chainId };
        const txHash = await client.executeOps(ops, chainId);
        return { intent: label, ops, chain: chainId, hash: txHash };
      }
    }

    // --- Fall back to the API / SDK route builder ---
    let steps: RouteStep[] | null = null;
    const apiRoutes = await fetchApiRoutes({
      chainId,
      tokenIn: asToken(tIn),
      tokenOut: asToken(tOut),
      side: args.side,
      amount: baseAmount,
      owner,
      slippageBps: args.slippageBps,
    });

    if (apiRoutes && apiRoutes.length > 0) {
      steps = apiRoutes[0].steps;
    }

    // --- Fallback to SDK findRoute if API didn't return routes ---
    if (!steps) {
      const sdkSteps = await findRoute(publicClient, {
        tokenIn: asToken(tIn),
        tokenOut: asToken(tOut),
        side: args.side as any,
        amount: baseAmount,
        deadline,
        owner,
        slippageBps: args.slippageBps,
      } as any);

      if (!sdkSteps?.length) {
        // Name both attempts. "No route found" alone sent us looking at
        // liquidity when the actual cause was an API returning 404.
        throw new Error(
          apiRoutes === null
            ? "No route found: the route API was unreachable and on-chain routing found nothing for this pair."
            : "No route found for the requested swap."
        );
      }
      steps = sdkSteps;
    }

    const router: Address =
      args.router ??
      (steps[0] as any)?.router ??
      getConfig(chainId).router;

    // --- Check if the best route is a direct Matcha swap ---
    // Matcha routes have a single MATCHA step with a raw 0x transaction
    // that should be executed directly (not through zRouter multicall)
    const isMatchaRoute = steps.length === 1 && steps[0].kind === "MATCHA";

    if (isMatchaRoute) {
      const matchaStep = steps[0] as Extract<RouteStep, { kind: "MATCHA" }>;
      const tx = matchaStep.transaction;

      // Build approval ops for the Matcha allowance target
      const approvalOps: { target: Address; value: string; data: Hex }[] = [];
      const allowanceTarget = matchaStep.metadata?.allowanceTarget;
      if (allowanceTarget) {
        // Approve exactly what this swap spends, not maxUint256. An unlimited
        // allowance survives the swap and lets the spender move the whole
        // balance at any later time — the exact exposure the wallet's approvals
        // screen exists to clean up. For EXACT_IN the input amount is `amount`;
        // for EXACT_OUT the input is the expected amount.
        const spendAmount =
          matchaStep.side === "EXACT_IN"
            ? matchaStep.amount
            : matchaStep.expectedAmount;
        const approvalData = encodeFunctionData({
          abi: erc20Abi,
          functionName: "approve",
          args: [allowanceTarget, spendAmount],
        });
        approvalOps.push({
          target: matchaStep.tokenIn.address as Address,
          value: "0",
          data: approvalData,
        });
      }

      // The raw 0x swap transaction
      const swapOp = {
        target: tx.to,
        value: tx.value.toString(),
        data: tx.data,
      };

      const ops = [...approvalOps, swapOp];

      const pretty = `${args.side === "EXACT_IN" ? "Swap" : "Receive"} ${humanAmount} ${
        typeof args.tokenIn === "string" ? args.tokenIn.toUpperCase() : tIn.symbol ?? "TOKEN"
      } → ${typeof args.tokenOut === "string" ? args.tokenOut.toUpperCase() : tOut.symbol ?? "TOKEN"} (via Matcha)`;

      if (!walletClient) {
        return { intent: pretty, ops, chain: chainId };
      }

      const hash = await client.executeOps(ops, chainId);
      return { intent: pretty, ops, chain: chainId, hash };
    }

    // --- Standard zRouter path: check approvals, build plan, multicall ---

    // Use checkRouteApprovals() instead of plan.approvals (empty in SDK >= 0.0.27)
    const approvals = await checkRouteApprovals(publicClient, {
      owner,
      router,
      steps,
    });

    const plan = await buildRoutePlan(publicClient, {
      owner,
      router,
      steps,
      finalTo,
    });

    // Build approval ops from checkRouteApprovals result
    const approvalOps = approvals.map((appr) => {
      if (appr.kind === "ERC20_APPROVAL") {
        // `checkRouteApprovals` already computed the exact amount this route
        // needs, so there is no reason to ask for an unlimited allowance.
        const data = encodeFunctionData({
          abi: erc20Abi,
          functionName: "approve",
          args: [appr.spender as Address, appr.amount],
        });
        return {
          target: appr.token.address as Address,
          value: "0",
          data: data as Hex,
        };
      }

      if (appr.kind === "ERC6909_SET_OPERATOR") {
        const data = encodeFunctionData({
          abi: erc6909Abi,
          functionName: "setOperator",
          args: [appr.operator as Address, true],
        });
        return {
          target: appr.token.address as Address,
          value: "0",
          data: data as Hex,
        };
      }

      throw new Error(`Unsupported approval action: ${String((appr as any).kind)}`);
    });

    // Router call: single call or multicall
    const routerCallOp =
      plan.calls.length === 1
        ? {
            target: router,
            value: plan.value.toString(),
            data: plan.calls[0] as Hex,
          }
        : {
            target: router,
            value: plan.value.toString(),
            data: encodeFunctionData({
              abi: zRouterAbi,
              functionName: "multicall",
              args: [plan.calls as Hex[]],
            }),
          };

    const ops = [...approvalOps, routerCallOp];

    const pretty = `${args.side === "EXACT_IN" ? "Swap" : "Receive"} ${humanAmount} ${
      typeof args.tokenIn === "string" ? args.tokenIn.toUpperCase() : tIn.symbol ?? "TOKEN"
    } → ${typeof args.tokenOut === "string" ? args.tokenOut.toUpperCase() : tOut.symbol ?? "TOKEN"}`;

    // If no wallet connected, return intent + ops for external execution
    if (!walletClient) {
      return { intent: pretty, ops, chain: chainId };
    }

    // Execute via your client (will naturally run approvals first, then router)
    const hash = await client.executeOps(ops, chainId);
    return { intent: pretty, ops, chain: chainId, hash };
  },
});
