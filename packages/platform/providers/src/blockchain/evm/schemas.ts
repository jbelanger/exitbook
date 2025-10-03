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

  // Transaction flow
  from: z.string().min(1, 'From address must not be empty'),
  to: z.string().min(1, 'To address must not be empty'),
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

  // Token-specific information
  tokenAddress: z.string().optional(),
  tokenSymbol: z.string().optional(),
  tokenDecimals: z.number().nonnegative().optional(),
  tokenType: z.enum(['erc20', 'erc721', 'erc1155', 'native']).optional(),

  // Internal transaction tracking
  traceId: z.string().optional(),
});
