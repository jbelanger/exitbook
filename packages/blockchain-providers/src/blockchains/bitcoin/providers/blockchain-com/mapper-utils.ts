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

import type { BlockchainComTransaction } from './blockchain-com.schemas.js';

/**
 * Map Blockchain.com transaction to normalized BitcoinTransaction.
 * Input data is validated by HTTP client schema validation.
 * Output data is validated before returning.
 */
export function mapBlockchainComTransaction(
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

  return validateOutput(normalized, BitcoinTransactionSchema, 'BlockchainComTransaction');
}
