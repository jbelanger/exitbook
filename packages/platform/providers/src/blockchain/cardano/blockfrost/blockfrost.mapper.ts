import type { SourceMetadata } from '@exitbook/core';
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
  BlockfrostTransactionUtxos,
  BlockfrostUtxoInput,
  BlockfrostUtxoOutput,
} from './blockfrost.schemas.js';
import { BlockfrostTransactionUtxosSchema } from './blockfrost.schemas.js';

/**
 * Mapper for transforming Blockfrost transaction UTXOs into normalized Cardano transactions.
 *
 * Blockfrost's /txs/{hash}/utxos endpoint provides detailed input/output information but does not
 * include block metadata (height, hash, timestamp) or fee information. These fields are handled as follows:
 * - timestamp: Uses current time (Date.now()) since block_time is not available in this endpoint
 * - blockHeight/blockId: Left undefined (will be enriched later if needed)
 * - fee: Set to "0" (will be calculated or enriched later)
 *
 * The mapper handles Cardano's multi-asset support where each input/output can contain multiple
 * assets (ADA and/or native tokens). ADA amounts are identified by unit "lovelace" and automatically
 * tagged with symbol "ADA" and decimals 6.
 */
export class BlockfrostTransactionMapper extends BaseRawDataMapper<BlockfrostTransactionUtxos, CardanoTransaction> {
  protected readonly inputSchema = BlockfrostTransactionUtxosSchema;
  protected readonly outputSchema = CardanoTransactionSchema;

  /**
   * Transform validated Blockfrost transaction data into normalized CardanoTransaction format.
   *
   * @param rawData - Validated Blockfrost transaction UTXOs data
   * @param _sourceContext - Source metadata (not used in current implementation)
   * @returns Result containing normalized CardanoTransaction or NormalizationError
   */
  protected mapInternal(
    rawData: BlockfrostTransactionUtxos,
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

    // Build normalized transaction
    const normalized: CardanoTransaction = {
      currency: 'ADA',
      feeAmount: '0', // Blockfrost /txs/{hash}/utxos doesn't include fee; set to "0" for Phase 1
      feeCurrency: 'ADA',
      id: rawData.hash,
      inputs,
      outputs,
      providerId: 'blockfrost',
      status: 'success', // Assume all fetched transactions are confirmed
      timestamp: Date.now(), // Blockfrost /txs/{hash}/utxos doesn't include timestamp; use current time
    };

    // Note: blockHeight and blockId are left undefined as they're not available in the
    // /txs/{hash}/utxos endpoint. They can be enriched later if needed.

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
