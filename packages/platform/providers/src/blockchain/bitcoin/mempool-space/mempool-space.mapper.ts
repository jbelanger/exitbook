import { parseDecimal } from '@exitbook/core';
import type { ImportSessionMetadata } from '@exitbook/core';
import { type Result, ok } from 'neverthrow';

import { BaseRawDataMapper } from '../../../core/blockchain/base/mapper.ts';
import type { NormalizationError } from '../../../core/blockchain/index.ts';
import { BitcoinTransactionSchema } from '../schemas.js';
import type {
  BitcoinTransactionInput,
  BitcoinTransactionOutput,
  BitcoinTransaction as BitcoinTransaction,
} from '../types.ts';

import { MempoolTransactionSchema } from './mempool-space.schemas.js';
import type { MempoolTransaction } from './mempool-space.types.js';

export class MempoolSpaceTransactionMapper extends BaseRawDataMapper<MempoolTransaction, BitcoinTransaction> {
  protected readonly inputSchema = MempoolTransactionSchema;
  protected readonly outputSchema = BitcoinTransactionSchema;

  /**
   * Extracts structured input/output data for sophisticated analysis
   */
  protected mapInternal(
    rawData: MempoolTransaction,
    _sessionContext: ImportSessionMetadata
  ): Result<BitcoinTransaction, NormalizationError> {
    const timestamp =
      rawData.status.confirmed && rawData.status.block_time ? rawData.status.block_time.getTime() : Date.now();

    const inputs: BitcoinTransactionInput[] = rawData.vin.map((input, _index) => ({
      address: input.prevout?.scriptpubkey_address,
      txid: input.txid,
      value: input.prevout?.value ? input.prevout.value.toString() : '0',
      vout: input.vout,
    }));

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

    if (rawData.status.block_height) {
      normalized.blockHeight = rawData.status.block_height;
    }
    if (rawData.status.block_hash) {
      normalized.blockId = rawData.status.block_hash;
    }
    if (rawData.fee > 0) {
      const btcFee = parseDecimal(rawData.fee.toString()).div(100000000).toString();
      normalized.feeAmount = btcFee;
      normalized.feeCurrency = 'BTC';
    }

    return ok(normalized);
  }
}
