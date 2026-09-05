import { z } from "zod";
import { createTool } from "../client.js";
import { createWnsClient } from "wns-utils";

const wns = createWnsClient();

export const resolveWNSTool = createTool({
  name: "resolveWNS",
  description:
    "Resolves a .wei name to an Ethereum address. Accepts 'name' or 'name.wei'.",
  parameters: z.object({
    name: z.string().describe("The .wei name to resolve (e.g. 'alice' or 'alice.wei')"),
  }),
  execute: async (_client, args) => {
    const address = await wns.resolve(args.name);
    if (!address) {
      throw new Error(`No address found for WNS name: ${args.name}`);
    }
    return address;
  },
});

export const reverseResolveWNSTool = createTool({
  name: "reverseResolveWNS",
  description:
    "Reverse resolves an Ethereum address to its primary .wei name.",
  parameters: z.object({
    address: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/)
      .describe("The Ethereum address to reverse resolve"),
  }),
  execute: async (_client, args) => {
    const name = await wns.reverseResolve(args.address);
    if (!name) {
      throw new Error(`No .wei name found for ${args.address}`);
    }
    return name;
  },
});

export const resolveAnyWNSTool = createTool({
  name: "resolveAnyWNS",
  description:
    "Smart resolve: if input is an Ethereum address, returns it directly. If it's a .wei name or bare label, resolves it to an address.",
  parameters: z.object({
    input: z
      .string()
      .describe("An Ethereum address or .wei name to resolve"),
  }),
  execute: async (_client, args) => {
    const address = await wns.resolveAny(args.input);
    if (!address) {
      throw new Error(`Could not resolve: ${args.input}`);
    }
    return address;
  },
});

export const isAvailableWNSTool = createTool({
  name: "isAvailableWNS",
  description: "Check if a .wei label is available for registration.",
  parameters: z.object({
    label: z.string().describe("The label to check availability for (e.g. 'alice')"),
    parentId: z
      .string()
      .optional()
      .describe("Optional parent token ID as a decimal string for subdomain checks (defaults to 0 for top-level)"),
  }),
  execute: async (_client, args) => {
    const parentId = args.parentId ? BigInt(args.parentId) : 0n;
    return wns.isAvailable(args.label, parentId);
  },
});

export const isExpiredWNSTool = createTool({
  name: "isExpiredWNS",
  description: "Check if a .wei name is expired.",
  parameters: z.object({
    name: z.string().describe("The .wei name to check (e.g. 'alice' or 'alice.wei')"),
  }),
  execute: async (_client, args) => {
    return wns.isExpired(args.name);
  },
});

export const getWNSExpirationTool = createTool({
  name: "getWNSExpiration",
  description: "Get the expiration timestamp (unix seconds) for a .wei name.",
  parameters: z.object({
    name: z.string().describe("The .wei name to check (e.g. 'alice' or 'alice.wei')"),
  }),
  execute: async (_client, args) => {
    const expiresAt = await wns.expiresAt(args.name);
    return {
      expiresAt: expiresAt.toString(),
      expiresAtDate: expiresAt > 0n ? new Date(Number(expiresAt) * 1000).toISOString() : null,
    };
  },
});

export const getWNSOwnerTool = createTool({
  name: "getWNSOwner",
  description: "Get the owner address of a .wei name.",
  parameters: z.object({
    name: z.string().describe("The .wei name to check (e.g. 'alice' or 'alice.wei')"),
  }),
  execute: async (_client, args) => {
    const owner = await wns.ownerOf(args.name);
    if (!owner) {
      throw new Error(`No owner found for: ${args.name}`);
    }
    return owner;
  },
});

export const getWNSBalanceTool = createTool({
  name: "getWNSBalance",
  description: "Get the number of .wei names owned by an address.",
  parameters: z.object({
    address: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/)
      .describe("The Ethereum address to check"),
  }),
  execute: async (_client, args) => {
    const balance = await wns.balanceOf(args.address);
    return balance.toString();
  },
});

