import type { SourceMetadata } from '@exitbook/core';
import { ok, type Result } from 'neverthrow';

import { withValidation, type NormalizationError } from '../../../../core/index.js';
import type { BitcoinChainConfig } from '../../chain-config.interface.js';
import {
  BitcoinTransactionSchema,
  type BitcoinTransaction,
  type BitcoinTransactionInput,
  type BitcoinTransactionOutput,
} from '../../schemas.js';
import { satoshisToBtcString } from '../../utils.js';

import { BlockchainComTransactionSchema, type BlockchainComTransaction } from './blockchain-com.schemas.js';

/**
 * Internal pure mapper function (without validation).
 * Maps Blockchain.com transaction to normalized BitcoinTransaction.
 */
function mapBlockchainComTransactionInternal(
  rawData: BlockchainComTransaction,
  _sourceContext: SourceMetadata,
  chainConfig: BitcoinChainConfig
): Result<BitcoinTransaction, NormalizationError> {
  const timestamp = rawData.time * 1000;

  const inputs: BitcoinTransactionInput[] = rawData.inputs.map((input, _index) => ({
    address: input.prev_out?.addr,
    txid: '',
    value: input.prev_out?.value ? input.prev_out.value.toString() : '0',
    vout: input.prev_out?.n,
  }));

  const outputs: BitcoinTransactionOutput[] = rawData.out.map((output, _index) => ({
    address: output.addr,
    index: output.n,
    value: output.value.toString(),
  }));

  const normalized: BitcoinTransaction = {
    currency: chainConfig.nativeCurrency,
    id: rawData.hash,
    inputs,
    outputs,
    providerName: 'blockchain.com',
    status: rawData.block_height ? 'success' : 'pending',
    timestamp,
  };

  if (rawData.block_height) {
    normalized.blockHeight = rawData.block_height;
  }
  if (rawData.fee > 0) {
    normalized.feeAmount = satoshisToBtcString(rawData.fee);
    normalized.feeCurrency = chainConfig.nativeCurrency;
  }

  return ok(normalized);
}

/**
 * Map Blockchain.com transaction to normalized BitcoinTransaction with validation.
 * Validates both input (BlockchainComTransaction) and output (BitcoinTransaction) schemas.
 */
export const mapBlockchainComTransaction = withValidation(
  BlockchainComTransactionSchema,
  BitcoinTransactionSchema,
  'BlockchainComTransaction'
)(mapBlockchainComTransactionInternal);
