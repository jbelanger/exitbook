import type { SourceMetadata } from '@exitbook/core';
import type { Result } from 'neverthrow';

import { BaseRawDataMapper } from '../../../shared/blockchain/base/mapper.js';
import type { NormalizationError } from '../../../shared/blockchain/index.js';
import { SolanaTransactionSchema } from '../schemas.js';
import type { SolanaTransaction } from '../types.js';

import { mapSolscanTransaction } from './solscan.mapper-utils.js';
import { SolscanRawTransactionDataSchema, type SolscanTransaction } from './solscan.schemas.js';

export class SolscanTransactionMapper extends BaseRawDataMapper<SolscanTransaction, SolanaTransaction> {
  protected readonly inputSchema = SolscanRawTransactionDataSchema;
  protected readonly outputSchema = SolanaTransactionSchema;

  protected mapInternal(
    rawData: SolscanTransaction,
    sourceContext: SourceMetadata
  ): Result<SolanaTransaction, NormalizationError> {
    return mapSolscanTransaction(rawData, sourceContext);
  }
}
