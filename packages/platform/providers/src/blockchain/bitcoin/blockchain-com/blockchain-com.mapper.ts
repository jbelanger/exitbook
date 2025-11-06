import type { SourceMetadata } from '@exitbook/core';
import type { Result } from 'neverthrow';

import { BaseRawDataMapper } from '../../../shared/blockchain/base/mapper.ts';
import type { NormalizationError } from '../../../shared/blockchain/index.ts';
import { mapBlockchainComTransaction } from '../mapper-utils.js';
import { BitcoinTransactionSchema } from '../schemas.js';
import type { BitcoinTransaction } from '../schemas.ts';

import { BlockchainComTransactionSchema, type BlockchainComTransaction } from './blockchain-com.schemas.js';

export class BlockchainComTransactionMapper extends BaseRawDataMapper<BlockchainComTransaction, BitcoinTransaction> {
  protected readonly inputSchema = BlockchainComTransactionSchema;
  protected readonly outputSchema = BitcoinTransactionSchema;

  protected mapInternal(
    rawData: BlockchainComTransaction,
    sourceContext: SourceMetadata
  ): Result<BitcoinTransaction, NormalizationError> {
    return mapBlockchainComTransaction(rawData, sourceContext);
  }
}
