import type { RawTransactionMetadata } from '@exitbook/core';
import type { ImportSessionMetadata } from '@exitbook/data';
import { Decimal } from 'decimal.js';
import { type Result, ok } from 'neverthrow';

import { BaseRawDataMapper } from '../../../core/blockchain/base/mapper.ts';
import { RegisterTransactionMapper } from '../../../core/blockchain/index.ts';
import type { NormalizationError } from '../../../core/blockchain/index.ts';
import { BitcoinTransactionSchema } from '../schemas.js';
import type {
  BitcoinTransactionInput,
  BitcoinTransactionOutput,
  BitcoinTransaction as BitcoinTransaction,
} from '../types.ts';

import { TatumBitcoinTransactionSchema } from './tatum.schemas.js';
import type { TatumBitcoinTransaction } from './tatum.types.js';

@RegisterTransactionMapper('tatum')
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
    const timestamp = rawData.time * 1000; // Convert from seconds to milliseconds

    // Extract structured inputs with addresses and values
    const inputs: BitcoinTransactionInput[] = rawData.inputs.map((input, _index) => ({
      address: input.coin.address,
      txid: input.prevout.hash,
      value: input.coin.value.toString(),
      vout: input.prevout.index,
    }));

    // Extract structured outputs with addresses and values
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

    // Add optional fields
    if (rawData.blockNumber) {
      normalized.blockHeight = rawData.blockNumber;
    }
    if (rawData.block) {
      normalized.blockId = rawData.block;
    }
    if (rawData.fee > 0) {
      const btcFee = new Decimal(rawData.fee).div(100000000).toString();
      normalized.feeAmount = btcFee;
      normalized.feeCurrency = 'BTC';
    }

    return ok(normalized);
  }
}
