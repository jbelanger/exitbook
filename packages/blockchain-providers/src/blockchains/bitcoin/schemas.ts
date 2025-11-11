import { DecimalStringSchema } from '@exitbook/core';
import { z } from 'zod';

import { BITCOIN_CHAINS } from './chain-registry.js';

/**
 * Dynamically derived list of supported Bitcoin-like currencies
 * Extracted from the chain registry to ensure schemas stay in sync
 */
const SUPPORTED_CURRENCIES = Object.values(BITCOIN_CHAINS).map((c) => c.nativeCurrency) as [string, ...string[]];

/**
 * Schema for Bitcoin-like currency symbols (BTC, DOGE, LTC, BCH, etc.)
 * Validates against currencies registered in the Bitcoin chain registry
 */
const BitcoinCurrencySchema = z.enum(SUPPORTED_CURRENCIES);

/**
 * Bitcoin address schema with normalization
 * Bitcoin addresses use Base58Check or Bech32 encoding, which are case-insensitive
 * Normalizes to lowercase for consistent storage and comparison
 */
export const BitcoinAddressSchema = z
  .string()
  .min(1, 'Address must not be empty')
  .transform((val) => val.toLowerCase());

/**
 * Schema for Bitcoin transaction input
 */
export const BitcoinTransactionInputSchema = z.object({
  address: BitcoinAddressSchema.optional(),
  txid: z.string().optional(),
  value: DecimalStringSchema,
  vout: z.number().optional(),
});

/**
 * Schema for Bitcoin transaction output
 */
export const BitcoinTransactionOutputSchema = z.object({
  address: BitcoinAddressSchema.optional(),
  index: z.number(),
  value: DecimalStringSchema,
});

/**
 * Schema for normalized Bitcoin transaction
 */
export const BitcoinTransactionSchema = z.object({
  blockHeight: z.number().optional(),
  blockId: z.string().optional(),
  currency: BitcoinCurrencySchema,
  feeAmount: DecimalStringSchema.optional(),
  feeCurrency: BitcoinCurrencySchema.optional(),
  id: z.string().min(1, 'Transaction ID must not be empty'),
  inputs: z.array(BitcoinTransactionInputSchema).min(1, 'Transaction must have at least one input'),
  outputs: z.array(BitcoinTransactionOutputSchema).min(1, 'Transaction must have at least one output'),
  providerName: z.string().min(1, 'Provider Name must not be empty'),
  status: z.enum(['success', 'failed', 'pending']),
  timestamp: z.number().positive('Timestamp must be positive'),
});

// Type exports inferred from schemas
export type BitcoinTransactionInput = z.infer<typeof BitcoinTransactionInputSchema>;
export type BitcoinTransactionOutput = z.infer<typeof BitcoinTransactionOutputSchema>;
export type BitcoinTransaction = z.infer<typeof BitcoinTransactionSchema>;
