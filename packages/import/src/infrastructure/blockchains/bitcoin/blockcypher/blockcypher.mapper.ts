import { Decimal } from 'decimal.js';
import { ok, type Result } from 'neverthrow';

import type { RawTransactionMetadata } from '../../../../app/ports/importers.ts';
import type { ImportSessionMetadata } from '../../../../app/ports/transaction-processor.interface.ts';
import { RegisterTransactionMapper } from '../../../shared/processors/processor-registry.js';
import { BaseRawDataMapper } from '../../shared/base-raw-data-mapper.js';
import type { BitcoinTransaction, BitcoinTransactionInput, BitcoinTransactionOutput } from '../types.js';

import { BlockCypherTransactionSchema } from './blockcypher.schemas.js';
import type { BlockCypherTransaction } from './blockcypher.types.js';

@RegisterTransactionMapper('blockcypher')
export class BlockCypherTransactionMapper extends BaseRawDataMapper<BlockCypherTransaction, BitcoinTransaction> {
  protected readonly schema = BlockCypherTransactionSchema;

  /**
   * Extracts structured input/output data for sophisticated analysis
   */
  protected mapInternal(
    rawData: BlockCypherTransaction,
    _metadata: RawTransactionMetadata,
    _sessionContext: ImportSessionMetadata
  ): Result<BitcoinTransaction, string> {
    const timestamp = rawData.confirmed ? new Date(rawData.confirmed).getTime() : Date.now();

    // Extract structured inputs with addresses and values
    const inputs: BitcoinTransactionInput[] = rawData.inputs.map((input) => ({
      address: input.addresses && input.addresses.length > 0 ? input.addresses[0] : undefined,
      txid: input.prev_hash,
      value: input.output_value ? input.output_value.toString() : '0',
      vout: input.output_index,
    }));

    // Extract structured outputs with addresses and values
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

    // Add optional fields
    if (rawData.block_height) {
      normalized.blockHeight = rawData.block_height;
    }
    if (rawData.block_hash) {
      normalized.blockId = rawData.block_hash;
    }
    if (rawData.fees > 0) {
      const btcFee = new Decimal(rawData.fees).div(100000000).toString();
      normalized.feeAmount = btcFee;
      normalized.feeCurrency = 'BTC';
    }

    return ok(normalized);
  }
}
