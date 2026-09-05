import {
  mainnet,
  optimism,
  arbitrum,
  base,
  sepolia,
} from "viem/chains";

/**
 * Chains where the native token is ether and WETH is the canonical WETH9
 * wrapper with payable `deposit()` / `withdraw(uint256)`.
 *
 * Polygon is deliberately absent. Its native token is POL, and the token at
 * 0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619 is bridged ether — a UChildERC20
 * whose `deposit` is the bridge's `deposit(address,bytes)`, callable only by
 * the depositor role. Wrapping there produced a transaction that always
 * reverted, described to the user as "Deposit 1 ETH into WETH".
 */
export const supportedChains = [
  mainnet,
  optimism,
  arbitrum,
  base,
  sepolia,
];

export const WETH_ADDRESS = {
  [mainnet.id]: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  [optimism.id]: "0x4200000000000000000000000000000000000006",
  [arbitrum.id]: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
  [base.id]: "0x4200000000000000000000000000000000000006",
  [sepolia.id]: "0x7b79995e5f793a07bc00c21412e50ecae098e7f9",
} as const;

export const wethAbi = [
  {
    type: "function",
    name: "deposit",
    stateMutability: "payable",
    outputs: [],
    inputs: [],
  },
  {
    type: "function",
    name: "withdraw",
    stateMutability: "nonpayable",
    outputs: [],
    inputs: [
      {
        name: "_amount",
        type: "uint256",
      },
    ],
  },
];
