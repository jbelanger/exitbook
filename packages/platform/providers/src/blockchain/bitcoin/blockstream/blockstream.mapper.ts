import { parseDecimal } from '@exitbook/core';
import type { SourceMetadata } from '@exitbook/core';
import { type Result, ok } from 'neverthrow';

import { BaseRawDataMapper } from '../../../shared/blockchain/base/mapper.js';
import type { NormalizationError } from '../../../shared/blockchain/index.js';
import { BitcoinTransactionSchema } from '../schemas.js';
import type {
  BitcoinTransactionInput,
  BitcoinTransactionOutput,
  BitcoinTransaction as BitcoinTransaction,
} from '../schemas.js';

import { BlockstreamTransactionSchema, type BlockstreamTransaction } from './blockstream.schemas.js';

export class BlockstreamTransactionMapper extends BaseRawDataMapper<BlockstreamTransaction, BitcoinTransaction> {
  protected readonly inputSchema = BlockstreamTransactionSchema;
  protected readonly outputSchema = BitcoinTransactionSchema;

  /**
   * Extracts structured input/output data for sophisticated analysis
   */
  protected mapInternal(
    rawData: BlockstreamTransaction,
    _sourceContext: SourceMetadata
  ): Result<BitcoinTransaction, NormalizationError> {
    const timestamp =
      rawData.status.confirmed && rawData.status.block_time ? rawData.status.block_time.getTime() : Date.now();

    const inputs: BitcoinTransactionInput[] = rawData.vin.map((input) => ({
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
      providerId: 'blockstream.info',
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
      const btcFee = parseDecimal(rawData.fee.toString()).div(100000000).toFixed();
      normalized.feeAmount = btcFee;
      normalized.feeCurrency = 'BTC';
    }

    return ok(normalized);
  }
}
