import { createTool } from "../client.js";
import { z } from "zod";
import { aavePoolAbi, getAavePoolAddress, supportedChains } from "./constants.js";
import { formatUnits, maxUint256 } from "viem";

/** Aave scales health factors, and most user-facing amounts, by 1e18. */
const WAD = 10n ** 18n;

const formatRate = (rate: bigint) =>
  `${(Number(formatUnits(rate, 27)) * 100).toFixed(2)}%`;
const isZeroAddress = (address: string) =>
  address === "0x0000000000000000000000000000000000000000";

/** Read one flag out of an Aave v3 packed reserve-configuration bitmap. */
const readConfigFlag = (configuration: bigint, bit: number): boolean =>
  ((configuration >> BigInt(bit)) & 1n) === 1n;

export const getAaveUserData = createTool({
  name: "getAaveUserData",
  description:
    "Fetches Aave user data including total collateral, total debt, available borrowing power, current liquidation threshold, LTV, and health factor.",
  parameters: z.object({
    userAddress: z.string().describe("The user's wallet address."),
    chainId: z.number().describe("The chain ID where Aave is deployed."),
  }),
  supportedChains,
  async execute(client, args) {
    const publicClient = client.getPublicClient(args.chainId);
    const poolAddress = getAavePoolAddress(args.chainId);

    const result = (await publicClient.readContract({
      address: poolAddress as `0x${string}`,
      abi: aavePoolAbi,
      functionName: "getUserAccountData",
      args: [args.userAddress],
    })) as [bigint, bigint, bigint, bigint, bigint, bigint];

    const [
      totalCollateralBase,
      totalDebtBase,
      availableBorrowsBase,
      currentLiquidationThreshold,
      ltv,
      healthFactor,
    ] = result;

    // getUserAccountData returns type(uint256).max as the health factor when the
    // account has no debt at all. Every real health factor is scaled by 1e18, so
    // it has to be compared against WAD — not against some small constant, which
    // reports every borrower as having infinite headroom.
    const hasNoDebt = totalDebtBase === 0n || healthFactor === maxUint256;

    return {
      summary: {
        totalCollateralUSD: `$${Number(formatUnits(totalCollateralBase, 8)).toFixed(2)}`,
        totalDebtUSD: `$${Number(formatUnits(totalDebtBase, 8)).toFixed(2)}`,
        availableToBorrowUSD: `$${Number(formatUnits(availableBorrowsBase, 8)).toFixed(2)}`,
        loanToValue: `${Number(formatUnits(ltv, 2)).toFixed(2)}%`,
        liquidationThreshold: `${Number(formatUnits(currentLiquidationThreshold, 2)).toFixed(2)}%`,
        healthFactor: hasNoDebt ? "∞" : formatUnits(healthFactor, 18),
      },
      riskAssessment: {
        // Thresholds match liquidationRisk below so the two can't disagree.
        status: hasNoDebt
          ? "HEALTHY"
          : healthFactor < WAD
            ? "LIQUIDATABLE"
            : healthFactor < (WAD * 11n) / 10n
              ? "AT RISK"
              : healthFactor < 2n * WAD
                ? "SAFE"
                : "HEALTHY",
        canBorrow: availableBorrowsBase > BigInt(0) ? "YES" : "NO",
        liquidationRisk: hasNoDebt
          ? "NONE"
          : healthFactor < (WAD * 11n) / 10n
            ? "HIGH"
            : healthFactor < 2n * WAD
              ? "MEDIUM"
              : "LOW",
      },
      rawData: {
        totalCollateralBase: totalCollateralBase.toString(),
        totalDebtBase: totalDebtBase.toString(),
        availableBorrowsBase: availableBorrowsBase.toString(),
        currentLiquidationThreshold: currentLiquidationThreshold.toString(),
        ltv: ltv.toString(),
        healthFactor: healthFactor.toString(),
      },
    };
  },
});

