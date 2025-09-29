import { z } from 'zod';

/**
 * Schema for Blockchain.com transaction input prev_out
 */
export const BlockchainComPrevOutSchema = z.object({
  addr: z.string().optional(),
  n: z.number(),
  script: z.string(),
  spent: z.boolean(),
  tx_index: z.number(),
  type: z.number(),
  value: z.number().nonnegative('Value must be non-negative'),
});

/**
 * Schema for Blockchain.com transaction input
 */
export const BlockchainComInputSchema = z.object({
  prev_out: BlockchainComPrevOutSchema.optional(),
  script: z.string(),
});

/**
 * Schema for Blockchain.com transaction output
 */
export const BlockchainComOutputSchema = z.object({
  addr: z.string().optional(),
  n: z.number(),
  script: z.string(),
  spent: z.boolean(),
  tx_index: z.number(),
  type: z.number(),
  value: z.number().nonnegative('Output value must be non-negative'),
});

/**
 * Schema for validating Blockchain.com transaction format
 */
export const BlockchainComTransactionSchema = z
  .object({
    block_height: z.number().optional(),
    block_index: z.number().optional(),
    double_spend: z.boolean(),
    fee: z.number().nonnegative('Fee must be non-negative'),
    hash: z.string().min(1, 'Transaction hash must not be empty'),
    inputs: z.array(BlockchainComInputSchema).min(1, 'Transaction must have at least one input'),
    lock_time: z.number().nonnegative(),
    out: z.array(BlockchainComOutputSchema).min(1, 'Transaction must have at least one output'),
    relayed_by: z.string(),
    result: z.number(),
    size: z.number().positive('Size must be positive'),
    time: z.number().positive('Time must be positive'),
    tx_index: z.number(),
    ver: z.number(),
    vin_sz: z.number().nonnegative(),
    vout_sz: z.number().nonnegative(),
  })
  .strict();
