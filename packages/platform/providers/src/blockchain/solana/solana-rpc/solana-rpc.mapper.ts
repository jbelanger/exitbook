import type { SourceMetadata } from '@exitbook/core';
import type { Result } from 'neverthrow';

import { BaseRawDataMapper } from '../../../shared/blockchain/base/mapper.js';
import type { NormalizationError } from '../../../shared/blockchain/index.js';
import { SolanaTransactionSchema } from '../schemas.js';
import type { SolanaTransaction } from '../types.js';

import { mapSolanaRPCTransaction } from './solana-rpc.mapper-utils.js';
import { SolanaRPCRawTransactionDataSchema, type SolanaRPCTransaction } from './solana-rpc.schemas.js';

export class SolanaRPCTransactionMapper extends BaseRawDataMapper<SolanaRPCTransaction, SolanaTransaction> {
  protected readonly inputSchema = SolanaRPCRawTransactionDataSchema;
  protected readonly outputSchema = SolanaTransactionSchema;

  protected mapInternal(
    rawData: SolanaRPCTransaction,
    sourceContext: SourceMetadata
  ): Result<SolanaTransaction, NormalizationError> {
    return mapSolanaRPCTransaction(rawData, sourceContext);
  }
}