export const getWNSTextTool = createTool({
  name: "getWNSText",
  description: "Get a text record for a .wei name (e.g. 'url', 'description', 'avatar', 'com.twitter', 'com.github').",
  parameters: z.object({
    name: z.string().describe("The .wei name (e.g. 'alice' or 'alice.wei')"),
    key: z.string().describe("The text record key (e.g. 'url', 'avatar', 'com.twitter')"),
  }),
  execute: async (_client, args) => {
    const value = await wns.getText(args.name, args.key);
    if (value === null) {
      throw new Error(`No text record '${args.key}' found for: ${args.name}`);
    }
    return value;
  },
});

export const getWNSContenthashTool = createTool({
  name: "getWNSContenthash",
  description: "Get the contenthash for a .wei name.",
  parameters: z.object({
    name: z.string().describe("The .wei name (e.g. 'alice' or 'alice.wei')"),
  }),
  execute: async (_client, args) => {
    const hash = await wns.getContenthash(args.name);
    if (!hash) {
      throw new Error(`No contenthash found for: ${args.name}`);
    }
    return hash;
  },
});

export const getWNSFeeTool = createTool({
  name: "getWNSFee",
  description: "Get the registration fee for a .wei name based on label length.",
  parameters: z.object({
    length: z
      .number()
      .int()
      .positive()
      .describe("The character length of the label to check the fee for"),
  }),
  execute: async (_client, args) => {
    const fee = await wns.getFee(BigInt(args.length));
    return {
      feeWei: fee.toString(),
      feeEth: (Number(fee) / 1e18).toFixed(6),
    };
  },
});

export const getWNSTokenURITool = createTool({
  name: "getWNSTokenURI",
  description: "Get the token URI (metadata) for a .wei name.",
  parameters: z.object({
    name: z.string().describe("The .wei name (e.g. 'alice' or 'alice.wei')"),
  }),
  execute: async (_client, args) => {
    const uri = await wns.tokenURI(args.name);
    if (!uri) {
      throw new Error(`No token URI found for: ${args.name}`);
    }
    return uri;
  },
});

export const intentRegisterWNSTool = createTool({
  name: "intentRegisterWNS",
  description:
    "Generate transaction intents for registering a .wei name. Returns the commit and reveal transactions needed for the two-step registration process.",
  parameters: z.object({
    label: z.string().describe("The label to register (e.g. 'alice')"),
    secret: z
      .string()
      .describe("A bytes32 secret for the commit-reveal scheme (e.g. '0x...')"),
    value: z
      .string()
      .describe("The registration fee in wei as a decimal string"),
  }),
  execute: async (client, args) => {
    const owner = await client.getAddress();
    const commitment = await wns.makeCommitment(args.label, owner, args.secret);
    const commitTx = wns.encodeCommit(commitment);
    const revealTx = wns.encodeReveal(args.label, args.secret, BigInt(args.value));

    // Returned as {intent, ops, chain} like every other intent in the library.
    // The custom {intent, steps} shape left this tool outside the Intent type
    // it declares, so anything iterating `ops` found undefined and silently
    // executed neither half of the commit-reveal.
    return {
      intent: `Register ${args.label}.wei`,
      ops: [
        { target: commitTx.to, data: commitTx.data, value: "0" },
        {
          target: revealTx.to,
          data: revealTx.data,
          value: revealTx.value?.toString() ?? args.value,
        },
      ],
      chain: 1,
      // Registration is commit-reveal: the two ops are ordered and the reveal
      // is rejected until the commitment has aged. Callers that submit ops
      // back-to-back need to know that.
      notes: [
        "Op 1 submits the commitment hash.",
        "Wait at least 60 seconds before submitting op 2, or the reveal reverts.",
      ],
    };
  },
});

