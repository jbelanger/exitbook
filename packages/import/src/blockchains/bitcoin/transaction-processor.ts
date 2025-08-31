import type { TransactionType, UniversalTransaction } from '@crypto/core';
// Import processors to trigger registration
import type { StoredRawData } from '@crypto/data';
import { createMoney } from '@crypto/shared-utils';
import { type Result, err, ok } from 'neverthrow';

import type { IDependencyContainer } from '../../shared/common/interfaces.ts';
import { BaseProcessor } from '../../shared/processors/base-processor.ts';
import type {
  ApiClientRawData,
  ImportSessionMetadata,
  ProcessingImportSession,
} from '../../shared/processors/interfaces.ts';
import { ProcessorFactory } from '../../shared/processors/processor-registry.ts';
import type { UniversalBlockchainTransaction } from '../shared/types.ts';
// Import processors to trigger registration
import './processors/index.ts';
import type { BitcoinTransaction } from './types.ts';

/**
 * Bitcoin transaction processor that converts raw blockchain transaction data
 * into UniversalTransaction format. Uses ProcessorFactory to dispatch to provider-specific
 * processors based on data provenance. Optimized for multi-address processing using session context.
 */
export class BitcoinTransactionProcessor extends BaseProcessor<ApiClientRawData<BitcoinTransaction>> {
  constructor(
    _dependencies: IDependencyContainer,
    private context?: { derivedAddresses: string[] }
  ) {
    super('bitcoin');
  }

  /**
   * Extract rich Bitcoin-specific session context from session metadata.
   */
  private createSessionContext(importSession: ProcessingImportSession): ImportSessionMetadata {
    const sessionMetadata = importSession.sessionMetadata || {};

    // Extract derived addresses from Bitcoin-specific metadata
    let derivedAddresses: string[] = [];

    // First, try to get from direct session metadata
    if (sessionMetadata.derivedAddresses?.length) {
      derivedAddresses = sessionMetadata.derivedAddresses;
    }

    // Second, try to extract from bitcoinDerivedAddresses metadata
    if (derivedAddresses.length === 0 && sessionMetadata.bitcoinDerivedAddresses) {
      const bitcoinMetadata = sessionMetadata.bitcoinDerivedAddresses as Record<string, unknown>;
      // Collect all derived addresses from all xpub wallets
      for (const xpubData of Object.values(bitcoinMetadata)) {
        if (xpubData && typeof xpubData === 'object' && xpubData !== null && 'derivedAddresses' in xpubData) {
          const addresses = xpubData.derivedAddresses;
          if (Array.isArray(addresses)) {
            derivedAddresses.push(...addresses.filter((addr): addr is string => typeof addr === 'string'));
          }
        }
      }
    }

    // Fallback to legacy context if available
    if (derivedAddresses.length === 0 && this.context?.derivedAddresses?.length) {
      derivedAddresses = this.context.derivedAddresses;
    }

    // Collect source addresses from raw data items
    const sourceAddresses: string[] = [];
    for (const item of importSession.rawDataItems) {
      const rawData = item.rawData as ApiClientRawData<BitcoinTransaction>;
      if (rawData.sourceAddress && !sourceAddresses.includes(rawData.sourceAddress)) {
        sourceAddresses.push(rawData.sourceAddress);
      }
    }

    return {
      addresses: sourceAddresses,
      derivedAddresses,
      ...sessionMetadata,
    };
  }

