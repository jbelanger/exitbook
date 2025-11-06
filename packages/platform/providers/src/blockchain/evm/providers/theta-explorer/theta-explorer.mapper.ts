import type { SourceMetadata } from '@exitbook/core';
import type { Result } from 'neverthrow';

import { BaseRawDataMapper } from '../../../../shared/blockchain/base/mapper.js';
import type { NormalizationError } from '../../../../shared/blockchain/index.js';
import { EvmTransactionSchema } from '../../schemas.js';
import type { EvmTransaction } from '../../types.js';

import { mapThetaExplorerTransaction } from './theta-explorer.mapper-utils.js';
import { ThetaTransactionSchema, type ThetaTransaction } from './theta-explorer.schemas.js';

export class ThetaExplorerTransactionMapper extends BaseRawDataMapper<ThetaTransaction, EvmTransaction> {
  protected readonly inputSchema = ThetaTransactionSchema;
  protected readonly outputSchema = EvmTransactionSchema;

  protected mapInternal(
    rawData: ThetaTransaction,
    sourceContext: SourceMetadata
  ): Result<EvmTransaction, NormalizationError> {
    return mapThetaExplorerTransaction(rawData, sourceContext);
  }
}
