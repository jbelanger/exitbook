import type { SourceMetadata } from '@exitbook/core';
import { Decimal } from 'decimal.js';
import { ok, type Result } from 'neverthrow';

import { BaseRawDataMapper } from '../../../shared/blockchain/base/mapper.js';
import type { NormalizationError } from '../../../shared/blockchain/index.js';
import type {
  CardanoAssetAmount,
  CardanoTransaction,
  CardanoTransactionInput,
  CardanoTransactionOutput,
} from '../schemas.js';
import { CardanoTransactionSchema } from '../schemas.js';

import type {
  BlockfrostAssetAmount,
  BlockfrostTransactionWithMetadata,
  BlockfrostUtxoInput,
  BlockfrostUtxoOutput,
} from './blockfrost.schemas.js';
import { BlockfrostTransactionWithMetadataSchema } from './blockfrost.schemas.js';

/**
 * Utility function to convert lovelace (smallest unit) to ADA.
 * 1 ADA = 1,000,000 lovelace
 *
 * @param lovelace - Amount in lovelace as a string
 * @returns Amount in ADA as a string with full precision
 */
function lovelaceToAda(lovelace: string): string {
  return new Decimal(lovelace).dividedBy(1_000_000).toFixed();
}

/**
 * Mapper for transforming Blockfrost transaction data into normalized Cardano transactions.
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
 */
export class BlockfrostTransactionMapper extends BaseRawDataMapper<
  BlockfrostTransactionWithMetadata,
  CardanoTransaction
> {
  protected readonly inputSchema = BlockfrostTransactionWithMetadataSchema;
  protected readonly outputSchema = CardanoTransactionSchema;

  /**
   * Transform validated Blockfrost transaction data into normalized CardanoTransaction format.
   *
   * @param rawData - Validated Blockfrost transaction data with metadata
   * @param _sourceContext - Source metadata (not used in current implementation)
   * @returns Result containing normalized CardanoTransaction or NormalizationError
   */
  protected mapInternal(
    rawData: BlockfrostTransactionWithMetadata,
    _sourceContext: SourceMetadata
  ): Result<CardanoTransaction, NormalizationError> {
    // Map inputs from Blockfrost format to normalized format
    const inputs: CardanoTransactionInput[] = rawData.inputs.map((input: BlockfrostUtxoInput) => ({
      address: input.address,
      amounts: this.mapAssetAmounts(input.amount),
      outputIndex: input.output_index,
      txHash: input.tx_hash,
    }));

    // Map outputs from Blockfrost format to normalized format
    const outputs: CardanoTransactionOutput[] = rawData.outputs.map((output: BlockfrostUtxoOutput) => ({
      address: output.address,
      amounts: this.mapAssetAmounts(output.amount),
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
  private mapAssetAmounts(amounts: BlockfrostAssetAmount[]): CardanoAssetAmount[] {
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
}