  /**
   * Process a single transaction with shared session context.
   */
  private processSingleWithContext(
    rawDataItem: StoredRawData<ApiClientRawData<BitcoinTransaction>>,
    sessionContext: ImportSessionMetadata
  ): Result<UniversalTransaction | null, string> {
    const apiClientRawData = rawDataItem.rawData;
    const { providerId, rawData } = apiClientRawData;

    // Get the appropriate processor for this provider
    const processor = ProcessorFactory.create(providerId);
    if (!processor) {
      return err(`No processor found for provider: ${providerId}`);
    }

    // Transform using the provider-specific processor with shared session context
    const transformResult = processor.transform(rawData, sessionContext);

    if (transformResult.isErr()) {
      return err(`Transform failed for ${providerId}: ${transformResult.error}`);
    }

    const blockchainTransaction = transformResult.value;

    // Determine proper transaction type based on Bitcoin transaction flow
    const transactionType = this.mapTransactionType(blockchainTransaction, sessionContext);

    // Convert UniversalBlockchainTransaction to UniversalTransaction
    const universalTransaction: UniversalTransaction = {
      amount: createMoney(blockchainTransaction.amount, blockchainTransaction.currency),
      datetime: new Date(blockchainTransaction.timestamp).toISOString(),
      fee: blockchainTransaction.feeAmount
        ? createMoney(blockchainTransaction.feeAmount, blockchainTransaction.feeCurrency || 'BTC')
        : createMoney(0, 'BTC'),
      from: blockchainTransaction.from,
      id: blockchainTransaction.id,
      metadata: {
        blockchain: 'bitcoin',
        blockHeight: blockchainTransaction.blockHeight,
        blockId: blockchainTransaction.blockId,
        providerId: blockchainTransaction.providerId,
      },
      source: 'bitcoin',
      status: blockchainTransaction.status === 'success' ? 'ok' : 'failed',
      symbol: blockchainTransaction.currency,
      timestamp: blockchainTransaction.timestamp,
      to: blockchainTransaction.to,
      type: transactionType,
    };

    this.logger.debug(`Successfully processed transaction ${universalTransaction.id} from ${providerId}`);
    return ok(universalTransaction);
  }

  /**
   * Check if this processor can handle the specified source type.
   */
  protected canProcessSpecific(sourceType: string): boolean {
    return sourceType === 'blockchain';
  }

  /**
   * Process import session with optimized multi-address session context.
   */
  async process(importSession: ProcessingImportSession): Promise<UniversalTransaction[]> {
    if (!this.canProcess(importSession.sourceId, importSession.sourceType)) {
      return [];
    }

    // Create rich session context once for the entire batch
    const sessionContext = this.createSessionContext(importSession);

    this.logger.info(
      `Processing Bitcoin session with ${importSession.rawDataItems.length} transactions, ` +
        `${sessionContext.derivedAddresses?.length || 0} derived addresses, ` +
        `${sessionContext.addresses?.length || 0} source addresses`
    );

    const transactions: UniversalTransaction[] = [];

    // Process all transactions with shared session context
    for (const item of importSession.rawDataItems) {
      const typedItem = item as StoredRawData<ApiClientRawData<BitcoinTransaction>>;
      const result = this.processSingleWithContext(typedItem, sessionContext);
      if (result.isErr()) {
        this.logger.warn(`Failed to process transaction ${item.sourceTransactionId}: ${result.error}`);
        continue; // Continue processing other transactions
      }

      const transaction = result.value;
      if (transaction) {
        transactions.push(transaction);
      }
    }

    this.logger.info(`Bitcoin processing completed: ${transactions.length} transactions processed successfully`);
    return transactions;
  }

  /**
   * Legacy method for backward compatibility - delegates to session-based processing.
   */
  protected async processInternal(
    rawDataItems: StoredRawData<ApiClientRawData<BitcoinTransaction>>[],
    sessionMetadata?: ImportSessionMetadata
  ): Promise<Result<UniversalTransaction[], string>> {
    // Create a minimal session for backward compatibility
    const legacySession: ProcessingImportSession = {
      createdAt: Date.now(),
      id: 'legacy-session',
      rawDataItems: rawDataItems as StoredRawData<ApiClientRawData<unknown>>[],
      sessionMetadata: {
        derivedAddresses: this.context?.derivedAddresses || [],
      },
      sourceId: 'bitcoin',
      sourceType: 'blockchain',
      status: 'processing',
    };

    try {
      const transactions = await this.process(legacySession);
      return ok(transactions);
    } catch (error) {
      return err(`Bitcoin processing failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
