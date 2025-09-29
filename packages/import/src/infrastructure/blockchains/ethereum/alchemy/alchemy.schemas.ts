import { z } from 'zod';

/**
 * Schema for Alchemy raw contract structure
 */
export const AlchemyRawContractSchema = z.object({
  address: z.union([z.string(), z.null()]).optional(),
  decimal: z.union([z.string(), z.number(), z.null()]).optional(),
});

/**
 * Schema for Alchemy metadata structure
 */
export const AlchemyMetadataSchema = z.object({
  blockTimestamp: z.string().optional(),
});

/**
 * Schema for Alchemy asset transfer structure
 */
export const AlchemyAssetTransferSchema = z.object({
  asset: z.string().optional(),
  blockNum: z.string().min(1, 'Block number must not be empty'),
  category: z.string().min(1, 'Category must not be empty'),
  from: z.string().min(1, 'From address must not be empty'),
  hash: z.string().min(1, 'Transaction hash must not be empty'),
  metadata: AlchemyMetadataSchema.optional(),
  rawContract: AlchemyRawContractSchema.optional(),
  to: z.string().min(1, 'To address must not be empty'),
  value: z.union([z.string(), z.number(), z.null()]).optional(),
});

/**
 * Schema for arrays of Alchemy asset transfers
 */
export const AlchemyAssetTransferArraySchema = z.array(AlchemyAssetTransferSchema);

/**
 * Schema for Alchemy asset transfers response
 */
export const AlchemyAssetTransfersResponseSchema = z.object({
  pageKey: z.string().optional(),
  transfers: z.array(AlchemyAssetTransferSchema),
});

/**
 * Schema for Alchemy token balance
 */
export const AlchemyTokenBalanceSchema = z.object({
  contractAddress: z.string().min(1, 'Contract address must not be empty'),
  error: z.string().optional(),
  tokenBalance: z.string().min(1, 'Token balance must not be empty'),
});

/**
 * Schema for Alchemy token balances response
 */
export const AlchemyTokenBalancesResponseSchema = z.object({
  address: z.string().min(1, 'Address must not be empty'),
  tokenBalances: z.array(AlchemyTokenBalanceSchema),
});

/**
 * Schema for Alchemy token metadata
 */
export const AlchemyTokenMetadataSchema = z.object({
  decimals: z.number().min(0, 'Decimals must be non-negative'),
  logo: z.string().optional(),
  name: z.string().optional(),
  symbol: z.string().optional(),
});
