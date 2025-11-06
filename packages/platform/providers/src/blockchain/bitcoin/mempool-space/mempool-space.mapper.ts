import type { SourceMetadata } from '@exitbook/core';
import type { Result } from 'neverthrow';

import { BaseRawDataMapper } from '../../../shared/blockchain/base/mapper.ts';
import type { NormalizationError } from '../../../shared/blockchain/index.ts';
import { mapMempoolSpaceTransaction } from '../mapper-utils.js';
import { BitcoinTransactionSchema } from '../schemas.js';
import type { BitcoinTransaction } from '../schemas.ts';

import { MempoolTransactionSchema, type MempoolTransaction } from './mempool-space.schemas.js';

export class MempoolSpaceTransactionMapper extends BaseRawDataMapper<MempoolTransaction, BitcoinTransaction> {
  protected readonly inputSchema = MempoolTransactionSchema;
  protected readonly outputSchema = BitcoinTransactionSchema;

  protected mapInternal(
    rawData: MempoolTransaction,
    sourceContext: SourceMetadata
  ): Result<BitcoinTransaction, NormalizationError> {
    return mapMempoolSpaceTransaction(rawData, sourceContext);
  }
}
