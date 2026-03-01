import { DecimalStringSchema } from '@exitbook/core';
import { z } from 'zod';

import { parseApiBoolean, timestampToDate } from '../../../../core/index.js';
import { EvmAddressSchema } from '../../schemas.js';

/**
 * Schema for Moralis token balance
 */
export const MoralisTokenBalanceSchema = z.object({
  balance: DecimalStringSchema,
  decimals: z.number().min(0, 'Decimals must be non-negative').nullish(),
  logo: z.string().nullish(),
  name: z.string().nullish(),
  symbol: z.string().nullish(),
  token_address: EvmAddressSchema,
});

/**
 * Schema for Moralis token metadata (from /erc20/metadata endpoint)
 */
export const MoralisTokenMetadataSchema = z
  .object({
    address: EvmAddressSchema.nullish(),
    decimals: z.union([z.number(), z.string()]).nullish(),
    logo: z.string().nullish(),
    name: z.string().nullish(),
    symbol: z.string().nullish(),

    // Professional spam detection from Moralis (primary signal for scam identification)
    possible_spam: z.union([z.boolean(), z.string()]).nullish(),
    verified_contract: z.union([z.boolean(), z.string()]).nullish(),

    // Additional useful fields from Moralis
    total_supply: DecimalStringSchema.nullish(),
    total_supply_formatted: DecimalStringSchema.nullish(),
    fully_diluted_valuation: DecimalStringSchema.nullish(),
    block_number: z.union([z.number(), z.string()]).nullish(),
    validated: z.union([z.number(), z.string()]).nullish(),
    created_at: z.string().nullish(),
    thumbnail: z.string().nullish(),
    logo_hash: z.string().nullish(),
  })
  .transform((data) => ({
    ...data,
    decimals:
      data.decimals !== undefined
        ? typeof data.decimals === 'string'
          ? parseInt(data.decimals, 10)
          : data.decimals
        : undefined,
    // Transform string booleans to actual booleans
    possible_spam: parseApiBoolean(data.possible_spam),
    verified_contract: parseApiBoolean(data.verified_contract),
    // Transform block_number from string to number if needed
    block_number:
      data.block_number !== undefined && data.block_number !== null
        ? typeof data.block_number === 'string' && data.block_number !== ''
          ? (() => {
              const parsed = parseInt(data.block_number, 10);
              return Number.isNaN(parsed) ? undefined : parsed;
            })()
          : typeof data.block_number === 'number'
            ? data.block_number
            : undefined
        : undefined,
  }));

/**
 * Schema for Moralis native balance
 */
export const MoralisNativeBalanceSchema = z.object({
  balance: DecimalStringSchema,
});

// ────────────────────────────────────────────────────────────────────────────
// Wallet History endpoint: GET /wallets/{address}/history
// Returns a unified view of all transaction types (native, token, internal, NFT)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Schema for native_transfers[] in the wallet history response.
 * Covers both regular transfers and internal (contract-initiated) transfers.
 */
export const MoralisWalletHistoryNativeTransferSchema = z.object({
  direction: z.enum(['send', 'receive']),
  from_address: EvmAddressSchema,
  from_address_label: z.string().nullish(),
  internal_transaction: z.boolean(),
  to_address: EvmAddressSchema,
  to_address_label: z.string().nullish(),
  token_symbol: z.string(),
  value: DecimalStringSchema,
  value_formatted: z.string(),
});

/**
 * Schema for erc20_transfers[] in the wallet history response.
 */
export const MoralisWalletHistoryErc20TransferSchema = z.object({
  address: EvmAddressSchema, // contract address
  direction: z.enum(['send', 'receive']),
  from_address: EvmAddressSchema,
  from_address_label: z.string().nullish(),
  log_index: z.number(),
  possible_spam: z.boolean(),
  security_score: z.number().nullish(),
  to_address: EvmAddressSchema,
  to_address_label: z.string().nullish(),
  token_decimals: z.string().regex(/^\d+$/, 'Token decimals must be numeric string'),
  token_logo: z.string().nullish(),
  token_name: z.string().nullish(),
  token_symbol: z.string().nullish(),
  value: DecimalStringSchema,
  value_formatted: z.string(),
  verified_contract: z.boolean().nullish(),
});

