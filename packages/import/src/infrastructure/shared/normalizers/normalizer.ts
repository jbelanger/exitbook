import { type Result, err, ok } from 'neverthrow';

import type { ImportSessionMetadata } from '../../../app/ports/processors.ts';
import { TransactionMapperFactory } from '../processors/processor-registry.ts';

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
  normalize(rawData: unknown, providerId: string, sessionContext: ImportSessionMetadata): Result<unknown, string> {
    // Get the appropriate mapper for this provider (same as current processor)
    const mapper = TransactionMapperFactory.create(providerId);
    if (!mapper) {
      return err(`No mapper found for provider: ${providerId}`);
    }

    // Transform using the provider-specific mapper
    const transformResult = mapper.map(rawData, sessionContext);

    if (transformResult.isErr()) {
      return err(`Transform failed for ${providerId}: ${transformResult.error}`);
    }

    const blockchainTransaction = transformResult.value;
    if (!blockchainTransaction) {
      return err(`No transactions returned from ${providerId} mapper`);
    }

    if (!blockchainTransaction) {
      return err(`No valid transaction object returned from ${providerId} mapper`);
    }

    return ok(blockchainTransaction);
  }
}
