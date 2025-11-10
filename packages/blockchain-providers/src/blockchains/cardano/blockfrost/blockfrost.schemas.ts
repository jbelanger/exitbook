import { z } from 'zod';

import { timestampToDate } from '../../../core/utils/zod-utils.js';
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
 * - consumed_by_tx: Transaction hash that consumed this output (if spent)
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
    consumed_by_tx: z.string().nullable().optional(),
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

/**
 * Schema for Blockfrost transaction details from /txs/{hash}
 * Returns complete transaction information including fees, block metadata, and status
 */
export const BlockfrostTransactionDetailsSchema = z
  .object({
    hash: z.string().min(1, 'Transaction hash must not be empty'),
    block: z.string().min(1, 'Block hash must not be empty'),
    block_height: z.number().nonnegative('Block height must be non-negative'),
    block_time: timestampToDate,
    slot: z.number().nonnegative('Slot must be non-negative'),
    index: z.number().nonnegative('Transaction index must be non-negative'),
    fees: z.string().regex(/^\d+$/, 'Fee must be a numeric string (lovelace)'),
    size: z.number().nonnegative('Transaction size must be non-negative'),
    invalid_before: z.string().nullable().optional(),
    invalid_hereafter: z.string().nullable().optional(),
    utxo_count: z.number().nonnegative('UTXO count must be non-negative'),
    withdrawal_count: z.number().nonnegative('Withdrawal count must be non-negative'),
    mir_cert_count: z.number().nonnegative('MIR cert count must be non-negative'),
    delegation_count: z.number().nonnegative('Delegation count must be non-negative'),
    stake_cert_count: z.number().nonnegative('Stake cert count must be non-negative'),
    pool_update_count: z.number().nonnegative('Pool update count must be non-negative'),
    pool_retire_count: z.number().nonnegative('Pool retire count must be non-negative'),
    asset_mint_or_burn_count: z.number().nonnegative('Asset mint/burn count must be non-negative'),
    redeemer_count: z.number().nonnegative('Redeemer count must be non-negative'),
    valid_contract: z.boolean(),
    output_amount: z
      .array(
        z.object({
          unit: z.string(),
          quantity: z.string(),
        })
      )
      .optional(),
    deposit: z.string().regex(/^\d+$/, 'Deposit must be a numeric string (lovelace)').optional(),
  })
  .strict();

/**
 * Schema combining transaction metadata with UTXO data for mapper input.
 * This provides complete transaction information including fees and block metadata.
 */
export const BlockfrostTransactionWithMetadataSchema = BlockfrostTransactionUtxosSchema.extend({
  block_height: z.number().nonnegative('Block height must be non-negative'),
  block_time: z.date(),
  block_hash: z.string().min(1, 'Block hash must not be empty'),
  fees: z.string().regex(/^\d+$/, 'Fee must be a numeric string (lovelace)'),
  tx_index: z.number().nonnegative('Transaction index must be non-negative'),
  valid_contract: z.boolean(),
});

/**
 * Schema for Blockfrost address information from /addresses/{address}
 * Returns address details including balance and staking information
 */
export const BlockfrostAddressSchema = z
  .object({
    address: CardanoAddressSchema,
    amount: z.array(BlockfrostAssetAmountSchema),
    stake_address: z.string().nullable().optional(),
    type: z.enum(['byron', 'shelley', 'stake', 'pointer']),
    script: z.boolean(),
  })
  .strict();

// Type exports inferred from schemas
export type BlockfrostTransactionHash = z.infer<typeof BlockfrostTransactionHashSchema>;
export type BlockfrostAssetAmount = z.infer<typeof BlockfrostAssetAmountSchema>;
export type BlockfrostUtxoInput = z.infer<typeof BlockfrostUtxoInputSchema>;
export type BlockfrostUtxoOutput = z.infer<typeof BlockfrostUtxoOutputSchema>;
export type BlockfrostTransactionUtxos = z.infer<typeof BlockfrostTransactionUtxosSchema>;
export type BlockfrostTransactionDetails = z.infer<typeof BlockfrostTransactionDetailsSchema>;
export type BlockfrostTransactionWithMetadata = z.infer<typeof BlockfrostTransactionWithMetadataSchema>;
export type BlockfrostAddress = z.infer<typeof BlockfrostAddressSchema>;
