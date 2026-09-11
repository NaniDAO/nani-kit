import { z } from 'zod';
import { encodeFunctionData, erc20Abi, parseUnits, type Address } from 'viem';
import { mainnet, optimism, arbitrum, base, polygon } from 'viem/chains';
import { createTool } from '../client.js';
import { robinhood } from '../chains/robinhood.js';
import { ACROSS_SPOKE_POOL_ADDRESS, acrossSpokePoolAbi } from './constants.js';
export const bridgeChains = [mainnet, optimism, arbitrum, base, polygon, robinhood];
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const chain = z.number().int().positive();
const pair = z.object({originChainId:chain,destinationChainId:chain});
const integer = (value: unknown, name: string): bigint => {
  if(typeof value !== 'string' || !/^(0|[1-9][0-9]{0,77})$/.test(value) || BigInt(value) >= 1n<<256n) throw new Error(`Invalid exact ${name}`);
  return BigInt(value);
};
function endpoints(origin: number, destination: number) {
  if(origin === destination || !bridgeChains.some(c=>c.id===origin) || !bridgeChains.some(c=>c.id===destination)) throw new Error('Choose two configured mainnets; no network substitution');
}
async function json(url: string) {
  const response = await fetch(url, {redirect:'error'});
  if(!response.ok) throw new Error(`Across request failed (HTTP ${response.status}); route availability unknown`);
  return response.json();
}
export const getAcrossRoutes = createTool({name:'getAcrossRoutes',supportedChains:bridgeChains,
  description:'Discover exact Across token pairs and native ETH routes on requested networks. Empty means no listed routes; failed requests remain unknown. Deployment configuration is separate.',parameters:pair,
  execute:async(_client,args)=> {
    endpoints(args.originChainId,args.destinationChainId);
    const query=new URLSearchParams({originChainId:String(args.originChainId),destinationChainId:String(args.destinationChainId)});
    const rows=await json(`https://app.across.to/api/available-routes?${query}`);
    if(!Array.isArray(rows)) throw new Error('Malformed Across route list');
    const routes=[]; let ignored=0;
    for(const row of rows) {
      if(row.originChainId !== args.originChainId || row.destinationChainId !== args.destinationChainId ||
        !address.safeParse(row.originToken).success || !address.safeParse(row.destinationToken).success ||
        typeof row.originTokenSymbol !== 'string' || typeof row.destinationTokenSymbol !== 'string' || typeof row.isNative !== 'boolean') {ignored++;continue;}
      routes.push({originChainId:row.originChainId,destinationChainId:row.destinationChainId,inputToken:row.originToken.toLowerCase(),outputToken:row.destinationToken.toLowerCase(),symbol:row.isNative?'ETH':row.originTokenSymbol,outputSymbol:row.destinationTokenSymbol,isNative:row.isNative});
    }
    return {schemaVersion:1,source:'https://app.across.to/api/available-routes',observedAt:new Date().toISOString(),...args,routes,ignored,
      deploymentConfigured:!!ACROSS_SPOKE_POOL_ADDRESS[args.originChainId] && !!ACROSS_SPOKE_POOL_ADDRESS[args.destinationChainId]};
  }});
