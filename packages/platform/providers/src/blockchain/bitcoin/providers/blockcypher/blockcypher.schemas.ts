import { z } from 'zod';

import { BitcoinAddressSchema } from '../../schemas.ts';

/**
 * Schema for BlockCypher transaction input
 */
export const BlockCypherInputSchema = z.object({
  addresses: z.array(BitcoinAddressSchema),
  age: z.number().nonnegative(),
  output_index: z.number().nonnegative(),
  output_value: z.number().nonnegative('Output value must be non-negative'),
  prev_hash: z.string().min(1, 'Previous hash must not be empty'),
  script_type: z.string(),
  sequence: z.number(),
});

/**
 * Schema for BlockCypher transaction output
 */
export const BlockCypherOutputSchema = z.object({
  addresses: z.array(BitcoinAddressSchema),
  script: z.string(),
  script_type: z.string(),
  value: z.number().nonnegative('Output value must be non-negative'),
});

/**
 * Schema for validating BlockCypher transaction format
 */
export const BlockCypherTransactionSchema = z
  .object({
    addresses: z.array(BitcoinAddressSchema).optional(), // Root-level addresses involved in transaction
    block_hash: z.string().optional(), // Optional for unconfirmed transactions
    block_height: z.number().nonnegative().optional(), // Optional for unconfirmed transactions
    block_index: z.number().nonnegative().optional(), // Optional for unconfirmed transactions
    confidence: z.number().min(0).max(1),
    confirmations: z.number().nonnegative(),
    confirmed: z.string().optional(), // ISO 8601 date, optional for unconfirmed transactions
    double_spend: z.boolean(),
    fees: z.number().nonnegative('Fees must be non-negative'), // Note: 'fees' not 'fee'
    gas_limit: z.number().optional(),
    gas_price: z.number().optional(),
    gas_used: z.number().optional(),
    hash: z.string().min(1, 'Transaction hash must not be empty'), // Note: 'hash' not 'txid'
    inputs: z.array(BlockCypherInputSchema).min(1, 'Transaction must have at least one input'),
    next_inputs: z.string().optional(), // URL for next page of inputs
    next_outputs: z.string().optional(), // URL for next page of outputs
    opt_in_rbf: z.boolean().optional(), // Replace-by-fee flag
    outputs: z.array(BlockCypherOutputSchema).min(1, 'Transaction must have at least one output'),
    preference: z.string(),
    received: z.string().min(1, 'Received timestamp must not be empty'), // ISO 8601 date
    relayed_by: z.string().optional(), // IP address that relayed the transaction
    size: z.number().positive('Size must be positive'),
    lock_time: z.number().nonnegative(),
    total: z.number().nonnegative().optional(), // Total amount transacted in satoshis
    ver: z.number(),
    vin_sz: z.number().nonnegative().optional(), // Number of inputs
    vout_sz: z.number().nonnegative().optional(), // Number of outputs
    vsize: z.number().positive('Virtual size must be positive'),
  })
  .strict();

/**
 * Schema for BlockCypher address transaction reference
 */
export const BlockCypherTxRefSchema = z.object({
  block_height: z.number().nonnegative('Block height must be non-negative'),
  confirmations: z.number().nonnegative('Confirmations must be non-negative'),
  confirmed: z.string().min(1, 'Confirmed timestamp must not be empty'),
  double_spend: z.boolean(),
  ref_balance: z.number(),
  spent: z.boolean(),
  tx_hash: z.string().min(1, 'Transaction hash must not be empty'),
  tx_input_n: z.number(),
  tx_output_n: z.number(),
  value: z.number(),
});

/**
 * Schema for BlockCypher address response
 */
export const BlockCypherAddressSchema = z.object({
  address: BitcoinAddressSchema,
  balance: z.number(),
  error: z.string().optional(),
  final_balance: z.number(),
  final_n_tx: z.number(),
  hasMore: z.boolean().optional(),
  n_tx: z.number(),
  total_received: z.number(),
  total_sent: z.number(),
  txrefs: z.array(BlockCypherTxRefSchema).optional(),
  unconfirmed_balance: z.number(),
  unconfirmed_n_tx: z.number(),
});

// Type exports inferred from schemas
export type BlockCypherInput = z.infer<typeof BlockCypherInputSchema>;
export type BlockCypherOutput = z.infer<typeof BlockCypherOutputSchema>;
export type BlockCypherTransaction = z.infer<typeof BlockCypherTransactionSchema>;
export type BlockCypherTxRef = z.infer<typeof BlockCypherTxRefSchema>;
export type BlockCypherAddress = z.infer<typeof BlockCypherAddressSchema>;
