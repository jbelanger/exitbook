import { z } from 'zod';

/**
 * Schema for Mempool.space transaction status
 */
export const MempoolTransactionStatusSchema = z.object({
  block_hash: z.string().optional(),
  block_height: z.number().optional(),
  block_time: z.number().optional(),
  confirmed: z.boolean(),
});

/**
 * Schema for Mempool.space transaction input prevout
 */
export const MempoolPrevoutSchema = z.object({
  scriptpubkey: z.string(),
  scriptpubkey_address: z.string().optional(),
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
  scriptpubkey_address: z.string().optional(),
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
