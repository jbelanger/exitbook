import { parseDecimal, type RawTransactionMetadata } from '@exitbook/core';
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

import { TatumBitcoinTransactionSchema } from './tatum.schemas.js';
import type { TatumBitcoinTransaction } from './tatum.types.js';

export class TatumBitcoinTransactionMapper extends BaseRawDataMapper<TatumBitcoinTransaction, BitcoinTransaction> {
  protected readonly inputSchema = TatumBitcoinTransactionSchema;
  protected readonly outputSchema = BitcoinTransactionSchema;

  /**
   * Extracts structured input/output data for sophisticated analysis
   */
  protected mapInternal(
    rawData: TatumBitcoinTransaction,
    _metadata: RawTransactionMetadata,
    _sessionContext: ImportSessionMetadata
  ): Result<BitcoinTransaction, NormalizationError> {
    const timestamp = rawData.time * 1000;

    const inputs: BitcoinTransactionInput[] = rawData.inputs.map((input, _index) => ({
      address: input.coin.address,
      txid: input.prevout.hash,
      value: input.coin.value.toString(),
      vout: input.prevout.index,
    }));

    const outputs: BitcoinTransactionOutput[] = rawData.outputs.map((output, index) => ({
      address: output.address,
      index,
      value: output.value.toString(),
    }));

    const normalized: BitcoinTransaction = {
      currency: 'BTC',
      id: rawData.hash,
      inputs,
      outputs,
      providerId: 'tatum',
      status: rawData.blockNumber ? 'success' : 'pending',
      timestamp,
    };

    if (rawData.blockNumber) {
      normalized.blockHeight = rawData.blockNumber;
    }
    if (rawData.block) {
      normalized.blockId = rawData.block;
    }
    if (rawData.fee > 0) {
      const btcFee = parseDecimal(rawData.fee.toString()).div(100000000).toString();
      normalized.feeAmount = btcFee;
      normalized.feeCurrency = 'BTC';
    }

    return ok(normalized);
  }
}
