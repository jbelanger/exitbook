import { z } from 'zod';

import { timestampToDate } from '../../../core/blockchain/utils/zod-utils.js';

/**
 * Schema for Blockstream.info transaction status
 */
export const BlockstreamTransactionStatusSchema = z.object({
  block_hash: z.string().optional(),
  block_height: z.number().optional(),
  block_time: timestampToDate.optional(),
  confirmed: z.boolean(),
});

/**
 * Schema for Blockstream.info transaction input
 */
export const BlockstreamInputSchema = z.object({
  is_coinbase: z.boolean(),
  prevout: z.object({
    scriptpubkey: z.string(),
    scriptpubkey_address: z.string().optional(),
    scriptpubkey_asm: z.string(),
    scriptpubkey_type: z.string(),
    value: z.number().nonnegative('Prevout value must be non-negative'),
  }),
  scriptsig: z.string(),
  scriptsig_asm: z.string(),
  sequence: z.number(),
  txid: z.string().min(1, 'Input txid must not be empty'),
  vout: z.number().nonnegative(),
  witness: z.array(z.string()),
});

/**
 * Schema for Blockstream.info transaction output
 */
export const BlockstreamOutputSchema = z.object({
  scriptpubkey: z.string(),
  scriptpubkey_address: z.string().optional(),
  scriptpubkey_asm: z.string(),
  scriptpubkey_type: z.string(),
  value: z.number().nonnegative('Output value must be non-negative'),
});

/**
 * Schema for validating Blockstream.info transaction format
 */
export const BlockstreamTransactionSchema = z
  .object({
    fee: z.number().nonnegative('Fee must be non-negative'),
    locktime: z.number().nonnegative(),
    size: z.number().positive('Size must be positive'),
    status: BlockstreamTransactionStatusSchema,
    txid: z.string().min(1, 'Transaction ID must not be empty'),
    version: z.number(),
    vin: z.array(BlockstreamInputSchema).min(1, 'Transaction must have at least one input'),
    vout: z.array(BlockstreamOutputSchema).min(1, 'Transaction must have at least one output'),
    weight: z.number().positive('Weight must be positive'),
  })
  .strict();
