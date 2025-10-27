import { z } from 'zod';

import { BitcoinAddressSchema } from '../schemas.js';

/**
 * Schema for Blockchain.com transaction input prev_out
 */
export const BlockchainComPrevOutSchema = z
  .object({
    addr: BitcoinAddressSchema.optional(),
    n: z.number(),
    script: z.string(),
    spending_outpoints: z.array(z.object({ n: z.number(), tx_index: z.number() })).optional(),
    spent: z.boolean(),
    tx_index: z.number(),
    type: z.number(),
    value: z.number().nonnegative('Value must be non-negative'),
  })
  .strict();

/**
 * Schema for Blockchain.com transaction input
 */
export const BlockchainComInputSchema = z
  .object({
    index: z.number().optional(),
    prev_out: BlockchainComPrevOutSchema.optional(),
    script: z.string(),
    sequence: z.number().optional(),
    witness: z.string().optional(),
  })
  .strict();

/**
 * Schema for Blockchain.com transaction output
 */
export const BlockchainComOutputSchema = z
  .object({
    addr: BitcoinAddressSchema.optional(),
    n: z.number(),
    script: z.string(),
    spending_outpoints: z.array(z.object({ n: z.number(), tx_index: z.number() })).optional(),
    spent: z.boolean(),
    tx_index: z.number(),
    type: z.number(),
    value: z.number().nonnegative('Output value must be non-negative'),
  })
  .strict();

/**
 * Schema for validating Blockchain.com transaction format
 */
export const BlockchainComTransactionSchema = z
  .object({
    balance: z.number().optional(),
    block_height: z
      .number()
      .nullable()
      .optional()
      .transform((val) => val ?? undefined),
    block_index: z
      .number()
      .nullable()
      .optional()
      .transform((val) => val ?? undefined),
    double_spend: z.boolean(),
    fee: z.number().nonnegative('Fee must be non-negative'),
    hash: z.string().min(1, 'Transaction hash must not be empty'),
    inputs: z.array(BlockchainComInputSchema).min(1, 'Transaction must have at least one input'),
    lock_time: z.number().nonnegative(),
    out: z.array(BlockchainComOutputSchema).min(1, 'Transaction must have at least one output'),
    rbf: z.boolean().optional(),
    relayed_by: z.string(),
    result: z.number(),
    size: z.number().positive('Size must be positive'),
    time: z.number().positive('Time must be positive'),
    tx_index: z.number(),
    ver: z.number(),
    vin_sz: z.number().nonnegative(),
    vout_sz: z.number().nonnegative(),
    weight: z.number().optional(),
  })
  .strict();

/**
 * Schema for Blockchain.com address response
 */
export const BlockchainComAddressResponseSchema = z
  .object({
    address: BitcoinAddressSchema,
    final_balance: z.number().nonnegative('Final balance must be non-negative'),
    hash160: z.string().min(1, 'Hash160 must not be empty'),
    n_tx: z.number().nonnegative('Transaction count must be non-negative'),
    total_received: z.number().nonnegative('Total received must be non-negative'),
    total_sent: z.number().nonnegative('Total sent must be non-negative'),
    txs: z.array(BlockchainComTransactionSchema),
  })
  .strict();

/**
 * Schema for Blockchain.com balance response entry
 */
export const BlockchainComBalanceEntrySchema = z
  .object({
    final_balance: z.number().nonnegative('Final balance must be non-negative'),
    n_tx: z.number().nonnegative('Transaction count must be non-negative'),
    total_received: z.number().nonnegative('Total received must be non-negative'),
  })
  .strict();

/**
 * Schema for Blockchain.com balance response map
 */
export const BlockchainComBalanceResponseSchema = z.record(z.string(), BlockchainComBalanceEntrySchema);

// Type exports inferred from schemas
export type BlockchainComPrevOut = z.infer<typeof BlockchainComPrevOutSchema>;
export type BlockchainComInput = z.infer<typeof BlockchainComInputSchema>;
export type BlockchainComOutput = z.infer<typeof BlockchainComOutputSchema>;
export type BlockchainComTransaction = z.infer<typeof BlockchainComTransactionSchema>;
export type BlockchainComAddressResponse = z.infer<typeof BlockchainComAddressResponseSchema>;
export type BlockchainComBalanceEntry = z.infer<typeof BlockchainComBalanceEntrySchema>;
export type BlockchainComBalanceResponse = z.infer<typeof BlockchainComBalanceResponseSchema>;
