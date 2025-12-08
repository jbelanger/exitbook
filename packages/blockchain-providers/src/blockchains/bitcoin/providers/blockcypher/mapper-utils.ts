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

import type { BlockCypherTransaction } from './blockcypher.schemas.js';

/**
 * Map BlockCypher transaction to normalized BitcoinTransaction.
 * Input data is validated by HTTP client schema validation.
 * Output data is validated before returning.
 */
export function mapBlockCypherTransaction(
  rawData: BlockCypherTransaction,
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

  return validateOutput(normalized, BitcoinTransactionSchema, 'BlockCypherTransaction');
}
