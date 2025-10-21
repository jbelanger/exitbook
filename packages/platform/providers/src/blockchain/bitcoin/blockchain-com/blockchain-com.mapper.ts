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

import { BlockchainComTransactionSchema, type BlockchainComTransaction } from './blockchain-com.schemas.js';

export class BlockchainComTransactionMapper extends BaseRawDataMapper<BlockchainComTransaction, BitcoinTransaction> {
  protected readonly inputSchema = BlockchainComTransactionSchema;
  protected readonly outputSchema = BitcoinTransactionSchema;

  /**
   * Extracts structured input/output data for sophisticated analysis
   */
  protected mapInternal(
    rawData: BlockchainComTransaction,
    _sessionContext: ImportSessionMetadata
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
      currency: 'BTC',
      id: rawData.hash,
      inputs,
      outputs,
      providerId: 'blockchain.com',
      status: rawData.block_height ? 'success' : 'pending',
      timestamp,
    };

    if (rawData.block_height) {
      normalized.blockHeight = rawData.block_height;
    }
    if (rawData.fee > 0) {
      const btcFee = parseDecimal(rawData.fee.toString()).div(100000000).toString();
      normalized.feeAmount = btcFee;
      normalized.feeCurrency = 'BTC';
    }

    return ok(normalized);
  }
}
