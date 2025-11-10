import type { SourceMetadata } from '@exitbook/core';
import { ok, type Result } from 'neverthrow';

import { withValidation, type NormalizationError } from '../../../../shared/blockchain/index.ts';
import type { BitcoinChainConfig } from '../../chain-config.interface.js';
import {
  BitcoinTransactionSchema,
  type BitcoinTransaction,
  type BitcoinTransactionInput,
  type BitcoinTransactionOutput,
} from '../../schemas.js';
import { satoshisToBtcString } from '../../utils.ts';

import { BlockstreamTransactionSchema, type BlockstreamTransaction } from './blockstream.schemas.js';

/**
 * Internal pure mapper function (without validation).
 * Maps Blockstream transaction to normalized BitcoinTransaction.
 */
function mapBlockstreamTransactionInternal(
  rawData: BlockstreamTransaction,
  _sourceContext: SourceMetadata,
  chainConfig: BitcoinChainConfig
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
    currency: chainConfig.nativeCurrency,
    id: rawData.txid,
    inputs,
    outputs,
    providerName: 'blockstream.info',
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

  return ok(normalized);
}

/**
 * Map Blockstream transaction to normalized BitcoinTransaction with validation.
 * Validates both input (BlockstreamTransaction) and output (BitcoinTransaction) schemas.
 */
export const mapBlockstreamTransaction = withValidation(
  BlockstreamTransactionSchema,
  BitcoinTransactionSchema,
  'BlockstreamTransaction'
)(mapBlockstreamTransactionInternal);