export const bridgeSchema=pair.extend({inputToken:address,outputToken:address,amount:z.string().regex(/^(0|[1-9][0-9]*)(\.[0-9]+)?$/),recipient:address,isNative:z.boolean().default(false)});
export const getAcrossFeeQuote=createTool({name:'getAcrossFeeQuote',supportedChains:bridgeChains,
 description:'Get a validated exact-amount Across quote on a live token route. No signing; unknown fees fail. Native ETH requires isNative true.',parameters:bridgeSchema,
 execute:async(client,args)=> {
  endpoints(args.originChainId,args.destinationChainId);
  const routes=await getAcrossRoutes.execute(client,args);
  if(!routes.deploymentConfigured) throw new Error('Across deployment addresses are not verified for this pair in this build. Discovery is available; construction is blocked.');
  const route=routes.routes.find(r=>r.inputToken===args.inputToken.toLowerCase() && r.outputToken===args.outputToken.toLowerCase() && r.isNative===args.isNative);
  if(!route) throw new Error('No live Across route for these exact tokens and native-asset selection');
  const origin=client.getPublicClient(args.originChainId),destination=client.getPublicClient(args.destinationChainId);
  const [inputDecimals,outputDecimals,originCode,destinationCode]=await Promise.all([
    origin.readContract({address:args.inputToken as Address,abi:erc20Abi,functionName:'decimals'}),
    destination.readContract({address:args.outputToken as Address,abi:erc20Abi,functionName:'decimals'}),
    origin.getBytecode({address:ACROSS_SPOKE_POOL_ADDRESS[args.originChainId] as Address}),
    destination.getBytecode({address:ACROSS_SPOKE_POOL_ADDRESS[args.destinationChainId] as Address})]);
  if(!originCode || originCode==='0x' || !destinationCode || destinationCode==='0x') throw new Error('Across deployment code unavailable');
  if(!Number.isInteger(inputDecimals) || !Number.isInteger(outputDecimals) || inputDecimals<0 || inputDecimals>36 || inputDecimals!==outputDecimals) throw new Error('Unsupported or mismatched bridge token decimals');
  if(args.isNative && inputDecimals!==18) throw new Error('Native ETH route must use 18 decimals');
  if((args.amount.split('.')[1]?.length ?? 0)>inputDecimals) throw new Error('Amount exceeds token precision');
  const inputAmount=parseUnits(args.amount,inputDecimals); integer(inputAmount.toString(),'input amount');
  if(inputAmount<=0n) throw new Error('Amount must be positive');
  const query=new URLSearchParams({inputToken:args.inputToken,outputToken:args.outputToken,originChainId:String(args.originChainId),destinationChainId:String(args.destinationChainId),amount:inputAmount.toString(),recipient:args.recipient});
  const quote=await json(`https://across.to/api/suggested-fees?${query}`);
  if(quote.isAmountTooLow===true || quote.isAmountTooHigh===true || quote.isLiquidityInsufficient===true) throw new Error('Across cannot fill this amount');
  const fee=integer(quote.totalRelayFee?.total,'bridge fee');
  if(fee>=inputAmount) throw new Error('Fee consumes the input amount');
  // Cross-symbol routes (USDC/USDG) include conversion costs in totalRelayFee.
  // Bind the API's explicit payout and deployment identity; never infer a swap rate.
  const outputAmount=integer(quote.outputAmount,'output amount');
  if(outputAmount<=0n || outputAmount+fee!==inputAmount) throw new Error('Across output amount and total fee do not reconcile');
  if(address.parse(quote.spokePoolAddress).toLowerCase()!==ACROSS_SPOKE_POOL_ADDRESS[args.originChainId].toLowerCase() ||
     address.parse(quote.destinationSpokePoolAddress).toLowerCase()!==ACROSS_SPOKE_POOL_ADDRESS[args.destinationChainId].toLowerCase()) throw new Error('Across quote deployment mismatch');
  for(const [metadata,token,chainId,decimals] of [[quote.inputToken,args.inputToken,args.originChainId,inputDecimals],[quote.outputToken,args.outputToken,args.destinationChainId,outputDecimals]] as const) {
    if(!metadata || address.parse(metadata.address).toLowerCase()!==token.toLowerCase() || metadata.chainId!==chainId || metadata.decimals!==decimals) throw new Error('Across quote token identity mismatch');
  }
  const uint32=(v:unknown,name:string)=> {const n=typeof v==='string' && /^[0-9]+$/.test(v)?Number(v):v;if(typeof n!=='number'||!Number.isInteger(n)||n<0||n>4294967295)throw new Error(`Invalid ${name}`);return n;};
  const timestamp=uint32(quote.timestamp,'quote timestamp'),now=Math.floor(Date.now()/1000);
  // Across suggested-fees may omit fillDeadline. Construct a bounded absolute deadline.
  const fillDeadline=quote.fillDeadline===undefined?timestamp+1800:uint32(quote.fillDeadline,'fill deadline');
  if(timestamp>now+30 || timestamp<now-120 || fillDeadline<=now || fillDeadline>timestamp+21600)throw new Error('Expired or invalid Across quote window');
  const exclusiveRelayer=address.parse(quote.exclusiveRelayer);
  const exclusivityDeadline=uint32(quote.exclusivityDeadline,'exclusivity deadline');
  const eta=quote.estimatedFillTimeSec===undefined?null:uint32(quote.estimatedFillTimeSec,'estimated arrival');
  return {schemaVersion:1,source:'https://across.to/api/suggested-fees',observedAt:new Date().toISOString(),...args,route,
    inputDecimals,outputDecimals,inputAmountRaw:inputAmount.toString(),outputAmountRaw:outputAmount.toString(),feeRaw:fee.toString(),
    spokePool:ACROSS_SPOKE_POOL_ADDRESS[args.originChainId],destinationSpokePool:ACROSS_SPOKE_POOL_ADDRESS[args.destinationChainId],
    timestamp,fillDeadline,exclusiveRelayer,exclusivityDeadline,estimatedFillSeconds:eta,expiresAt:Math.min(timestamp+120,now+60),
    warning:'Source confirmation is not destination arrival. Gas is separate from bridge fees.'};
 }});
export const intentDepositAcross=createTool({name:'intentDepositAcross',supportedChains:bridgeChains,
 description:'Build an unsigned Across bridge proposal using exact approvals, live route validation and quote expiry. Supports native ETH. Never signs or submits, even with a signing client.',parameters:bridgeSchema,
 execute:async(client,args)=> {
  const owner=await client.getAddress();
  if(owner.toLowerCase()!==args.recipient.toLowerCase())throw new Error('This bridge workflow supports the same wallet on both networks only');
  const quote=await getAcrossFeeQuote.execute(client,args);
  const amount=BigInt(quote.inputAmountRaw),ops=[];
  if(!args.isNative) {
    const allowance=await client.getPublicClient(args.originChainId).readContract({address:args.inputToken as Address,abi:erc20Abi,functionName:'allowance',args:[owner,quote.spokePool as Address]});
    if(allowance<amount) {
      if(allowance>0n)ops.push({target:args.inputToken,value:'0',data:encodeFunctionData({abi:erc20Abi,functionName:'approve',args:[quote.spokePool as Address,0n]})});
      ops.push({target:args.inputToken,value:'0',data:encodeFunctionData({abi:erc20Abi,functionName:'approve',args:[quote.spokePool as Address,amount]})});
    }
  }
  ops.push({target:quote.spokePool,value:args.isNative?quote.inputAmountRaw:'0',data:encodeFunctionData({abi:acrossSpokePoolAbi,functionName:'depositV3',args:[owner,args.recipient as Address,args.inputToken as Address,args.outputToken as Address,amount,BigInt(quote.outputAmountRaw),BigInt(args.destinationChainId),quote.exclusiveRelayer as Address,quote.timestamp,quote.fillDeadline,quote.exclusivityDeadline,'0x']})});
  return {schemaVersion:1,intent:`Bridge ${args.amount} ${quote.route.symbol} to chain ${args.destinationChainId}`,owner,chain:args.originChainId,ops,bridge:quote};
 }});