/**
 * Schema for internal_transactions[] in the wallet history response.
 */
export const MoralisWalletHistoryInternalTransactionSchema = z.object({
  block_hash: z.string().min(1),
  block_number: z.number().int().nonnegative(),
  error: z.string().nullish(),
  from: EvmAddressSchema,
  gas: z.string().regex(/^\d+$/, 'Gas must be numeric string'),
  gas_used: z.string().regex(/^\d+$/, 'Gas used must be numeric string'),
  input: z.string(),
  output: z.string(),
  to: EvmAddressSchema,
  transaction_hash: z.string().min(1),
  type: z.string(),
  value: DecimalStringSchema,
});

/**
 * Schema for a single transaction in the wallet history response.
 * Each item is a top-level transaction enriched with sub-arrays for
 * native_transfers, erc20_transfers, nft_transfers, and internal_transactions.
 */
export const MoralisWalletHistoryTransactionSchema = z
  .object({
    block_hash: z.string().min(1),
    block_number: z.string().regex(/^\d+$/, 'Block number must be numeric string'),
    block_timestamp: timestampToDate,
    category: z.string(), // "send", "receive", "token send", "token receive", "approve", "airdrop", etc.
    erc20_transfers: z.array(MoralisWalletHistoryErc20TransferSchema),
    from_address: EvmAddressSchema,
    gas_price: z.string().regex(/^\d*$/, 'Gas price must be numeric string or empty'),
    hash: z.string().min(1),
    internal_transactions: z.array(MoralisWalletHistoryInternalTransactionSchema),
    method_label: z.string().nullish(),
    native_transfers: z.array(MoralisWalletHistoryNativeTransferSchema),
    nonce: z.string(),
    possible_spam: z.boolean(),
    receipt_gas_used: z.string().regex(/^\d*$/, 'Receipt gas used must be numeric string or empty'),
    receipt_status: z.string().regex(/^[01]$/, 'Receipt status must be 0 or 1'),
    summary: z.string().nullish(),
    to_address: EvmAddressSchema.nullish(), // null for contract creation
    transaction_fee: z.string(), // Already in decimal ETH (e.g. "0.000121971142461")
    value: DecimalStringSchema, // Main tx value in wei
  })
  .passthrough(); // Allow nft_transfers, contract_interactions, entity fields, etc.

/**
 * Schema for the paginated wallet history response.
 */
export const MoralisWalletHistoryResponseSchema = z.object({
  cursor: z.string().nullish(),
  page: z.number(),
  page_size: z.number(),
  result: z.array(MoralisWalletHistoryTransactionSchema),
});

// Type exports (inferred from schemas)
export type MoralisTokenBalance = z.infer<typeof MoralisTokenBalanceSchema>;
export type MoralisTokenMetadata = z.infer<typeof MoralisTokenMetadataSchema>;
export type MoralisNativeBalance = z.infer<typeof MoralisNativeBalanceSchema>;
export type MoralisWalletHistoryNativeTransfer = z.infer<typeof MoralisWalletHistoryNativeTransferSchema>;
export type MoralisWalletHistoryErc20Transfer = z.infer<typeof MoralisWalletHistoryErc20TransferSchema>;
export type MoralisWalletHistoryInternalTransaction = z.infer<typeof MoralisWalletHistoryInternalTransactionSchema>;
export type MoralisWalletHistoryTransaction = z.infer<typeof MoralisWalletHistoryTransactionSchema>;
export type MoralisWalletHistoryResponse = z.infer<typeof MoralisWalletHistoryResponseSchema>;
