import { DecimalStringSchema } from '@exitbook/core';
import { z } from 'zod';

import { NormalizedTransactionBaseSchema } from '../../core/schemas/normalized-transaction.js';

import { normalizeEvmAddress } from './utils.js';

/**
 * EVM address schema with automatic case normalization.
 *
 * EVM addresses are case-insensitive for comparison purposes (though checksummed
 * addresses use case for validation per EIP-55). This schema normalizes all addresses to
 * lowercase to ensure consistent comparison and deduplication across the system.
 *
 * Normalization happens at the validation boundary - when external data enters
 * the system via Zod schemas. This eliminates manual normalization throughout
 * the codebase.
 *
 * @example
 * // Input: "0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B"
 * // Output: "0xab5801a7d398351b8be11c439e05c5b3259aec9b"
 */
export const EvmAddressSchema = z.string().transform((val) => normalizeEvmAddress(val));

/**
 * Schema for unified EVM transaction
 *
 * Validates transactions from all EVM-compatible chains (Ethereum, Avalanche, etc.)
 * Supports the superset of features across all chains.
 *
 * Extends NormalizedTransactionBaseSchema to ensure consistent identity handling.
 * The eventId field is computed by providers during normalization using
 * generateUniqueTransactionEventId() with chain-specific discriminating fields.
 *
 * Note on logIndex and traceId fields:
 * - logIndex: Only provided by Moralis (not Routescan/Alchemy)
 * - traceId: Only provided by Routescan (not Alchemy/Moralis)
 *
 * These fields are preserved in the schema and included in eventId generation
 * when available to ensure unique identification of events within a transaction.
 */
export const EvmTransactionSchema = NormalizedTransactionBaseSchema.extend({
  // EVM-specific transaction data
  type: z.enum(['transfer', 'token_transfer', 'internal', 'contract_call', 'beacon_withdrawal']),
  status: z.enum(['success', 'failed', 'pending']),
  timestamp: z.number().positive('Timestamp must be positive'),
  providerName: z.string().min(1, 'Provider Name must not be empty'),

  // Transaction flow (addresses normalized via EvmAddressSchema)
  from: EvmAddressSchema,
  to: EvmAddressSchema.optional(),
  amount: DecimalStringSchema,
  currency: z.string().min(1, 'Currency must not be empty'),

  // Block context
  blockHeight: z.number().optional(),
  blockId: z.string().optional(),

  // Gas and fee information
  gasPrice: DecimalStringSchema.optional(),
  gasUsed: DecimalStringSchema.optional(),
  feeAmount: DecimalStringSchema.optional(),
  feeCurrency: z.string().optional(),

  // Contract interaction metadata
  inputData: z.string().optional(),
  methodId: z.string().optional(),
  functionName: z.string().optional(),

  // Token-specific information (tokenAddress normalized via EvmAddressSchema)
  tokenAddress: EvmAddressSchema.optional(),
  tokenSymbol: z.string().optional(),
  tokenDecimals: z.number().nonnegative().optional(),
  tokenType: z.enum(['erc20', 'erc721', 'erc1155', 'native']).optional(),
  logIndex: z.number().nonnegative().optional(),

  // Internal transaction tracking
  traceId: z.string().optional(),
});

// Type exports inferred from schemas (single source of truth)
export type EvmTransaction = z.infer<typeof EvmTransactionSchema>;
