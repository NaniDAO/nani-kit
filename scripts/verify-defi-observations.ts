import assert from "node:assert/strict";
import { observeAaveAccountTool as aave } from "../packages/shared/aave/observation.js";
import { discoverLPPositionsTool as lp } from "../packages/shared/uniV3/discovery.js";
globalThis.fetch = () => { throw new Error("Network forbidden"); };
const owner = "0x1111111111111111111111111111111111111111";
const word = (v: bigint) => v.toString(16).padStart(64, "0");
let data = "0x" + [9007199254740993n, 1n, 0n, 8000n, 7500n, 1000000000000000000n].map(word).join("");
let code = "0x6000", reads = 0, reorg = false, duplicate = false, malformed = false;
const rpc = {
  getBlockNumber: async () => 16n,
  getCode: async (args: any) => { assert.equal(args.blockNumber, 16n); return code; },
  request: async () => ({ number: "0x10", hash: "0x" + ((++reads % 2 === 0 && reorg) ? "b" : "a").repeat(64) }),
  call: async (args: any) => {
    assert.equal(args.blockNumber, 16n);
    if (args.data.startsWith("0xbf92857c")) return { data };
    if (args.data.startsWith("0x70a08231")) return { data: "0x" + word(4n) };
    const index = BigInt("0x" + args.data.slice(-64));
    return { data: malformed && index === 1n ? "0x" : "0x" + word(9007199254740993n + (duplicate ? 0n : index)) };
  },
};
const client: any = { getPublicClient: () => rpc, getWalletClient() { throw new Error("Signing forbidden"); }, executeOps() { throw new Error("Broadcast forbidden"); } };
const args = { owner, chainId: 1 };
let observed = await aave.execute(client, args);
assert.equal(observed.collateral, "90071992.54740993");
assert.equal(observed.needsAttention, true);
assert.equal(observed.healthFactor, "1");
data = "0x" + [0n, 0n, 0n, 0n, 0n, (1n << 256n) - 1n].map(word).join("");
observed = await aave.execute(client, args);
assert.equal(observed.needsAttention, false);
assert.match(observed.healthFactor, /no debt/);
data = "0x";
await assert.rejects(aave.execute(client, args));
code = "0x";
await assert.rejects(aave.execute(client, args));
await assert.rejects(aave.execute(client, { ...args, chainId: 11155111 }));
const pageArgs = { ...args, offset: 0 };
let page = await lp.execute(client, pageArgs);
assert.deepEqual(page.tokenIDs, ["9007199254740993", "9007199254740994", "9007199254740995"]);
assert.equal(page.nextOffset, 3);
page = await lp.execute(client, { ...args, offset: 3, block: page.block, blockHash: page.blockHash });
assert.equal(page.nextOffset, null);
assert.deepEqual(page.tokenIDs, ["9007199254740996"]);
malformed = true;
page = await lp.execute(client, pageArgs);
assert.equal(page.errors.length, 1);
assert.equal(page.tokenIDs.length, 2);
malformed = false; duplicate = true;
page = await lp.execute(client, pageArgs);
assert.equal(page.errors.length, 2);
await assert.rejects(lp.execute(client, { ...args, offset: 1 }));
await assert.rejects(lp.execute(client, { ...args, offset: 5, block: "0x10", blockHash: "0x" + "a".repeat(64) }));
await assert.rejects(lp.execute(client, { ...pageArgs, block: "0x10", blockHash: "0x" + "b".repeat(64) }));
reads = 0; reorg = true;
await assert.rejects(lp.execute(client, pageArgs));
console.log("Shared DeFi source fixtures passed; no network or signing.");
