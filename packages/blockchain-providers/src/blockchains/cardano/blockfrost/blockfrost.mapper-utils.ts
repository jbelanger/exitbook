import type { SourceMetadata } from '@exitbook/core';
import { Decimal } from 'decimal.js';
import { ok, type Result } from 'neverthrow';

import type { NormalizationError } from '../../../core/index.js';
import { withValidation } from '../../../core/index.js';
import {
  CardanoTransactionSchema,
  type CardanoAssetAmount,
  type CardanoTransaction,
  type CardanoTransactionInput,
  type CardanoTransactionOutput,
} from '../schemas.js';

import {
  BlockfrostTransactionWithMetadataSchema,
  type BlockfrostAssetAmount,
  type BlockfrostTransactionWithMetadata,
  type BlockfrostUtxoInput,
  type BlockfrostUtxoOutput,
} from './blockfrost.schemas.js';

/**
 * Pure functions for Blockfrost transaction mapping
 * Following the Functional Core / Imperative Shell pattern
 */

/**
 * Utility function to convert lovelace (smallest unit) to ADA.
 * 1 ADA = 1,000,000 lovelace
 *
 * @param lovelace - Amount in lovelace as a string
 * @returns Amount in ADA as a string with full precision
 */
export function lovelaceToAda(lovelace: string): string {
  return new Decimal(lovelace).dividedBy(1_000_000).toFixed();
}

/**
 * Transform Blockfrost asset amounts to normalized CardanoAssetAmount format.
 *
 * Handles special case for ADA (unit "lovelace"):
 * - Sets symbol to "ADA"
 * - Sets decimals to 6 (1 ADA = 1,000,000 lovelace)
 *
 * For native tokens:
 * - Preserves unit (policyId + hex asset name)
 * - Leaves symbol and decimals undefined (to be enriched later)
 *
 * @param amounts - Array of Blockfrost asset amounts
 * @returns Array of normalized CardanoAssetAmount objects
 */
export function mapAssetAmounts(amounts: BlockfrostAssetAmount[]): CardanoAssetAmount[] {
  return amounts.map((amount: BlockfrostAssetAmount) => {
    const normalized: CardanoAssetAmount = {
      quantity: amount.quantity,
      unit: amount.unit,
    };

    // Special handling for ADA (lovelace)
    if (amount.unit === 'lovelace') {
      normalized.symbol = 'ADA';
      normalized.decimals = 6;
    }
    // For native tokens, leave symbol and decimals undefined
    // These will be enriched later from token registry or metadata

    return normalized;
  });
}

/**
 * Internal pure function to map Blockfrost transaction to normalized CardanoTransaction.
 *
 * Accepts combined transaction data from:
 * - /txs/{hash}/utxos: Detailed input/output UTXO information
 * - /txs/{hash}: Transaction details including fees, block metadata, and status
 *
 * The mapper properly handles:
 * - Real timestamps from block_time (converted to milliseconds)
 * - Transaction fees converted from lovelace to ADA
 * - Block height and block hash for transaction tracking
 * - Multi-asset support where each input/output can contain ADA and/or native tokens
 * - Failed smart contract transactions (valid_contract = false)
 *
 * @param rawData - Validated Blockfrost transaction data with metadata
 * @param _sourceContext - Source metadata (not used in current implementation)
 * @returns Result containing normalized CardanoTransaction or NormalizationError
 */
function mapBlockfrostTransactionInternal(
  rawData: BlockfrostTransactionWithMetadata,
  _sourceContext: SourceMetadata
): Result<CardanoTransaction, NormalizationError> {
  // Map inputs from Blockfrost format to normalized format
  const inputs: CardanoTransactionInput[] = rawData.inputs.map((input: BlockfrostUtxoInput) => ({
    address: input.address,
    amounts: mapAssetAmounts(input.amount),
    outputIndex: input.output_index,
    txHash: input.tx_hash,
  }));

  // Map outputs from Blockfrost format to normalized format
  const outputs: CardanoTransactionOutput[] = rawData.outputs.map((output: BlockfrostUtxoOutput) => ({
    address: output.address,
    amounts: mapAssetAmounts(output.amount),
    outputIndex: output.output_index,
  }));

  // Determine transaction status based on smart contract validation
  // valid_contract = false means the smart contract failed
  const status = rawData.valid_contract ? 'success' : 'failed';

  // Build normalized transaction with real metadata
  const normalized: CardanoTransaction = {
    blockHeight: rawData.block_height,
    blockId: rawData.block_hash,
    currency: 'ADA',
    feeAmount: lovelaceToAda(rawData.fees),
    feeCurrency: 'ADA',
    id: rawData.hash,
    inputs,
    outputs,
    providerName: 'blockfrost',
    status,
    timestamp: rawData.block_time.getTime(), // Convert Date to milliseconds
  };

  return ok(normalized);
}

/**
 * Validated Blockfrost transaction mapper
 * Wraps the internal mapper with input/output validation
 */
export const mapBlockfrostTransaction = withValidation(
  BlockfrostTransactionWithMetadataSchema,
  CardanoTransactionSchema,
  'BlockfrostTransaction'
)(mapBlockfrostTransactionInternal);
