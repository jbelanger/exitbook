import type { SourceMetadata } from '@exitbook/core';
import type { Result } from 'neverthrow';

import { BaseRawDataMapper } from '../../../../shared/blockchain/base/mapper.js';
import type { NormalizationError } from '../../../../shared/blockchain/index.js';
import { EvmTransactionSchema } from '../../schemas.js';
import type { EvmTransaction } from '../../types.js';

import { mapAlchemyTransaction } from './alchemy.mapper-utils.js';
import { AlchemyAssetTransferSchema, type AlchemyAssetTransfer } from './alchemy.schemas.js';

export class AlchemyTransactionMapper extends BaseRawDataMapper<AlchemyAssetTransfer, EvmTransaction> {
  protected readonly inputSchema = AlchemyAssetTransferSchema;
  protected readonly outputSchema = EvmTransactionSchema;

  protected mapInternal(
    rawData: AlchemyAssetTransfer,
    sourceContext: SourceMetadata
  ): Result<EvmTransaction, NormalizationError> {
    return mapAlchemyTransaction(rawData, sourceContext);
  }
}
