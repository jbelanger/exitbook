import { z } from 'zod';

/**
 * Schema for BlockCypher transaction input
 */
export const BlockCypherInputSchema = z.object({
  addresses: z.array(z.string()),
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
  addresses: z.array(z.string()),
  script: z.string(),
  script_type: z.string(),
  value: z.number().nonnegative('Output value must be non-negative'),
});

/**
 * Schema for validating BlockCypher transaction format
 */
export const BlockCypherTransactionSchema = z
  .object({
    addresses: z.array(z.string()).optional(), // Root-level addresses involved in transaction
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
    total: z.number().nonnegative().optional(), // Total amount transacted in satoshis
    ver: z.number(),
    vin_sz: z.number().nonnegative().optional(), // Number of inputs
    vout_sz: z.number().nonnegative().optional(), // Number of outputs
    vsize: z.number().positive('Virtual size must be positive'),
  })
  .strict();
