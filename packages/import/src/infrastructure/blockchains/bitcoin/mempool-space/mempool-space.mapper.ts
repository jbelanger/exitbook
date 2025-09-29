import { Decimal } from 'decimal.js';
import { type Result, ok } from 'neverthrow';

import type { ImportSessionMetadata } from '../../../../app/ports/processors.ts';
import { RegisterTransactionMapper } from '../../../shared/processors/processor-registry.ts';
import { BaseRawDataMapper } from '../../shared/base-raw-data-mapper.ts';
import type {
  BitcoinTransactionInput,
  BitcoinTransactionOutput,
  BitcoinTransaction as BitcoinTransaction,
} from '../types.ts';

import { MempoolTransactionSchema } from './mempool-space.schemas.ts';
import type { MempoolTransaction } from './mempool-space.types.ts';

@RegisterTransactionMapper('mempool.space')
export class MempoolSpaceTransactionMapper extends BaseRawDataMapper<MempoolTransaction, BitcoinTransaction> {
  protected readonly schema = MempoolTransactionSchema;

  /**
   * Extracts structured input/output data for sophisticated analysis
   */
  protected mapInternal(
    rawData: MempoolTransaction,
    _sessionContext: ImportSessionMetadata
  ): Result<BitcoinTransaction, string> {
    const timestamp =
      rawData.status.confirmed && rawData.status.block_time ? rawData.status.block_time * 1000 : Date.now();

    // Extract structured inputs with addresses and values
    const inputs: BitcoinTransactionInput[] = rawData.vin.map((input, index) => ({
      address: input.prevout?.scriptpubkey_address,
      txid: input.txid,
      value: input.prevout?.value ? input.prevout.value.toString() : '0',
      vout: input.vout,
    }));

    // Extract structured outputs with addresses and values
    const outputs: BitcoinTransactionOutput[] = rawData.vout.map((output, index) => ({
      address: output.scriptpubkey_address,
      index,
      value: output.value.toString(),
    }));

    const normalized: BitcoinTransaction = {
      currency: 'BTC',
      id: rawData.txid,
      inputs,
      outputs,
      providerId: 'mempool.space',
      status: rawData.status.confirmed ? 'success' : 'pending',
      timestamp,
    };

    // Add optional fields
    if (rawData.status.block_height) {
      normalized.blockHeight = rawData.status.block_height;
    }
    if (rawData.status.block_hash) {
      normalized.blockId = rawData.status.block_hash;
    }
    if (rawData.fee > 0) {
      const btcFee = new Decimal(rawData.fee).div(100000000).toString();
      normalized.feeAmount = btcFee;
      normalized.feeCurrency = 'BTC';
    }

    return ok(normalized);
  }
}
