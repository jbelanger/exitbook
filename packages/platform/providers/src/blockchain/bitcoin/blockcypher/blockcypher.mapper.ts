import type { SourceMetadata } from '@exitbook/core';
import type { Result } from 'neverthrow';

import { BaseRawDataMapper } from '../../../shared/blockchain/base/mapper.ts';
import type { NormalizationError } from '../../../shared/blockchain/index.ts';
import { mapBlockCypherTransaction } from '../mapper-utils.js';
import { BitcoinTransactionSchema } from '../schemas.js';
import type { BitcoinTransaction } from '../schemas.js';

import { BlockCypherTransactionSchema, type BlockCypherTransaction } from './blockcypher.schemas.js';

export class BlockCypherTransactionMapper extends BaseRawDataMapper<BlockCypherTransaction, BitcoinTransaction> {
  protected readonly inputSchema = BlockCypherTransactionSchema;
  protected readonly outputSchema = BitcoinTransactionSchema;

  protected mapInternal(
    rawData: BlockCypherTransaction,
    sourceContext: SourceMetadata
  ): Result<BitcoinTransaction, NormalizationError> {
    return mapBlockCypherTransaction(rawData, sourceContext);
  }
}