export const intentRenewWNSTool = createTool({
  name: "intentRenewWNS",
  description: "Generate a transaction intent for renewing a .wei name.",
  parameters: z.object({
    name: z.string().describe("The .wei name to renew (e.g. 'alice' or 'alice.wei')"),
    value: z
      .string()
      .describe("The renewal fee in wei as a decimal string"),
  }),
  execute: async (_client, args) => {
    const tx = await wns.encodeRenew(args.name, BigInt(args.value));
    return {
      intent: `Renew ${args.name}`,
      ops: [
        {
          target: tx.to,
          data: tx.data,
          value: tx.value?.toString() ?? args.value,
        },
      ],
      chain: 1,
    };
  },
});

export const intentSetPrimaryWNSTool = createTool({
  name: "intentSetPrimaryWNS",
  description: "Generate a transaction intent for setting a .wei name as the primary name.",
  parameters: z.object({
    name: z.string().describe("The .wei name to set as primary (e.g. 'alice' or 'alice.wei')"),
  }),
  execute: async (_client, args) => {
    const tx = await wns.encodeSetPrimaryName(args.name);
    return {
      intent: `Set primary name to ${args.name}`,
      ops: [{ target: tx.to, data: tx.data, value: "0" }],
      chain: 1,
    };
  },
});

export const intentSetWNSTextTool = createTool({
  name: "intentSetWNSText",
  description: "Generate a transaction intent for setting a text record on a .wei name.",
  parameters: z.object({
    name: z.string().describe("The .wei name (e.g. 'alice' or 'alice.wei')"),
    key: z.string().describe("The text record key (e.g. 'url', 'avatar', 'com.twitter')"),
    value: z.string().describe("The text record value to set"),
  }),
  execute: async (_client, args) => {
    const tx = await wns.encodeSetText(args.name, args.key, args.value);
    return {
      intent: `Set text record '${args.key}' on ${args.name}`,
      ops: [{ target: tx.to, data: tx.data, value: "0" }],
      chain: 1,
    };
  },
});

export const intentSetWNSAddrTool = createTool({
  name: "intentSetWNSAddr",
  description: "Generate a transaction intent for setting the address record on a .wei name.",
  parameters: z.object({
    name: z.string().describe("The .wei name (e.g. 'alice' or 'alice.wei')"),
    addr: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/)
      .describe("The Ethereum address to set"),
  }),
  execute: async (_client, args) => {
    const tx = await wns.encodeSetAddr(args.name, args.addr);
    return {
      intent: `Set address for ${args.name}`,
      ops: [{ target: tx.to, data: tx.data, value: "0" }],
      chain: 1,
    };
  },
});

export const intentSetWNSContenthashTool = createTool({
  name: "intentSetWNSContenthash",
  description: "Generate a transaction intent for setting the contenthash on a .wei name.",
  parameters: z.object({
    name: z.string().describe("The .wei name (e.g. 'alice' or 'alice.wei')"),
    hash: z.string().describe("The contenthash to set (hex-encoded)"),
  }),
  execute: async (_client, args) => {
    const tx = await wns.encodeSetContenthash(args.name, args.hash);
    return {
      intent: `Set contenthash for ${args.name}`,
      ops: [{ target: tx.to, data: tx.data, value: "0" }],
      chain: 1,
    };
  },
});

export const intentRegisterSubdomainWNSTool = createTool({
  name: "intentRegisterSubdomainWNS",
  description: "Generate a transaction intent for registering a subdomain under a .wei name.",
  parameters: z.object({
    label: z.string().describe("The subdomain label to register (e.g. 'sub')"),
    parentName: z
      .string()
      .describe("The parent .wei name (e.g. 'alice' or 'alice.wei')"),
  }),
  execute: async (_client, args) => {
    const tx = await wns.encodeRegisterSubdomain(args.label, args.parentName);
    return {
      intent: `Register subdomain ${args.label}.${args.parentName}`,
      ops: [{ target: tx.to, data: tx.data, value: "0" }],
      chain: 1,
    };
  },
});
