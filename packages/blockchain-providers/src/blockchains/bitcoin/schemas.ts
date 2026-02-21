import { DecimalStringSchema } from '@exitbook/core';
import { z } from 'zod';

import { NormalizedTransactionBaseSchema } from '../../core/schemas/normalized-transaction.js';

import { BITCOIN_CHAINS } from './chain-registry.js';
import { normalizeBitcoinAddress } from './utils.js';

/**
 * Dynamically derived list of supported Bitcoin-like currencies
 * Extracted from the chain registry to ensure schemas stay in sync
 */
const SUPPORTED_CURRENCIES = Object.values(BITCOIN_CHAINS).map((c) => c.nativeCurrency) as unknown as [
  string,
  ...string[],
];

/**
 * Schema for Bitcoin-like currency symbols (BTC, DOGE, LTC, BCH, etc.)
 * Validates against currencies registered in the Bitcoin chain registry
 */
const BitcoinCurrencySchema = z.enum(SUPPORTED_CURRENCIES);

/**
 * Bitcoin address schema with normalization
 * Uses blockchain-specific normalization logic:
 * - Bech32 (bc1/ltc1): Lowercase
 * - CashAddr: Lowercase
 * - Legacy Base58: Case-sensitive (preserved)
 * - xpub/ypub/zpub: Case-sensitive (preserved)
 */
export const BitcoinAddressSchema = z
  .string()
  .min(1, 'Address must not be empty')
  .transform((val) => normalizeBitcoinAddress(val));

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
 *
 * Extends NormalizedTransactionBaseSchema to ensure consistent identity handling.
 * The eventId field is computed by providers during normalization using
 * generateUniqueTransactionEventId() with a Bitcoin-specific scheme that is:
 * - stable across providers and re-imports
 * - independent of confirmation/pending timestamps
 *
 * Note: We currently treat one on-chain txid as the event granularity for Bitcoin-like chains.
 * If/when we emit multiple events per tx (e.g., per-output), eventId must incorporate an
 * additional discriminator such as the output index.
 */
export const BitcoinTransactionSchema = NormalizedTransactionBaseSchema.extend({
  // Bitcoin-specific transaction data
  blockHeight: z.number().optional(),
  blockId: z.string().optional(),
  currency: BitcoinCurrencySchema,
  feeAmount: DecimalStringSchema.optional(),
  feeCurrency: BitcoinCurrencySchema.optional(),
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
