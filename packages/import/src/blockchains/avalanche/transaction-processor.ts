import type { UniversalTransaction } from '@crypto/core';
import { getLogger } from '@crypto/shared-logger';

import type { IDependencyContainer } from '../../shared/common/interfaces.ts';
import { BaseProcessor } from '../../shared/processors/base-processor.ts';
import type { ApiClientRawData, StoredRawData } from '../../shared/processors/interfaces.ts';
import { ProcessorFactory } from '../../shared/processors/processor-registry.ts';
// Import processors to trigger registration
import './processors/index.ts';
import type { AvalancheRawTransactionData } from './transaction-importer.ts';
import type {
  SnowtraceInternalTransaction,
  SnowtraceTokenTransfer,
  SnowtraceTransaction,
  TransactionGroup,
} from './types.ts';
import { AvalancheUtils } from './utils.ts';

/**
 * Avalanche transaction processor that converts raw blockchain transaction data
 * into UniversalTransaction format using correlation system for smart classification.
 */
export class AvalancheTransactionProcessor extends BaseProcessor<ApiClientRawData<AvalancheRawTransactionData>> {
  private correlationLogger = getLogger('AvalancheCorrelation');

  constructor(_dependencies: IDependencyContainer) {
    super('avalanche');
  }

  /**
   * Check if this processor can handle the specified source type.
   */
  protected canProcessSpecific(sourceType: string): boolean {
    return sourceType === 'blockchain';
  }

  /**
   * Override the base process method to use correlation system
   */
  async process(
    rawDataItems: StoredRawData<ApiClientRawData<AvalancheRawTransactionData>>[]
  ): Promise<UniversalTransaction[]> {
    if (rawDataItems.length === 0) {
      return [];
    }

    this.correlationLogger.info(`Processing ${rawDataItems.length} Avalanche transactions using correlation system`);

    // Group raw data by source address for correlation
    const addressGroups = new Map<
      string,
      {
        internal: SnowtraceInternalTransaction[];
        normal: SnowtraceTransaction[];
        tokens: SnowtraceTokenTransfer[];
      }
    >();

    // Separate transactions by type and address
    for (const rawDataItem of rawDataItems) {
      const apiClientRawData = rawDataItem.rawData;
      const sourceAddress = apiClientRawData.sourceAddress;

      if (!sourceAddress) {
        this.correlationLogger.warn('Skipping transaction without source address');
        continue;
      }

      if (!addressGroups.has(sourceAddress)) {
        addressGroups.set(sourceAddress, {
          internal: [],
          normal: [],
          tokens: [],
        });
      }

      const group = addressGroups.get(sourceAddress)!;
      const { providerId, rawData } = apiClientRawData;

      // Sort transactions by provider type
      if (providerId === 'snowtrace') {
        group.normal.push(rawData as SnowtraceTransaction);
      } else if (providerId === 'snowtrace-internal') {
        group.internal.push(rawData as SnowtraceInternalTransaction);
      } else if (providerId === 'snowtrace-token') {
        group.tokens.push(rawData as SnowtraceTokenTransfer);
      }
    }

    // Process each address group using correlation
    const allTransactions: UniversalTransaction[] = [];

    for (const [sourceAddress, transactionData] of addressGroups) {
      this.correlationLogger.debug(
        `Correlating transactions for address ${sourceAddress.substring(0, 10)}... - Normal: ${transactionData.normal.length}, Internal: ${transactionData.internal.length}, Token: ${transactionData.tokens.length}`
      );

      // Group transactions by hash
      const transactionGroups = AvalancheUtils.groupTransactionsByHash(
        transactionData.normal,
        transactionData.internal,
        transactionData.tokens,
        sourceAddress
      );

      this.correlationLogger.debug(
        `Created ${transactionGroups.length} correlation groups for address ${sourceAddress.substring(0, 10)}...`
      );

      // Process each correlated group
      const correlationProcessor = ProcessorFactory.create('avalanche-correlation');
      if (!correlationProcessor) {
        this.correlationLogger.error('Correlation processor not found');
        continue;
      }

      for (const group of transactionGroups) {
        const validationResult = correlationProcessor.validate(group);
        if (!validationResult.isValid) {
          this.correlationLogger.warn(
            `Invalid transaction group ${group.hash}: ${validationResult.errors?.join(', ')}`
          );
          continue;
        }

        const transformResult = correlationProcessor.transform(group, [sourceAddress]);
        if (transformResult.isErr()) {
          this.correlationLogger.error(`Failed to transform group ${group.hash}: ${transformResult.error}`);
          continue;
        }

        const universalTransaction = transformResult.value;
        allTransactions.push(universalTransaction);

        this.correlationLogger.debug(
          `Successfully processed correlated transaction ${universalTransaction.id}: ${universalTransaction.type} of ${universalTransaction.amount.amount.toString()} ${universalTransaction.symbol}`
        );
      }
    }

    this.correlationLogger.info(
      `Correlation processing complete: ${rawDataItems.length} raw transactions → ${allTransactions.length} correlated transactions`
    );
    return allTransactions;
  }

  /**
   * Fallback method for individual transaction processing (maintained for compatibility)
   */
  async processSingle(
    rawDataItem: StoredRawData<ApiClientRawData<AvalancheRawTransactionData>>
  ): Promise<UniversalTransaction | null> {
    this.correlationLogger.debug('Using fallback single transaction processing');

    try {
      const apiClientRawData = rawDataItem.rawData;
      const { providerId, rawData } = apiClientRawData;

      // Get the appropriate processor for this provider
      const processor = ProcessorFactory.create(providerId);
      if (!processor) {
        this.logger.error(`No processor found for provider: ${providerId}`);
        return null;
      }

      // Validate the raw data
      const validationResult = processor.validate(rawData);
      if (!validationResult.isValid) {
        this.logger.error(`Invalid raw data from ${providerId}: ${validationResult.errors?.join(', ')}`);
        return null;
      }

      // Extract wallet addresses from source address context
      const walletAddresses: string[] = [];
      if (apiClientRawData.sourceAddress) {
        walletAddresses.push(apiClientRawData.sourceAddress);
      }

      // Transform using the provider-specific processor
      const transformResult = processor.transform(rawData, walletAddresses);

      if (transformResult.isErr()) {
        this.logger.error(`Transform failed for ${providerId}: ${transformResult.error}`);
        return null;
      }

      const universalTransaction = transformResult.value;
      this.logger.debug(`Successfully processed transaction ${universalTransaction.id} from ${providerId}`);
      return universalTransaction;
    } catch (error) {
      this.logger.error(`Failed to process single transaction ${rawDataItem.sourceTransactionId}: ${error}`);
      return null;
    }
  }
}
