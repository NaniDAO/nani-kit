import { describe, it, expect } from "vitest";
import { createPublicClient, http, erc721Abi, type Address } from "viem";
import { mainnet } from "viem/chains";
import { getNFTMetadataTool } from "./tools.js";
import { type AgentekClient, createAgentekClient } from "../client.js";
import { nftTools } from "./index.js";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { resolveTransports } from "../chains/config.js";

const publicClient = createPublicClient({
  chain: mainnet,
  transport: resolveTransports([mainnet])[0],
});

const mockClient: AgentekClient = createAgentekClient({
  transports: resolveTransports([mainnet]),
  chains: [mainnet],
  accountOrAddress: privateKeyToAccount(generatePrivateKey()),
  tools: nftTools(),
});

// Well-known NFT contracts for testing
const BAYC_CONTRACT = "0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D" as Address;
const BAYC_TOKEN_ID = "1"; // Token ID 1 - one of the first BAYC NFTs

const CRYPTOPUNKS_CONTRACT = "0xb47e3cd837dDF8e4c57F05d70Ab865de6e193BBB" as Address;

// Azuki - another well-known NFT collection
const AZUKI_CONTRACT = "0xED5AF388653567Af2F388E6224dC7C4b3241C544" as Address;
const AZUKI_TOKEN_ID = "1";

