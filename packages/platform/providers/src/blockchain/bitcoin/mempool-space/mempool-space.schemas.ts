import { z } from 'zod';

import { timestampToDate } from '../../../shared/blockchain/utils/zod-utils.js';
import { BitcoinAddressSchema } from '../schemas.js';

/**
 * Schema for Mempool.space transaction status
 */
export const MempoolTransactionStatusSchema = z.object({
  block_hash: z.string().optional(),
  block_height: z.number().optional(),
  block_time: timestampToDate.optional(),
  confirmed: z.boolean(),
});

/**
 * Schema for Mempool.space transaction input prevout
 */
export const MempoolPrevoutSchema = z.object({
  scriptpubkey: z.string(),
  scriptpubkey_address: BitcoinAddressSchema.optional(),
  scriptpubkey_asm: z.string(),
  scriptpubkey_type: z.string(),
  value: z.number().nonnegative('Value must be non-negative'),
});

/**
 * Schema for Mempool.space transaction input
 */
export const MempoolInputSchema = z.object({
  prevout: MempoolPrevoutSchema.optional(),
  scriptsig: z.string(),
  scriptsig_asm: z.string(),
  sequence: z.number(),
  txid: z.string().min(1, 'Input txid must not be empty'),
  vout: z.number().nonnegative(),
  witness: z.array(z.string()).optional(),
});

/**
 * Schema for Mempool.space transaction output
 */
export const MempoolOutputSchema = z.object({
  scriptpubkey: z.string(),
  scriptpubkey_address: BitcoinAddressSchema.optional(),
  scriptpubkey_asm: z.string(),
  scriptpubkey_type: z.string(),
  value: z.number().nonnegative('Output value must be non-negative'),
});

/**
 * Schema for validating Mempool.space transaction format
 */
export const MempoolTransactionSchema = z
  .object({
    fee: z.number().nonnegative('Fee must be non-negative'),
    locktime: z.number().nonnegative(),
    sigops: z.number().nonnegative('Sigops must be non-negative').optional(),
    size: z.number().positive('Size must be positive'),
    status: MempoolTransactionStatusSchema,
    txid: z.string().min(1, 'Transaction ID must not be empty'),
    version: z.number(),
    vin: z.array(MempoolInputSchema).min(1, 'Transaction must have at least one input'),
    vout: z.array(MempoolOutputSchema).min(1, 'Transaction must have at least one output'),
    weight: z.number().positive('Weight must be positive'),
  })
  .strict();

/**
 * Schema for Mempool.space address statistics (chain or mempool)
 */
export const MempoolAddressStatsSchema = z.object({
  funded_txo_count: z.number().nonnegative('Funded transaction output count must be non-negative'),
  funded_txo_sum: z.number().nonnegative('Funded transaction output sum must be non-negative'),
  spent_txo_count: z.number().nonnegative('Spent transaction output count must be non-negative'),
  spent_txo_sum: z.number().nonnegative('Spent transaction output sum must be non-negative'),
  tx_count: z.number().nonnegative('Transaction count must be non-negative'),
});

/**
 * Schema for Mempool.space address information response
 */
export const MempoolAddressInfoSchema = z.object({
  address: BitcoinAddressSchema,
  chain_stats: MempoolAddressStatsSchema,
  mempool_stats: MempoolAddressStatsSchema,
});

// Type exports inferred from schemas
export type MempoolTransactionStatus = z.infer<typeof MempoolTransactionStatusSchema>;
export type MempoolPrevout = z.infer<typeof MempoolPrevoutSchema>;
export type MempoolInput = z.infer<typeof MempoolInputSchema>;
export type MempoolOutput = z.infer<typeof MempoolOutputSchema>;
export type MempoolTransaction = z.infer<typeof MempoolTransactionSchema>;
export type MempoolAddressStats = z.infer<typeof MempoolAddressStatsSchema>;
export type MempoolAddressInfo = z.infer<typeof MempoolAddressInfoSchema>;
export type MempoolAddressTransaction = MempoolTransaction;
