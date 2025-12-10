import { z } from 'zod';

import { timestampToDate } from '../../../../core/index.js';
import { EvmAddressSchema } from '../../schemas.js';

/**
 * Schema for Moralis transaction structure
 */
export const MoralisTransactionSchema = z
  .object({
    block_hash: z.string().min(1, 'Block hash must not be empty'),
    block_number: z.string().regex(/^\d+$/, 'Block number must be numeric string'),
    block_timestamp: timestampToDate,
    from_address: EvmAddressSchema,
    gas: z.string().regex(/^\d*$/, 'Gas must be numeric string or empty'), // Can be empty
    gas_price: z.string().regex(/^\d*$/, 'Gas price must be numeric string or empty'), // Can be empty
    hash: z.string().min(1, 'Transaction hash must not be empty'),
    input: z.string(), // Can be empty string (e.g., "0x")
    nonce: z.string(),
    receipt_contract_address: EvmAddressSchema.nullish(), // Null when no contract created
    receipt_cumulative_gas_used: z.string().regex(/^\d*$/, 'Receipt cumulative gas used must be numeric or empty'),
    receipt_gas_used: z.string().regex(/^\d*$/, 'Receipt gas used must be numeric string or empty'),
    receipt_root: z.string().nullish(), // Null for post-Byzantium transactions
    receipt_status: z.string().regex(/^[01]$/, 'Receipt status must be 0 or 1'),
    to_address: EvmAddressSchema,
    transaction_index: z.string(),
    value: z.string().regex(/^\d+$/, 'Value must be numeric string'),
  })
  .passthrough(); // Allow additional fields from API

/**
 * Schema for arrays of Moralis transactions
 */
export const MoralisTransactionArraySchema = z.array(MoralisTransactionSchema);

/**
 * Schema for Moralis transaction response
 */
export const MoralisTransactionResponseSchema = z.object({
  cursor: z.string().nullish(),
  page: z.number(),
  page_size: z.number(),
  result: z.array(MoralisTransactionSchema),
});

/**
 * Schema for Moralis token transfer structure
 */
export const MoralisTokenTransferSchema = z
  .object({
    address: EvmAddressSchema,
    block_hash: z.string().min(1, 'Block hash must not be empty'),
    block_number: z.string().regex(/^\d+$/, 'Block number must be numeric string'),
    block_timestamp: timestampToDate,
    contract_type: z.string().optional(),
    from_address: EvmAddressSchema,
    log_index: z.union([z.string(), z.number()]),
    to_address: EvmAddressSchema,
    token_decimals: z.string().regex(/^\d+$/, 'Token decimals must be numeric string'),
    token_logo: z.string().nullish(),
    token_name: z.string().nullish(),
    token_symbol: z.string().nullish(),
    transaction_hash: z.string().min(1, 'Transaction hash must not be empty'),
    value: z.string().regex(/^\d+$/, 'Value must be numeric string'),
  })
  .transform((data) => ({
    ...data,
    log_index: typeof data.log_index === 'number' ? data.log_index.toString() : data.log_index,
  }));

/**
 * Schema for Moralis token transfer response
 */
export const MoralisTokenTransferResponseSchema = z.object({
  cursor: z.string().nullish(),
  page: z.number(),
  page_size: z.number(),
  result: z.array(MoralisTokenTransferSchema),
});

/**
 * Schema for Moralis token balance
 */
export const MoralisTokenBalanceSchema = z.object({
  balance: z.string().regex(/^\d+$/, 'Balance must be numeric string'),
  decimals: z.number().min(0, 'Decimals must be non-negative'),
  logo: z.string().nullish(),
  name: z.string().min(1, 'Name must not be empty'),
  symbol: z.string().min(1, 'Symbol must not be empty'),
  token_address: EvmAddressSchema,
});

/**
 * Schema for Moralis token metadata (from /erc20/metadata endpoint)
 */
export const MoralisTokenMetadataSchema = z
  .object({
    address: EvmAddressSchema.optional(),
    decimals: z.union([z.number(), z.string()]).optional(),
    logo: z.string().optional(),
    name: z.string().min(1, 'Name must not be empty'),
    symbol: z.string().min(1, 'Symbol must not be empty'),
  })
  .transform((data) => ({
    ...data,
    decimals:
      data.decimals !== undefined
        ? typeof data.decimals === 'string'
          ? parseInt(data.decimals, 10)
          : data.decimals
        : undefined,
  }));

/**
 * Schema for Moralis native balance
 */
export const MoralisNativeBalanceSchema = z.object({
  balance: z.string().regex(/^\d+$/, 'Balance must be numeric string'),
});

// Type exports (inferred from schemas)
export type MoralisTransaction = z.infer<typeof MoralisTransactionSchema>;
export type MoralisTokenTransfer = z.infer<typeof MoralisTokenTransferSchema>;
export type MoralisTokenBalance = z.infer<typeof MoralisTokenBalanceSchema>;
export type MoralisTokenMetadata = z.infer<typeof MoralisTokenMetadataSchema>;
export type MoralisNativeBalance = z.infer<typeof MoralisNativeBalanceSchema>;
export type MoralisTransactionResponse = z.infer<typeof MoralisTransactionResponseSchema>;
export type MoralisTokenTransferResponse = z.infer<typeof MoralisTokenTransferResponseSchema>;
