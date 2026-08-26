import { transferTools } from "./transfer/index.js";
import { ensTools } from "./ens/index.js";
import { dexscreenerTools } from "./dexscreener/index.js";
import { rpcTools } from "./rpc/index.js";
import { uniV3Tools } from "./uniV3/index.js";
import { wethTools } from "./weth/index.js";
import { naniTools } from "./nani/index.js";
import { erc20Tools } from "./erc20/index.js";
import { searchTools } from "./search/index.js";
import { swapTools } from "./swap/index.js";
import { blockscoutTools } from "./blockscout/index.js";
import { tallyTools } from "./tally/index.js";
import { aaveTools } from "./aave/index.js";
import { securityTools } from "./security/index.js";
import { webTools } from "./web/index.js";
import { coindeskTools } from "./coindesk/index.js";
import { fearGreedIndexTools } from "./feargreed/index.js";
import { createCoinMarketCalTools } from "./coinmarketcal/index.js";
import { slowTransferTools } from "./slowTransfer/index.js";
import { nftTools } from "./erc721/index.js";
import { cryptoPriceTools } from "./cryptoprices/index.js";
import { gasEstimatorTools } from "./gasestimator/index.js";
import { defillamaTools } from "./defillama/index.js";
import { acrossTools } from "./across/index.js";
import { thinkTools } from "./think/index.js";
import { btcRpcTools } from "./btc-rpc/index.js";
import { erc6909Tools } from "./erc6909/index.js";
import { createImageGenTools } from './imagegen/index.js';
import { coinchanTools } from "./coinchan/index.js";
import { zammTools } from "./zamm/index.js";
import { zrouterTools } from "./zrouter/index.js";
import { wnsTools } from "./wns/index.js";
import { x402Tools } from "./x402/index.js";
import { twitterTools } from "./twitter/index.js";
import { resolveTokenTools } from "./resolveToken/index.js";
import { approvalTools } from "./approvals/index.js";
import { contractTools } from "./contract/index.js";
import { solanaTools } from "./solana/index.js";
import { assertOkResponse } from "./utils/fetch.js";

const allTools = async ({
  perplexityApiKey,
  zeroxApiKey,
  tallyApiKey,
  coindeskApiKey,
  coinMarketCalApiKey,
  fireworksApiKey,
  pinataJWT,
  xBearerToken,
  xApiKey,
  xApiKeySecret,
  xAccessToken,
  xAccessTokenSecret,
}: {
  perplexityApiKey?: string;
  zeroxApiKey?: string;
  tallyApiKey?: string;
  coindeskApiKey?: string;
  coinMarketCalApiKey?: string;
  fireworksApiKey?: string;
  pinataJWT?: string;
  xBearerToken?: string;
  xApiKey?: string;
  xApiKeySecret?: string;
  xAccessToken?: string;
  xAccessTokenSecret?: string;
}) => {
  let tools = [
    ...ensTools(),
    ...erc20Tools(),
    ...acrossTools(),
    ...transferTools(),
    ...dexscreenerTools(),
    ...rpcTools(),
    ...uniV3Tools(),
    ...wethTools(),
    ...naniTools(),
    ...blockscoutTools(),
    ...aaveTools(),
    ...securityTools(),
    ...webTools(),
    ...fearGreedIndexTools(),
    ...slowTransferTools(),
    ...nftTools(),
    ...cryptoPriceTools(),
    ...gasEstimatorTools(),
    ...defillamaTools(),
    ...thinkTools(),
    ...btcRpcTools(),
    ...erc6909Tools(),
    ...coinchanTools(),
    ...zammTools(),
    ...zrouterTools(),
    ...wnsTools(),
    ...x402Tools(),
    ...resolveTokenTools(),
    ...approvalTools(),
    ...contractTools(),
    ...solanaTools(),
  ];

  if (perplexityApiKey) {
    tools.push(...searchTools({ perplexityApiKey }));
  }

  if (zeroxApiKey) {
    tools.push(...swapTools({ zeroxApiKey }));
  }

  if (tallyApiKey) {
    tools.push(
      ...tallyTools({
        tallyApiKey,
      }),
    );
  }

  if (coindeskApiKey) {
    tools.push(...coindeskTools({ coindeskApiKey }));
  }

  if (coinMarketCalApiKey) {
    tools.push(...createCoinMarketCalTools({ coinMarketCalApiKey }));
  }

  if (fireworksApiKey && pinataJWT) {
    tools.push(...createImageGenTools({
      fireworksApiKey,
      pinataJWT,
    }))
  }

  if (xBearerToken) {
    tools.push(...await twitterTools({ xBearerToken, xAccessToken, xAccessTokenSecret }));
  } else if (xApiKey && xApiKeySecret) {
    tools.push(...await twitterTools({ xApiKey, xApiKeySecret, xAccessToken, xAccessTokenSecret }));
  }

  return tools;
};

export {
  allTools,

  // Exporting all tool collections for easier composition
  transferTools,
  ensTools,
  dexscreenerTools,
  rpcTools,
  uniV3Tools,
  wethTools,
  naniTools,
  erc20Tools,
  searchTools,
  swapTools,
  blockscoutTools,
  tallyTools,
  aaveTools,
  securityTools,
  webTools,
  coindeskTools,
  fearGreedIndexTools,
  createCoinMarketCalTools,
  slowTransferTools,
  nftTools,
  cryptoPriceTools,
  gasEstimatorTools,
  defillamaTools,
  acrossTools,
  thinkTools,
  btcRpcTools,
  erc6909Tools,
  createImageGenTools,
  coinchanTools,
  zammTools,
  zrouterTools,
  wnsTools,
  x402Tools,
  twitterTools,
  resolveTokenTools,
  approvalTools,
  contractTools,
  solanaTools,
  assertOkResponse
};
