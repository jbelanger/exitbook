import type { SourceMetadata } from '@exitbook/core';
import type { Result } from 'neverthrow';

import { BaseRawDataMapper } from '../../../../shared/blockchain/base/mapper.js';
import type { NormalizationError } from '../../../../shared/blockchain/index.js';
import { EvmTransactionSchema } from '../../schemas.js';
import type { EvmTransaction } from '../../types.js';

import { mapThetaScanTransaction } from './thetascan.mapper-utils.js';
import { ThetaScanTransactionSchema, type ThetaScanTransaction } from './thetascan.schemas.js';

export class ThetaScanTransactionMapper extends BaseRawDataMapper<ThetaScanTransaction, EvmTransaction> {
  protected readonly inputSchema = ThetaScanTransactionSchema;
  protected readonly outputSchema = EvmTransactionSchema;

  protected mapInternal(
    rawData: ThetaScanTransaction,
    sourceContext: SourceMetadata
  ): Result<EvmTransaction, NormalizationError> {
    return mapThetaScanTransaction(rawData, sourceContext);
  }
}
