import type { RawTransactionMetadata, ImportSessionMetadata } from '@exitbook/data';
import { Decimal } from 'decimal.js';
import { type Result, ok } from 'neverthrow';

import { BaseRawDataMapper } from '../../../core/blockchain/base/mapper.ts';
import type { NormalizationError } from '../../../core/blockchain/index.ts';
import { RegisterTransactionMapper } from '../../../core/blockchain/index.ts';
import { BitcoinTransactionSchema } from '../schemas.js';
import type {
  BitcoinTransactionInput,
  BitcoinTransactionOutput,
  BitcoinTransaction as BitcoinTransaction,
} from '../types.ts';

import { BlockchainComTransactionSchema } from './blockchain-com.schemas.js';
import type { BlockchainComTransaction } from './blockchain-com.types.js';

@RegisterTransactionMapper('blockchain.com')
export class BlockchainComTransactionMapper extends BaseRawDataMapper<BlockchainComTransaction, BitcoinTransaction> {
  protected readonly inputSchema = BlockchainComTransactionSchema;
  protected readonly outputSchema = BitcoinTransactionSchema;

  /**
   * Extracts structured input/output data for sophisticated analysis
   */
  protected mapInternal(
    rawData: BlockchainComTransaction,
    _metadata: RawTransactionMetadata,
    _sessionContext: ImportSessionMetadata
  ): Result<BitcoinTransaction, NormalizationError> {
    const timestamp = rawData.time * 1000; // Convert from seconds to milliseconds

    // Extract structured inputs with addresses and values
    const inputs: BitcoinTransactionInput[] = rawData.inputs.map((input, _index) => ({
      address: input.prev_out?.addr,
      txid: '', // Blockchain.com doesn't provide input txid in this format
      value: input.prev_out?.value ? input.prev_out.value.toString() : '0',
      vout: input.prev_out?.n,
    }));

    // Extract structured outputs with addresses and values
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

    // Add optional fields
    if (rawData.block_height) {
      normalized.blockHeight = rawData.block_height;
    }
    if (rawData.fee > 0) {
      const btcFee = new Decimal(rawData.fee).div(100000000).toString();
      normalized.feeAmount = btcFee;
      normalized.feeCurrency = 'BTC';
    }

    return ok(normalized);
  }
}
