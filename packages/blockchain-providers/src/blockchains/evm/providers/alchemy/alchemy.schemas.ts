import { z } from 'zod';

import {
  hexOrNumericToNumericOptional,
  hexOrNumericToNumericRequired,
  timestampToDate,
} from '../../../../core/utils/zod-utils.js';
import { EvmAddressSchema } from '../../schemas.js';

/**
 * Schema for Alchemy raw contract structure
 */
export const AlchemyRawContractSchema = z.object({
  address: EvmAddressSchema.nullish(),
  decimal: hexOrNumericToNumericOptional,
  value: hexOrNumericToNumericOptional,
});

/**
 * Schema for Alchemy metadata structure
 */
export const AlchemyMetadataSchema = z.object({
  blockTimestamp: timestampToDate,
});

/**
 * Schema for Alchemy asset transfer request parameters
 */
export const AlchemyAssetTransferParamsSchema = z.object({
  category: z.array(z.string().min(1, 'Category entry must not be empty')),
  contractAddresses: z.array(EvmAddressSchema).nullish(),
  excludeZeroValue: z.boolean(),
  fromAddress: EvmAddressSchema.nullish(),
  fromBlock: z.string().min(1, 'From block must not be empty').nullish(),
  maxCount: z.string().min(1, 'Max count must not be empty'),
  order: z.string().nullish(),
  pageKey: z.string().nullish(),
  toAddress: EvmAddressSchema.nullish(),
  toBlock: z.string().min(1, 'To block must not be empty').nullish(),
  withMetadata: z.boolean(),
});

/**
 * Schema for Alchemy asset transfer structure
 */
export const AlchemyAssetTransferSchema = z.object({
  asset: z.string().nullish(),
  blockNum: z.string().regex(/^(0x)?[\da-fA-F]+$/, 'Block number must be hex string'),
  category: z.string().min(1, 'Category must not be empty'),
  erc1155Metadata: z
    .array(
      z.object({
        tokenId: z.string().nullish(),
        value: hexOrNumericToNumericOptional,
      })
    )
    .nullish(),
  erc721TokenId: z.string().nullish(),
  from: EvmAddressSchema,
  hash: z.string().min(1, 'Transaction hash must not be empty'),
  metadata: AlchemyMetadataSchema,
  rawContract: AlchemyRawContractSchema.nullish(),
  to: EvmAddressSchema.nullish(),
  tokenId: z.string().nullish(),
  uniqueId: z.string().nullish(),
  value: hexOrNumericToNumericOptional,

  // Receipt data (added by API client after fetching from eth_getTransactionReceipt)
  _gasUsed: z.string().nullish(),
  _effectiveGasPrice: z.string().nullish(),

  // Native currency for the chain (added by API client for gas fee calculation)
  _nativeCurrency: z.string().nullish(),
});

/**
 * Schema for arrays of Alchemy asset transfers
 */
export const AlchemyAssetTransferArraySchema = z.array(AlchemyAssetTransferSchema);

/**
 * Schema for Alchemy asset transfers response
 */
export const AlchemyAssetTransfersResponseSchema = z.object({
  pageKey: z.string().nullish(),
  transfers: z.array(AlchemyAssetTransferSchema),
});

/**
 * Schema for Alchemy token metadata
 */
export const AlchemyTokenMetadataSchema = z.object({
  decimals: z.number().min(0, 'Decimals must be non-negative'),
  logo: z.string().nullish(),
  name: z.string().nullish(),
  symbol: z.string().nullish(),
});

/**
 * Schema for Alchemy Portfolio API token price
 */
export const AlchemyPortfolioTokenPriceSchema = z.object({
  currency: z.string(),
  lastUpdatedAt: z.string(),
  value: z.string(),
});

/**
 * Schema for Alchemy Portfolio API token metadata
 */
export const AlchemyPortfolioTokenMetadataSchema = z.object({
  decimals: z.number().nullable(),
  logo: z.string().nullable(),
  name: z.string().nullable(),
  symbol: z.string().nullable(),
});

/**
 * Schema for Alchemy Portfolio API token balance
 */
export const AlchemyPortfolioTokenBalanceSchema = z.object({
  address: EvmAddressSchema,
  network: z.string(),
  tokenAddress: EvmAddressSchema.nullish(),
  tokenBalance: z.string(),
  tokenMetadata: AlchemyPortfolioTokenMetadataSchema.nullish(),
  tokenPrices: z.array(AlchemyPortfolioTokenPriceSchema).nullish(),
});

