import { parseDecimal } from '@exitbook/core';
import type { SourceMetadata } from '@exitbook/core';
import { ok, type Result } from 'neverthrow';

import { BaseRawDataMapper } from '../../../shared/blockchain/base/mapper.js';
import type { NormalizationError } from '../../../shared/blockchain/index.js';
import { BitcoinTransactionSchema } from '../schemas.js';
import type { BitcoinTransaction, BitcoinTransactionInput, BitcoinTransactionOutput } from '../schemas.js';

import { BlockCypherTransactionSchema, type BlockCypherTransaction } from './blockcypher.schemas.js';

export class BlockCypherTransactionMapper extends BaseRawDataMapper<BlockCypherTransaction, BitcoinTransaction> {
  protected readonly inputSchema = BlockCypherTransactionSchema;
  protected readonly outputSchema = BitcoinTransactionSchema;

  /**
   * Extracts structured input/output data for sophisticated analysis
   */
  protected mapInternal(
    rawData: BlockCypherTransaction,
    _sourceContext: SourceMetadata
  ): Result<BitcoinTransaction, NormalizationError> {
    const timestamp = rawData.confirmed ? new Date(rawData.confirmed).getTime() : Date.now();

    const inputs: BitcoinTransactionInput[] = rawData.inputs.map((input) => ({
      address: input.addresses && input.addresses.length > 0 ? input.addresses[0] : undefined,
      txid: input.prev_hash,
      value: input.output_value ? input.output_value.toString() : '0',
      vout: input.output_index,
    }));

    const outputs: BitcoinTransactionOutput[] = rawData.outputs.map((output, index) => ({
      address: output.addresses && output.addresses.length > 0 ? output.addresses[0] : undefined,
      index,
      value: output.value.toString(),
    }));

    const normalized: BitcoinTransaction = {
      currency: 'BTC',
      id: rawData.hash,
      inputs,
      outputs,
      providerId: 'blockcypher',
      status: rawData.confirmations > 0 ? 'success' : 'pending',
      timestamp,
    };

    if (rawData.block_height) {
      normalized.blockHeight = rawData.block_height;
    }
    if (rawData.block_hash) {
      normalized.blockId = rawData.block_hash;
    }
    if (rawData.fees > 0) {
      const btcFee = parseDecimal(rawData.fees.toString()).div(100000000).toFixed();
      normalized.feeAmount = btcFee;
      normalized.feeCurrency = 'BTC';
    }

    return ok(normalized);
  }
}