describe("ERC721 Tools", () => {
  describe("getNFTMetadataTool", () => {
    it("should get metadata for BAYC NFT", async () => {
      // Fetch onchain data for comparison
      const [onchainName, onchainSymbol, onchainOwner, onchainTokenURI] = await Promise.all([
        publicClient.readContract({
          address: BAYC_CONTRACT,
          abi: erc721Abi,
          functionName: "name",
        }),
        publicClient.readContract({
          address: BAYC_CONTRACT,
          abi: erc721Abi,
          functionName: "symbol",
        }),
        publicClient.readContract({
          address: BAYC_CONTRACT,
          abi: erc721Abi,
          functionName: "ownerOf",
          args: [BigInt(BAYC_TOKEN_ID)],
        }),
        publicClient.readContract({
          address: BAYC_CONTRACT,
          abi: erc721Abi,
          functionName: "tokenURI",
          args: [BigInt(BAYC_TOKEN_ID)],
        }),
      ]);

      const result = await getNFTMetadataTool.execute(mockClient, {
        contractAddress: BAYC_CONTRACT,
        tokenId: BAYC_TOKEN_ID,
        chainId: 1,
      });

      expect(result).toMatchObject({
        chain: 1,
        contractAddress: BAYC_CONTRACT,
        tokenId: BAYC_TOKEN_ID,
        name: onchainName,
        symbol: onchainSymbol,
        owner: onchainOwner,
        tokenURI: onchainTokenURI,
      });

      // BAYC has metadata, verify it's fetched
      expect(result.metadata).toBeDefined();
    }, 30000);

    it("should return correct BAYC collection name and symbol", async () => {
      const result = await getNFTMetadataTool.execute(mockClient, {
        contractAddress: BAYC_CONTRACT,
        tokenId: BAYC_TOKEN_ID,
        chainId: 1,
      });

      expect(result.name).toBe("BoredApeYachtClub");
      expect(result.symbol).toBe("BAYC");
    }, 30000);

    it("should get metadata for Azuki NFT", async () => {
      // Fetch onchain data for comparison
      const [onchainName, onchainSymbol, onchainOwner] = await Promise.all([
        publicClient.readContract({
          address: AZUKI_CONTRACT,
          abi: erc721Abi,
          functionName: "name",
        }),
        publicClient.readContract({
          address: AZUKI_CONTRACT,
          abi: erc721Abi,
          functionName: "symbol",
        }),
        publicClient.readContract({
          address: AZUKI_CONTRACT,
          abi: erc721Abi,
          functionName: "ownerOf",
          args: [BigInt(AZUKI_TOKEN_ID)],
        }),
      ]);

      const result = await getNFTMetadataTool.execute(mockClient, {
        contractAddress: AZUKI_CONTRACT,
        tokenId: AZUKI_TOKEN_ID,
        chainId: 1,
      });

      expect(result).toMatchObject({
        chain: 1,
        contractAddress: AZUKI_CONTRACT,
        tokenId: AZUKI_TOKEN_ID,
        name: onchainName,
        symbol: onchainSymbol,
        owner: onchainOwner,
      });
    }, 30000);

    it("should return correct Azuki collection name and symbol", async () => {
      const result = await getNFTMetadataTool.execute(mockClient, {
        contractAddress: AZUKI_CONTRACT,
        tokenId: AZUKI_TOKEN_ID,
        chainId: 1,
      });

      expect(result.name).toBe("Azuki");
      expect(result.symbol).toBe("AZUKI");
    }, 30000);

    it("should handle non-existent token ID gracefully", async () => {
      // Token ID that likely doesn't exist (very high number)
      const nonExistentTokenId = "999999999999";

      const result = await getNFTMetadataTool.execute(mockClient, {
        contractAddress: BAYC_CONTRACT,
        tokenId: nonExistentTokenId,
        chainId: 1,
      });

      // Should return an error response
      expect(result.chain).toBe(1);
      expect(result.error).toBeDefined();
    }, 30000);

    it("should handle invalid contract address gracefully", async () => {
      // Address that is not an NFT contract (Vitalik's address)
      const notNFTContract = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" as Address;

      const result = await getNFTMetadataTool.execute(mockClient, {
        contractAddress: notNFTContract,
        tokenId: "1",
        chainId: 1,
      });

      // Should return an error response
      expect(result.chain).toBe(1);
      expect(result.error).toBeDefined();
    }, 30000);

    it("should return owner address as valid Ethereum address", async () => {
      const result = await getNFTMetadataTool.execute(mockClient, {
        contractAddress: BAYC_CONTRACT,
        tokenId: BAYC_TOKEN_ID,
        chainId: 1,
      });

      expect(result.owner).toMatch(/^0x[a-fA-F0-9]{40}$/);
    }, 30000);

    it("should return tokenURI for BAYC", async () => {
      const result = await getNFTMetadataTool.execute(mockClient, {
        contractAddress: BAYC_CONTRACT,
        tokenId: BAYC_TOKEN_ID,
        chainId: 1,
      });

      expect(result.tokenURI).toBeDefined();
      expect(typeof result.tokenURI).toBe("string");
      expect(result.tokenURI.length).toBeGreaterThan(0);
    }, 30000);

    it("should fetch and parse BAYC metadata from tokenURI", async () => {
      const result = await getNFTMetadataTool.execute(mockClient, {
        contractAddress: BAYC_CONTRACT,
        tokenId: BAYC_TOKEN_ID,
        chainId: 1,
      });

      // BAYC metadata should have standard NFT metadata fields
      if (result.metadata) {
        // Image field is standard in NFT metadata
        expect(result.metadata).toHaveProperty("image");
      }
    }, 30000);

    it("should work with different token IDs in same collection", async () => {
      const tokenId1 = "1";
      const tokenId2 = "100";

      const [result1, result2] = await Promise.all([
        getNFTMetadataTool.execute(mockClient, {
          contractAddress: BAYC_CONTRACT,
          tokenId: tokenId1,
          chainId: 1,
        }),
        getNFTMetadataTool.execute(mockClient, {
          contractAddress: BAYC_CONTRACT,
          tokenId: tokenId2,
          chainId: 1,
        }),
      ]);

      // Both should have same collection info
      expect(result1.name).toBe(result2.name);
      expect(result1.symbol).toBe(result2.symbol);
      expect(result1.contractAddress).toBe(result2.contractAddress);

      // But different token-specific info
      expect(result1.tokenId).toBe(tokenId1);
      expect(result2.tokenId).toBe(tokenId2);
      // Owners may be different
      expect(result1.owner).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(result2.owner).toMatch(/^0x[a-fA-F0-9]{40}$/);
    }, 60000);
  });

  describe("getNFTMetadataTool tool structure", () => {
    it("should have correct tool name", () => {
      expect(getNFTMetadataTool.name).toBe("getNFTMetadata");
    });

    it("should have a description", () => {
      expect(getNFTMetadataTool.description).toBeDefined();
      expect(typeof getNFTMetadataTool.description).toBe("string");
      expect(getNFTMetadataTool.description.length).toBeGreaterThan(0);
    });

    it("should have parameters schema", () => {
      expect(getNFTMetadataTool.parameters).toBeDefined();
      expect(typeof getNFTMetadataTool.parameters.parse).toBe("function");
    });

    it("should have execute function", () => {
      expect(getNFTMetadataTool.execute).toBeDefined();
      expect(typeof getNFTMetadataTool.execute).toBe("function");
    });

    it("should have supportedChains defined", () => {
      expect(getNFTMetadataTool.supportedChains).toBeDefined();
      expect(Array.isArray(getNFTMetadataTool.supportedChains)).toBe(true);
      expect(getNFTMetadataTool.supportedChains.length).toBeGreaterThan(0);
    });

    it("should include mainnet in supported chains", () => {
      const chainIds = getNFTMetadataTool.supportedChains?.map(c => c.id) || [];
      expect(chainIds).toContain(1); // Mainnet chain ID
    });
  });

  describe("parameter validation", () => {
    it("should accept valid parameters", () => {
      const params = {
        contractAddress: BAYC_CONTRACT,
        tokenId: "1",
        chainId: 1,
      };

      const parsed = getNFTMetadataTool.parameters.parse(params);
      expect(parsed.contractAddress).toBe(BAYC_CONTRACT);
      expect(parsed.tokenId).toBe("1");
      expect(parsed.chainId).toBe(1);
    });

    it("should reject invalid contract address", () => {
      const params = {
        contractAddress: "not-an-address",
        tokenId: "1",
        chainId: 1,
      };

      expect(() => getNFTMetadataTool.parameters.parse(params)).toThrow();
    });

    it("should accept tokenId as string", () => {
      const params = {
        contractAddress: BAYC_CONTRACT,
        tokenId: "12345",
        chainId: 1,
      };

      const parsed = getNFTMetadataTool.parameters.parse(params);
      expect(parsed.tokenId).toBe("12345");
    });

    it("should require chainId", () => {
      const params = {
        contractAddress: BAYC_CONTRACT,
        tokenId: "1",
      };

      expect(() => getNFTMetadataTool.parameters.parse(params)).toThrow();
    });
  });
});
