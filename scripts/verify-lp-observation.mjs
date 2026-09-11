import assert from 'node:assert/strict';
import { observeLPPositionTool as tool } from '../packages/shared/uniV3/observation.js';

const owner = '0x' + '1'.repeat(40), manager = '0xc36442b4a4522e871399cd717abdd847ab11fe88';
const first = '0x' + '2'.repeat(40), second = '0x' + '3'.repeat(40), factory = '0x' + '4'.repeat(40), pool = '0x' + '5'.repeat(40);
const word = v => BigInt.asUintN(256, BigInt(v)).toString(16).padStart(64, '0');
let tick = 0n, liquidity = 10n, changedOwner = false, badPool = false, locked = false, malformed = false, reorg = false, headers = 0;
const selectors = { owner: '0x6352211e', positions: '0x99fbab88', factory: '0xc45a0155', pool: '0x1698ee82', token0: '0x0dfe1681', token1: '0xd21220a7', fee: '0xddca3f43', slot: '0x3850c7bd' };
function response(method, params) {
  if (method === 'eth_blockNumber') return '0x10';
  if (method === 'eth_getBlockByNumber') {
    assert.equal(params[0], '0x10');
    return { number: '0x10', hash: '0x' + (++headers % 2 === 0 && reorg ? 'b' : 'a').repeat(64) };
  }
  if (method === 'eth_getCode') { assert.equal(params[1], '0x10'); return '0x6000'; }
  assert.equal(method, 'eth_call'); assert.equal(params[1], '0x10');
  const { to, data } = params[0];
  switch (data.slice(0, 10)) {
    case selectors.owner: assert.equal(to.toLowerCase(), manager); return '0x' + word(changedOwner ? second : owner);
    case selectors.positions: return malformed ? '0x' : '0x' + [0n, 0n, first, second, 3000n, -60n, 60n, liquidity, 0n, 0n, 9007199254740993n, 1n].map(word).join('');
    case selectors.factory: return '0x' + word(factory);
    case selectors.pool: return '0x' + word(pool);
    case selectors.token0: return '0x' + word(badPool ? second : first);
    case selectors.token1: return '0x' + word(second);
    case selectors.fee: return '0x' + word(3000n);
    case selectors.slot: return '0x' + [1n, tick, 0n, 0n, 0n, 0n, locked ? 0n : 1n].map(word).join('');
    default: throw new Error(`Unexpected call ${data}`);
  }
}
let execute;

globalThis.fetch = () => { throw new Error('Network forbidden'); };

const rpc = { getBlockNumber: async () => 16n, getCode: async args => { assert.equal(args.blockNumber, 16n); return '0x6000'; },
  request: async args => response(args.method, args.params),
  call: async args => { assert.equal(args.blockNumber, 16n); return { data: response('eth_call', [{ to: args.to, data: args.data }, '0x10']) }; } };
execute = args => tool.execute({ getPublicClient: () => rpc, getWalletClient() { throw new Error('Signing forbidden'); } }, tool.parameters.parse(args));

const args = { owner, chainId: 1, tokenId: '9007199254740993' };
let result = await execute(args);
assert.equal(result.tokenID, args.tokenId); assert.equal(result.tokensOwed0, '9007199254740993'); assert.equal(result.range.status, 'In range');
tick = -60n; assert.equal((await execute(args)).range.status, 'In range');
tick = 60n; assert.equal((await execute(args)).range.status, 'Out of range');
liquidity = 0n; assert.equal((await execute(args)).range.status, 'No active liquidity'); liquidity = 10n;
badPool = true; result = await execute(args); assert.equal(result.range, null); assert.ok(result.rangeError); badPool = false;
locked = true; assert.equal((await execute(args)).range, null); locked = false;
tick = 887273n; assert.equal((await execute(args)).range, null); tick = 0n;
changedOwner = true; await assert.rejects(() => execute(args)); changedOwner = false;
malformed = true; await assert.rejects(() => execute(args)); malformed = false;
headers = 0; reorg = true; await assert.rejects(() => execute(args)); reorg = false;
await assert.rejects(async () => execute({ ...args, tokenId: (1n << 256n).toString() }));
console.log('LP observation: exact IDs/amounts, range boundaries, unknown pool failures, ownership, malformed data and reorg rejection passed offline.');

