import type { SourceMetadata } from '@exitbook/core';
import type { Result } from 'neverthrow';

import { BaseRawDataMapper } from '../../../shared/blockchain/base/mapper.js';
import type { NormalizationError } from '../../../shared/blockchain/index.js';
import type { CardanoTransaction } from '../schemas.js';
import { CardanoTransactionSchema } from '../schemas.js';

import { mapBlockfrostTransaction } from './blockfrost.mapper-utils.js';
import type { BlockfrostTransactionWithMetadata } from './blockfrost.schemas.js';
import { BlockfrostTransactionWithMetadataSchema } from './blockfrost.schemas.js';

/**
 * Mapper for transforming Blockfrost transaction data into normalized Cardano transactions.
 * Following the Functional Core / Imperative Shell pattern - delegates business logic to pure functions.
 */
export class BlockfrostTransactionMapper extends BaseRawDataMapper<
  BlockfrostTransactionWithMetadata,
  CardanoTransaction
> {
  protected readonly inputSchema = BlockfrostTransactionWithMetadataSchema;
  protected readonly outputSchema = CardanoTransactionSchema;

  protected mapInternal(
    rawData: BlockfrostTransactionWithMetadata,
    sourceContext: SourceMetadata
  ): Result<CardanoTransaction, NormalizationError> {
    return mapBlockfrostTransaction(rawData, sourceContext);
  }
}
