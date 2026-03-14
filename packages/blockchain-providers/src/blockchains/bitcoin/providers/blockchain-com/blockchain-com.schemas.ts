import { z } from 'zod';

import { BitcoinAddressSchema } from '../../schemas.js';

/**
 * Schema for Blockchain.com transaction input prev_out
 */
const BlockchainComPrevOutSchema = z
  .object({
    addr: BitcoinAddressSchema.nullish(),
    n: z.number(),
    script: z.string(),
    spending_outpoints: z.array(z.object({ n: z.number(), tx_index: z.number() })).nullish(),
    spent: z.boolean(),
    tx_index: z.number(),
    type: z.number(),
    value: z.number().nonnegative('Value must be non-negative'),
  })
  .strict();

/**
 * Schema for Blockchain.com transaction input
 */
const BlockchainComInputSchema = z
  .object({
    index: z.number().nullish(),
    prev_out: BlockchainComPrevOutSchema.nullish(),
    script: z.string(),
    sequence: z.number().nullish(),
    witness: z.string().nullish(),
  })
  .strict();

/**
 * Schema for Blockchain.com transaction output
 */
const BlockchainComOutputSchema = z
  .object({
    addr: BitcoinAddressSchema.nullish(),
    n: z.number(),
    script: z.string(),
    spending_outpoints: z.array(z.object({ n: z.number(), tx_index: z.number() })).nullish(),
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
    balance: z.number().nullish(),
    block_height: z.number().nullish(),
    block_index: z.number().nullish(),
    double_spend: z.boolean(),
    fee: z.number().nonnegative('Fee must be non-negative'),
    hash: z.string().min(1, 'Transaction hash must not be empty'),
    inputs: z.array(BlockchainComInputSchema).min(1, 'Transaction must have at least one input'),
    lock_time: z.number().nonnegative(),
    out: z.array(BlockchainComOutputSchema).min(1, 'Transaction must have at least one output'),
    rbf: z.boolean().nullish(),
    relayed_by: z.string(),
    result: z.number(),
    size: z.number().positive('Size must be positive'),
    time: z.number().positive('Time must be positive'),
    tx_index: z.number(),
    ver: z.number(),
    vin_sz: z.number().nonnegative(),
    vout_sz: z.number().nonnegative(),
    weight: z.number().nullish(),
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

// Type exports inferred from schemas
export type BlockchainComTransaction = z.infer<typeof BlockchainComTransactionSchema>;
export type BlockchainComAddressResponse = z.infer<typeof BlockchainComAddressResponseSchema>;
