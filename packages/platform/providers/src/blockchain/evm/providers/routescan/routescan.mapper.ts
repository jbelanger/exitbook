import type { SourceMetadata } from '@exitbook/core';
import type { Result } from 'neverthrow';

import { BaseRawDataMapper } from '../../../../shared/blockchain/base/mapper.js';
import type { NormalizationError } from '../../../../shared/blockchain/index.js';
import { EvmTransactionSchema } from '../../schemas.js';
import type { EvmTransaction } from '../../types.js';

import { mapRoutescanTransaction } from './routescan.mapper-utils.js';
import {
  RoutescanAnyTransactionSchema,
  type RoutescanInternalTransaction,
  type RoutescanTransaction,
  type RoutescanTokenTransfer,
} from './routescan.schemas.js';

/**
 * Metadata required for mapping Routescan transactions
 */
export interface RoutescanMapperContext {
  nativeCurrency: string;
}

export class RoutescanTransactionMapper extends BaseRawDataMapper<
  RoutescanTransaction | RoutescanInternalTransaction | RoutescanTokenTransfer,
  EvmTransaction
> {
  protected readonly inputSchema = RoutescanAnyTransactionSchema;
  protected readonly outputSchema = EvmTransactionSchema;

  private readonly nativeCurrency: string;

  constructor(context: RoutescanMapperContext) {
    super();
    this.nativeCurrency = context.nativeCurrency;
  }

  protected mapInternal(
    rawData: RoutescanTransaction | RoutescanInternalTransaction | RoutescanTokenTransfer,
    sourceContext: SourceMetadata
  ): Result<EvmTransaction, NormalizationError> {
    return mapRoutescanTransaction(rawData, this.nativeCurrency, sourceContext);
  }
}