/**
 * Schema for Alchemy Portfolio API balance response
 */
export const AlchemyPortfolioBalanceResponseSchema = z.object({
  data: z.object({
    tokens: z.array(AlchemyPortfolioTokenBalanceSchema),
  }),
});

/**
 * Schema for Alchemy Portfolio API request address
 */
export const AlchemyPortfolioAddressSchema = z.object({
  address: EvmAddressSchema,
  networks: z.array(z.string()),
});

/**
 * Schema for Alchemy Portfolio API balance request
 */
export const AlchemyPortfolioBalanceRequestSchema = z.object({
  addresses: z.array(AlchemyPortfolioAddressSchema),
  includeNativeToken: z.boolean().nullish(),
  withMetadata: z.boolean().nullish(),
  withPrices: z.boolean().nullish(),
});

/**
 * Schema for eth_getTransactionReceipt response
 * Used to fetch gas fees for transactions
 */
export const AlchemyTransactionReceiptSchema = z.object({
  blockHash: z.string(),
  blockNumber: z.string().regex(/^0x[\da-fA-F]+$/, 'Block number must be hex string'),
  contractAddress: EvmAddressSchema.nullish(),
  cumulativeGasUsed: hexOrNumericToNumericRequired,
  effectiveGasPrice: hexOrNumericToNumericRequired.nullish(), // Only available post-EIP-1559
  from: EvmAddressSchema,
  gasUsed: hexOrNumericToNumericRequired,
  logs: z.array(z.any()).nullish(),
  logsBloom: z.string().nullish(),
  status: z.string().regex(/^0x[01]$/, 'Status must be 0x0 or 0x1'),
  to: EvmAddressSchema.nullish(),
  transactionHash: z.string(),
  transactionIndex: z.string().regex(/^0x[\da-fA-F]+$/, 'Transaction index must be hex string'),
  type: z
    .string()
    .regex(/^0x[\da-fA-F]+$/, 'Type must be hex string')
    .nullish(),
});

/**
 * JSON-RPC wrapper schema for eth_getTransactionReceipt
 */
export const AlchemyTransactionReceiptResponseSchema = z.object({
  jsonrpc: z.string().nullish(),
  id: z.union([z.string(), z.number()]).nullish(),
  result: AlchemyTransactionReceiptSchema.nullish(),
  error: z.object({ code: z.number(), message: z.string() }).nullish(),
});

/**
 * JSON-RPC wrapper schema for alchemy_getAssetTransfers
 */
export const AlchemyAssetTransfersJsonRpcResponseSchema = z.object({
  jsonrpc: z.string().nullish(),
  id: z.union([z.string(), z.number()]).nullish(),
  result: AlchemyAssetTransfersResponseSchema.nullish(),
  error: z.object({ code: z.number(), message: z.string() }).nullish(),
});

// Type exports inferred from schemas
export type AlchemyRawContract = z.infer<typeof AlchemyRawContractSchema>;
export type AlchemyMetadata = z.infer<typeof AlchemyMetadataSchema>;
export type AlchemyAssetTransferParams = z.infer<typeof AlchemyAssetTransferParamsSchema>;
export type AlchemyAssetTransfer = z.infer<typeof AlchemyAssetTransferSchema>;
export type AlchemyAssetTransfersResponse = z.infer<typeof AlchemyAssetTransfersResponseSchema>;
export type AlchemyTokenMetadata = z.infer<typeof AlchemyTokenMetadataSchema>;
export type AlchemyPortfolioTokenPrice = z.infer<typeof AlchemyPortfolioTokenPriceSchema>;
export type AlchemyPortfolioTokenMetadata = z.infer<typeof AlchemyPortfolioTokenMetadataSchema>;
export type AlchemyPortfolioTokenBalance = z.infer<typeof AlchemyPortfolioTokenBalanceSchema>;
export type AlchemyPortfolioBalanceResponse = z.infer<typeof AlchemyPortfolioBalanceResponseSchema>;
export type AlchemyPortfolioAddress = z.infer<typeof AlchemyPortfolioAddressSchema>;
export type AlchemyPortfolioBalanceRequest = z.infer<typeof AlchemyPortfolioBalanceRequestSchema>;
export type AlchemyTransactionReceipt = z.infer<typeof AlchemyTransactionReceiptSchema>;
export type AlchemyTransactionReceiptResponse = z.infer<typeof AlchemyTransactionReceiptResponseSchema>;
export type AlchemyAssetTransfersJsonRpcResponse = z.infer<typeof AlchemyAssetTransfersJsonRpcResponseSchema>;
