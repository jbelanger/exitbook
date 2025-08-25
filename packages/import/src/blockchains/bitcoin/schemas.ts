/**
 * Zod validation schemas for Bitcoin transaction data formats
 *
 * These schemas validate the structure and content of transaction data
 * from different Bitcoin API providers (Mempool.space, Blockstream, BlockCypher)
 * before processing.
 */
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
    fetchedByAddress: z.string().optional(), // Added by our importer
    locktime: z.number().nonnegative(),
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
 * Schema for Blockstream.info transaction status
 */
export const BlockstreamTransactionStatusSchema = z.object({
  block_hash: z.string().optional(),
  block_height: z.number().optional(),
  block_time: z.number().optional(),
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
    fetchedByAddress: z.string().optional(), // Added by our importer
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
    block_hash: z.string(),
    block_height: z.number().nonnegative(),
    block_index: z.number().nonnegative(),
    confidence: z.number().min(0).max(1),
    confirmations: z.number().nonnegative(),
    confirmed: z.string().min(1, 'Confirmed timestamp must not be empty'), // ISO 8601 date
    double_spend: z.boolean(),
    fees: z.number().nonnegative('Fees must be non-negative'), // Note: 'fees' not 'fee'
    fetchedByAddress: z.string().optional(), // Added by our importer
    gas_limit: z.number().optional(),
    gas_price: z.number().optional(),
    gas_used: z.number().optional(),
    hash: z.string().min(1, 'Transaction hash must not be empty'), // Note: 'hash' not 'txid'
    inputs: z.array(BlockCypherInputSchema).min(1, 'Transaction must have at least one input'),
    lock_time: z.number().nonnegative(),
    outputs: z.array(BlockCypherOutputSchema).min(1, 'Transaction must have at least one output'),
    preference: z.string(),
    received: z.string().min(1, 'Received timestamp must not be empty'), // ISO 8601 date
    relayed_by: z.string(),
    size: z.number().positive('Size must be positive'),
    ver: z.number(),
    vsize: z.number().positive('Virtual size must be positive'),
  })
  .strict();

/**
 * Union schema for any Bitcoin transaction format
 */
export const BitcoinTransactionSchema = z.union([
  MempoolTransactionSchema,
  BlockstreamTransactionSchema,
  BlockCypherTransactionSchema,
]);

/**
 * Schema for validating arrays of Bitcoin transactions
 */
export const BitcoinTransactionArraySchema = z.array(BitcoinTransactionSchema);

/**
 * Validation result type
 */
export interface ValidationResult {
  errors: string[];
  isValid: boolean;
  warnings: string[];
}

/**
 * Validate Bitcoin transaction data using provider-specific schemas
 */
export function validateBitcoinTransactions(
  transactions: unknown[],
  providerName: 'mempool.space' | 'blockstream.info' | 'blockcypher'
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!Array.isArray(transactions)) {
    errors.push('Transaction data must be an array');
    return { errors, isValid: false, warnings };
  }

  if (transactions.length === 0) {
    warnings.push('No transactions found in data');
    return { errors, isValid: true, warnings };
  }

  // Choose the appropriate schema based on provider
  let schema: z.ZodSchema;
  switch (providerName) {
    case 'mempool.space':
      schema = z.array(MempoolTransactionSchema);
      break;
    case 'blockstream.info':
      schema = z.array(BlockstreamTransactionSchema);
      break;
    case 'blockcypher':
      schema = z.array(BlockCypherTransactionSchema);
      break;
    default:
      errors.push(`Unknown provider: ${providerName}`);
      return { errors, isValid: false, warnings };
  }

  // Validate the data
  const result = schema.safeParse(transactions);

  if (!result.success) {
    for (const issue of result.error.issues) {
      const path = issue.path.length > 0 ? ` at ${issue.path.join('.')}` : '';
      errors.push(`${issue.message}${path}`);
    }
  }

  return {
    errors,
    isValid: errors.length === 0,
    warnings,
  };
}
