import { z } from 'zod';

/**
 * Numeric string validator for amounts/values
 * Ensures string can be parsed as a valid number
 */
const numericString = z
  .string()
  .refine((val) => !isNaN(parseFloat(val)) && isFinite(parseFloat(val)), { message: 'Must be a valid numeric string' });

/**
 * Schema for Bitcoin transaction input
 */
export const BitcoinTransactionInputSchema = z.object({
  address: z.string().optional(),
  txid: z.string().optional(),
  value: numericString,
  vout: z.number().optional(),
});

/**
 * Schema for Bitcoin transaction output
 */
export const BitcoinTransactionOutputSchema = z.object({
  address: z.string().optional(),
  index: z.number(),
  value: numericString,
});

/**
 * Schema for normalized Bitcoin transaction
 */
export const BitcoinTransactionSchema = z.object({
  blockHeight: z.number().optional(),
  blockId: z.string().optional(),
  currency: z.literal('BTC'),
  feeAmount: numericString.optional(),
  feeCurrency: z.string().optional(),
  id: z.string().min(1, 'Transaction ID must not be empty'),
  inputs: z.array(BitcoinTransactionInputSchema).min(1, 'Transaction must have at least one input'),
  outputs: z.array(BitcoinTransactionOutputSchema).min(1, 'Transaction must have at least one output'),
  providerId: z.string().min(1, 'Provider ID must not be empty'),
  status: z.enum(['success', 'failed', 'pending']),
  timestamp: z.number().positive('Timestamp must be positive'),
});
