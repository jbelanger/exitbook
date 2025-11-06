import type { SourceMetadata } from '@exitbook/core';
import type { Result } from 'neverthrow';

import { BaseRawDataMapper } from '../../../shared/blockchain/base/mapper.js';
import type { NormalizationError } from '../../../shared/blockchain/index.js';
import { SolanaTransactionSchema } from '../schemas.js';
import type { SolanaTransaction } from '../types.js';

import { mapHeliusTransaction } from './helius.mapper-utils.js';
import { SolanaRawTransactionDataSchema, type HeliusTransaction } from './helius.schemas.js';

export class HeliusTransactionMapper extends BaseRawDataMapper<HeliusTransaction, SolanaTransaction> {
  protected readonly inputSchema = SolanaRawTransactionDataSchema;
  protected readonly outputSchema = SolanaTransactionSchema;

  protected mapInternal(
    rawData: HeliusTransaction,
    sourceContext: SourceMetadata
  ): Result<SolanaTransaction, NormalizationError> {
    return mapHeliusTransaction(rawData, sourceContext);
  }
}
