import type { SourceMetadata } from '@exitbook/core';
import { type Result } from 'neverthrow';

import { BaseRawDataMapper } from '../../../../shared/blockchain/base/mapper.js';
import type { NormalizationError } from '../../../../shared/blockchain/index.js';
import { CosmosTransactionSchema } from '../../schemas.js';
import type { CosmosTransaction } from '../../types.js';

import { mapInjectiveExplorerTransaction } from './injective-explorer.mapper-utils.js';
import {
  InjectiveTransactionSchema as InjectiveExplorerTransactionSchema,
  type InjectiveTransaction as InjectiveApiTransaction,
} from './injective-explorer.schemas.js';

export class InjectiveExplorerTransactionMapper extends BaseRawDataMapper<InjectiveApiTransaction, CosmosTransaction> {
  protected readonly inputSchema = InjectiveExplorerTransactionSchema;
  protected readonly outputSchema = CosmosTransactionSchema;

  protected mapInternal(
    rawData: InjectiveApiTransaction,
    sourceContext: SourceMetadata
  ): Result<CosmosTransaction, NormalizationError> {
    return mapInjectiveExplorerTransaction(rawData, sourceContext);
  }
}
