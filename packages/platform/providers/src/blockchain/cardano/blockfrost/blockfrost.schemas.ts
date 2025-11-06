import { z } from 'zod';

import { timestampToDate } from '../../../shared/blockchain/utils/zod-utils.js';
import { CardanoAddressSchema } from '../schemas.js';

/**
 * Schema for Blockfrost transaction hash entry from /addresses/{address}/transactions
 * Returns a simplified list of transaction hashes for an address
 */
export const BlockfrostTransactionHashSchema = z
  .object({
    tx_hash: z.string().min(1, 'Transaction hash must not be empty'),
    tx_index: z.number().nonnegative('Transaction index must be non-negative'),
    block_height: z.number().nonnegative('Block height must be non-negative'),
    block_time: timestampToDate,
  })
  .strict();

/**
 * Schema for Blockfrost asset amount
 * Represents an asset (ADA or native token) with unit and quantity
 *
 * Unit format:
 * - ADA: "lovelace" (1 ADA = 1,000,000 lovelace)
 * - Native tokens: policyId (56 hex chars) + hex-encoded asset name
 *   Example: "b0d07d45fe9514f80213f4020e5a61241458be626841cde717cb38a76e7574636f696e"
 *   = policy "b0d07d45fe9514f80213f4020e5a61241458be626841cde717cb38a7" + asset name "6e7574636f696e" (hex for "nutcoin")
 *
 * Quantities are returned as numeric strings to maintain precision (no floating point).
 */
export const BlockfrostAssetAmountSchema = z
  .object({
    unit: z.string().min(1, 'Asset unit must not be empty'),
    quantity: z.string().regex(/^\d+$/, 'Asset quantity must be a numeric string'),
  })
  .strict();

/**
 * Schema for Blockfrost transaction input from /txs/{hash}/utxos
 * Represents a UTXO being spent in a transaction
 *
 * Plutus smart contract fields (Cardano's smart contract platform):
 * - data_hash: Hash of datum attached to output (Plutus V1+)
 * - inline_datum: Inline datum embedded in output (Plutus V2+, more efficient than data_hash)
 * - reference_script_hash: Hash of reference script attached to output (Plutus V2+, allows script reuse)
 * - collateral: True if this UTXO is used as collateral for smart contract execution
 * - reference: True if this is a reference input (read-only, Plutus V2+, not consumed by transaction)
 */
export const BlockfrostUtxoInputSchema = z
  .object({
    address: CardanoAddressSchema,
    amount: z.array(BlockfrostAssetAmountSchema).min(1, 'Input must have at least one asset'),
    tx_hash: z.string().min(1, 'Input transaction hash must not be empty'),
    output_index: z.number().nonnegative('Output index must be non-negative'),
    data_hash: z.string().nullable().optional(),
    inline_datum: z.string().nullable().optional(),
    reference_script_hash: z.string().nullable().optional(),
    collateral: z.boolean().optional(),
    reference: z.boolean().optional(),
  })
  .strict();

/**
 * Schema for Blockfrost transaction output from /txs/{hash}/utxos
 * Represents a UTXO being created in a transaction
 *
 * Plutus smart contract fields (Cardano's smart contract platform):
 * - data_hash: Hash of datum attached to output (Plutus V1+)
 * - inline_datum: Inline datum embedded in output (Plutus V2+, more efficient than data_hash)
 * - reference_script_hash: Hash of reference script attached to output (Plutus V2+, allows script reuse)
 * - collateral: True if this UTXO is used as collateral for smart contract execution
 * - reference: True if this is a reference input (read-only, Plutus V2+, not consumed by transaction)
 */
export const BlockfrostUtxoOutputSchema = z
  .object({
    address: CardanoAddressSchema,
    amount: z.array(BlockfrostAssetAmountSchema).min(1, 'Output must have at least one asset'),
    output_index: z.number().nonnegative('Output index must be non-negative'),
    data_hash: z.string().nullable().optional(),
    inline_datum: z.string().nullable().optional(),
    reference_script_hash: z.string().nullable().optional(),
    collateral: z.boolean().optional(),
    reference: z.boolean().optional(),
  })
  .strict();

/**
 * Schema for Blockfrost transaction UTXOs from /txs/{hash}/utxos
 * Returns complete input/output details for a specific transaction
 */
export const BlockfrostTransactionUtxosSchema = z
  .object({
    hash: z.string().min(1, 'Transaction hash must not be empty'),
    inputs: z.array(BlockfrostUtxoInputSchema).min(1, 'Transaction must have at least one input'),
    outputs: z.array(BlockfrostUtxoOutputSchema).min(1, 'Transaction must have at least one output'),
  })
  .strict();

// Type exports inferred from schemas
export type BlockfrostTransactionHash = z.infer<typeof BlockfrostTransactionHashSchema>;
export type BlockfrostAssetAmount = z.infer<typeof BlockfrostAssetAmountSchema>;
export type BlockfrostUtxoInput = z.infer<typeof BlockfrostUtxoInputSchema>;
export type BlockfrostUtxoOutput = z.infer<typeof BlockfrostUtxoOutputSchema>;
export type BlockfrostTransactionUtxos = z.infer<typeof BlockfrostTransactionUtxosSchema>;
