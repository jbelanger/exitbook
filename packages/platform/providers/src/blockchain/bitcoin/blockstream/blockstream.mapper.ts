import type { SourceMetadata } from '@exitbook/core';
import type { Result } from 'neverthrow';

import { BaseRawDataMapper } from '../../../shared/blockchain/base/mapper.js';
import type { NormalizationError } from '../../../shared/blockchain/index.js';
import { mapBlockstreamTransaction } from '../mapper-utils.js';
import { BitcoinTransactionSchema } from '../schemas.js';
import type { BitcoinTransaction } from '../schemas.js';

import { BlockstreamTransactionSchema, type BlockstreamTransaction } from './blockstream.schemas.js';

export class BlockstreamTransactionMapper extends BaseRawDataMapper<BlockstreamTransaction, BitcoinTransaction> {
  protected readonly inputSchema = BlockstreamTransactionSchema;
  protected readonly outputSchema = BitcoinTransactionSchema;

  protected mapInternal(
    rawData: BlockstreamTransaction,
    sourceContext: SourceMetadata
  ): Result<BitcoinTransaction, NormalizationError> {
    return mapBlockstreamTransaction(rawData, sourceContext);
  }
}
