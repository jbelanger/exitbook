import type { SourceMetadata } from '@exitbook/core';
import type { Result } from 'neverthrow';

import { validateOutput, type NormalizationError } from '../../../../core/index.js';
import type { BitcoinChainConfig } from '../../chain-config.interface.js';
import {
  BitcoinTransactionSchema,
  type BitcoinTransaction,
  type BitcoinTransactionInput,
  type BitcoinTransactionOutput,
} from '../../schemas.js';
import { satoshisToBtcString } from '../../utils.js';

import type { MempoolTransaction } from './mempool-space.schemas.js';

/**
 * Map Mempool.space transaction to normalized BitcoinTransaction.
 * Input data is validated by HTTP client schema validation.
 * Output data is validated before returning.
 */
export function mapMempoolSpaceTransaction(
  rawData: MempoolTransaction,
  _sourceContext: SourceMetadata,
  chainConfig: BitcoinChainConfig
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
    currency: chainConfig.nativeCurrency,
    id: rawData.txid,
    inputs,
    outputs,
    providerName: 'mempool.space',
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
    normalized.feeAmount = satoshisToBtcString(rawData.fee);
    normalized.feeCurrency = chainConfig.nativeCurrency;
  }

  return validateOutput(normalized, BitcoinTransactionSchema, 'MempoolTransaction');
}