export const getAaveReserveData = createTool({
  name: "getAaveReserveData",
  description:
    "Fetches reserve data for a given asset from Aave including available liquidity, total stable and variable debt, and interest rates.",
  parameters: z.object({
    asset: z.string().describe("The token contract address of the asset."),
    chainId: z.number().describe("Chain ID where Aave is deployed."),
  }),
  supportedChains,
  async execute(client, args) {
    const publicClient = client.getPublicClient(args.chainId);
    const poolAddress = getAavePoolAddress(args.chainId);

    const result = (await publicClient.readContract({
      address: poolAddress,
      abi: aavePoolAbi,
      functionName: "getReserveData",
      args: [args.asset],
    })) as {
      configuration: { data: bigint };
      liquidityIndex: bigint;
      currentLiquidityRate: bigint;
      variableBorrowIndex: bigint;
      currentVariableBorrowRate: bigint;
      currentStableBorrowRate: bigint;
      lastUpdateTimestamp: number;
      id: number;
      aTokenAddress: string;
      stableDebtTokenAddress: string;
      variableDebtTokenAddress: string;
      interestRateStrategyAddress: string;
      accruedToTreasury: bigint;
      unbacked: bigint;
      isolationModeTotalDebt: bigint;
    };

    return {
      summary: {
        // configuration.data is a packed bitmap, not a count: bit 56 is the
        // "reserve is active" flag, 57 frozen, 60 paused. Testing the whole
        // word for > 0 says ACTIVE for any configured reserve, frozen ones
        // included — and Number() on a 256-bit word loses precision besides.
        assetStatus: readConfigFlag(result.configuration.data, 56)
          ? readConfigFlag(result.configuration.data, 60)
            ? "PAUSED"
            : readConfigFlag(result.configuration.data, 57)
              ? "FROZEN"
              : "ACTIVE"
          : "INACTIVE",
        borrowingEnabled: readConfigFlag(result.configuration.data, 58),
        supplyAPY: formatRate(result.currentLiquidityRate),
        variableBorrowAPY: formatRate(result.currentVariableBorrowRate),
        stableBorrowAPY: formatRate(result.currentStableBorrowRate),
        lastUpdate: new Date(result.lastUpdateTimestamp * 1000).toISOString(),
      },
      tokens: {
        aToken: !isZeroAddress(result.aTokenAddress)
          ? result.aTokenAddress
          : "Not Available",
        stableDebtToken: !isZeroAddress(result.stableDebtTokenAddress)
          ? result.stableDebtTokenAddress
          : "Not Available",
        variableDebtToken: !isZeroAddress(result.variableDebtTokenAddress)
          ? result.variableDebtTokenAddress
          : "Not Available",
      },
      metrics: {
        // Only the indexes are ray-scaled (27 decimals). accruedToTreasury and
        // unbacked are in the asset's own decimals and isolationModeTotalDebt is
        // in 2-decimal base currency, so formatting all of them as rays rendered
        // every one as 0.00000000. They are reported raw rather than mis-scaled.
        liquidityIndex: Number(formatUnits(result.liquidityIndex, 27)).toFixed(8),
        variableBorrowIndex: Number(
          formatUnits(result.variableBorrowIndex, 27),
        ).toFixed(8),
        accruedToTreasuryScaled: result.accruedToTreasury.toString(),
        unbackedScaled: result.unbacked.toString(),
        isolationModeTotalDebtBase: result.isolationModeTotalDebt.toString(),
      },
      rawData: {
        configuration: result.configuration.data.toString(),
        liquidityIndex: result.liquidityIndex.toString(),
        currentLiquidityRate: result.currentLiquidityRate.toString(),
        variableBorrowIndex: result.variableBorrowIndex.toString(),
        currentVariableBorrowRate: result.currentVariableBorrowRate.toString(),
        currentStableBorrowRate: result.currentStableBorrowRate.toString(),
        lastUpdateTimestamp: result.lastUpdateTimestamp,
        id: result.id,
        aTokenAddress: result.aTokenAddress,
        stableDebtTokenAddress: result.stableDebtTokenAddress,
        variableDebtTokenAddress: result.variableDebtTokenAddress,
        interestRateStrategyAddress: result.interestRateStrategyAddress,
        accruedToTreasury: result.accruedToTreasury.toString(),
        unbacked: result.unbacked.toString(),
        isolationModeTotalDebt: result.isolationModeTotalDebt.toString(),
      },
    };
  },
});
