import type { SourceMetadata } from '@exitbook/core';
import type { Result } from 'neverthrow';

import { BaseRawDataMapper } from '../../../shared/blockchain/base/mapper.js';
import type { NormalizationError } from '../../../shared/blockchain/index.js';
import { mapTatumTransaction } from '../mapper-utils.js';
import { BitcoinTransactionSchema } from '../schemas.js';
import type { BitcoinTransaction } from '../schemas.js';

import { TatumBitcoinTransactionSchema, type TatumBitcoinTransaction } from './tatum.schemas.js';

export class TatumBitcoinTransactionMapper extends BaseRawDataMapper<TatumBitcoinTransaction, BitcoinTransaction> {
  protected readonly inputSchema = TatumBitcoinTransactionSchema;
  protected readonly outputSchema = BitcoinTransactionSchema;

  protected mapInternal(
    rawData: TatumBitcoinTransaction,
    sourceContext: SourceMetadata
  ): Result<BitcoinTransaction, NormalizationError> {
    return mapTatumTransaction(rawData, sourceContext);
  }
}
