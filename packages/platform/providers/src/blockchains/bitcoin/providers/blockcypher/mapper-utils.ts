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

import { BlockCypherTransactionSchema, type BlockCypherTransaction } from './blockcypher.schemas.js';

/**
 * Internal pure mapper function (without validation).
 * Maps BlockCypher transaction to normalized BitcoinTransaction.
 */
function mapBlockCypherTransactionInternal(
  rawData: BlockCypherTransaction,
  _sourceContext: SourceMetadata,
  chainConfig: BitcoinChainConfig
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
    currency: chainConfig.nativeCurrency,
    id: rawData.hash,
    inputs,
    outputs,
    providerName: 'blockcypher',
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
    normalized.feeAmount = satoshisToBtcString(rawData.fees);
    normalized.feeCurrency = chainConfig.nativeCurrency;
  }

  return ok(normalized);
}

/**
 * Map BlockCypher transaction to normalized BitcoinTransaction with validation.
 * Validates both input (BlockCypherTransaction) and output (BitcoinTransaction) schemas.
 */
export const mapBlockCypherTransaction = withValidation(
  BlockCypherTransactionSchema,
  BitcoinTransactionSchema,
  'BlockCypherTransaction'
)(mapBlockCypherTransactionInternal);
