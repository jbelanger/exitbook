import type { ImportSessionMetadata, RawTransactionMetadata } from '@exitbook/data';
import { type Result, err, ok } from 'neverthrow';

import type { NormalizationError } from './blockchain-normalizer.interface.ts';
import { TransactionMapperFactory } from './registry/decorators.js';

/**
 * DefaultNormalizer handles pure data extraction from provider-specific JSON
 * to normalized blockchain transaction format with structured input/output data.
 *
 * Responsibility: "What happened on-chain?" - Pure factual data transformation
 * - Uses existing mapper factory to dispatch to provider-specific mappers
 * - Mappers extract structured input/output data for fund flow analysis
 * - Returns normalized blockchain transactions for processor to apply business logic
 * - Stateless - no database access or historical context
 */
export class DefaultNormalizer {
  /**
   * Normalize blockchain transaction data from any provider to blockchain-specific transaction format
   */
  normalize(
    rawData: unknown,
    metadata: RawTransactionMetadata,
    sessionContext: ImportSessionMetadata
  ): Result<unknown, NormalizationError> {
    // Get the appropriate mapper for this provider (same as current processor)
    const mapper = TransactionMapperFactory.create(metadata.providerId);
    if (!mapper) {
      return err({ message: `No mapper found for provider: ${metadata.providerId}`, type: 'error' });
    }

    // Transform using the provider-specific mapper
    const transformResult = mapper.map(rawData, metadata, sessionContext);

    if (transformResult.isErr()) {
      // Pass through the error - it's already a NormalizationError with proper type discrimination
      return transformResult;
    }

    const blockchainTransaction = transformResult.value;
    if (!blockchainTransaction) {
      return err({ message: `No transactions returned from ${metadata.providerId} mapper`, type: 'error' });
    }

    return ok(blockchainTransaction);
  }
}
