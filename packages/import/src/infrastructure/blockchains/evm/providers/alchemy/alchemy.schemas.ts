import { z } from 'zod';

import { hexOrNumericToNumeric } from '../../../../shared/utils/zod-utils.js';

/**
 * Schema for Alchemy raw contract structure
 */
export const AlchemyRawContractSchema = z.object({
  address: z.union([z.string(), z.null()]).optional(),
  decimal: hexOrNumericToNumeric,
  value: hexOrNumericToNumeric,
});

/**
 * Schema for Alchemy metadata structure
 */
export const AlchemyMetadataSchema = z.object({
  blockTimestamp: z.string().datetime('Block timestamp must be valid ISO 8601 format').optional(),
});

/**
 * Schema for Alchemy asset transfer structure
 */
export const AlchemyAssetTransferSchema = z.object({
  asset: z.union([z.string(), z.null()]).optional(),
  blockNum: z.string().regex(/^(0x)?[\da-fA-F]+$/, 'Block number must be hex string'),
  category: z.string().min(1, 'Category must not be empty'),
  erc1155Metadata: z
    .union([
      z.array(
        z.object({
          tokenId: z.string().optional(),
          value: hexOrNumericToNumeric,
        })
      ),
      z.null(),
    ])
    .optional(),
  erc721TokenId: z.union([z.string(), z.null()]).optional(),
  from: z.string().min(1, 'From address must not be empty'),
  hash: z.string().min(1, 'Transaction hash must not be empty'),
  metadata: AlchemyMetadataSchema.optional(),
  rawContract: AlchemyRawContractSchema.optional(),
  to: z.string().min(1, 'To address must not be empty'),
  tokenId: z.union([z.string(), z.null()]).optional(),
  uniqueId: z.string().optional(),
  value: hexOrNumericToNumeric,
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
