import type { SourceMetadata } from '@exitbook/core';
import type { Result } from 'neverthrow';

import { BaseRawDataMapper } from '../../../shared/blockchain/base/mapper.js';
import type { NormalizationError } from '../../../shared/blockchain/index.js';
import { mapNearBlocksTransaction } from '../mapper-utils.js';
import { NearTransactionSchema } from '../schemas.js';
import type { NearTransaction } from '../schemas.js';

import { NearBlocksTransactionSchema, type NearBlocksTransaction } from './nearblocks.schemas.js';

/**
 * Mapper for NearBlocks transaction data to normalized NEAR format
 */
export class NearBlocksTransactionMapper extends BaseRawDataMapper<NearBlocksTransaction, NearTransaction> {
  protected readonly inputSchema = NearBlocksTransactionSchema;
  protected readonly outputSchema = NearTransactionSchema;

  protected mapInternal(
    rawData: NearBlocksTransaction,
    sourceContext: SourceMetadata
  ): Result<NearTransaction, NormalizationError> {
    return mapNearBlocksTransaction(rawData, sourceContext);
  }
}
