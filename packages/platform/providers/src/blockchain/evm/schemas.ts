import { tryParseDecimal } from '@exitbook/core';
import { z } from 'zod';

/**
 * Numeric string validator for amounts/values
 * Uses Decimal.js for precision-safe validation
 */
const numericString = z.string().refine(
  (val) => {
    if (val === '') return false;
    return tryParseDecimal(val);
  },
  {
    message: 'Must be a valid numeric string',
  }
);

/**
 * EVM address schema with automatic case normalization.
 *
 * EVM addresses are case-insensitive for comparison purposes (though checksummed
 * addresses use case for validation). This schema normalizes all addresses to
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
export const EvmAddressSchema = z.string().transform((val) => val.toLowerCase());

/**
 * Schema for unified EVM transaction
 *
 * Validates transactions from all EVM-compatible chains (Ethereum, Avalanche, etc.)
 * Supports the superset of features across all chains.
 */
export const EvmTransactionSchema = z.object({
  // Core transaction data
  id: z.string().min(1, 'Transaction ID must not be empty'),
  type: z.enum(['transfer', 'token_transfer', 'internal', 'contract_call']),
  status: z.enum(['success', 'failed', 'pending']),
  timestamp: z.number().positive('Timestamp must be positive'),
  providerId: z.string().min(1, 'Provider ID must not be empty'),

  // Transaction flow (addresses normalized via EvmAddressSchema)
  from: EvmAddressSchema,
  to: EvmAddressSchema.optional(),
  amount: numericString,
  currency: z.string().min(1, 'Currency must not be empty'),

  // Block context
  blockHeight: z.number().optional(),
  blockId: z.string().optional(),

  // Gas and fee information
  gasPrice: numericString.optional(),
  gasUsed: numericString.optional(),
  feeAmount: numericString.optional(),
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

  // Internal transaction tracking
  traceId: z.string().optional(),
});

// Type exports inferred from schemas (single source of truth)
export type EvmTransaction = z.infer<typeof EvmTransactionSchema>;
