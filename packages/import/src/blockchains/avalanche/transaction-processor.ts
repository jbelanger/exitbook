import type { UniversalTransaction } from '@crypto/core';
import { getLogger } from '@crypto/shared-logger';
import { createMoney } from '@crypto/shared-utils';
import { Decimal } from 'decimal.js';
import { type Result, err, ok } from 'neverthrow';

import type { IDependencyContainer } from '../../shared/common/interfaces.ts';
import { BaseProcessor } from '../../shared/processors/base-processor.ts';
import type { ApiClientRawData, StoredRawData } from '../../shared/processors/interfaces.ts';
import { ProcessorFactory } from '../../shared/processors/processor-registry.ts';
import type { UniversalBlockchainTransaction } from '../shared/types.ts';
// Import processors to trigger registration
import './processors/index.ts';
import type { AvalancheRawTransactionData } from './transaction-importer.ts';

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
   * Correlate a group of UniversalBlockchainTransactions with the same hash into a single UniversalTransaction
   */
  private correlateTransactionGroup(txGroup: UniversalBlockchainTransaction[]): Result<UniversalTransaction, string> {
    if (txGroup.length === 0) {
      return err('Empty transaction group');
    }

    const firstTx = txGroup[0];
    const userAddress = firstTx.from; // Will be refined by classification logic

    // Calculate fee from any transaction that has fee information
    let fee = createMoney('0', 'AVAX');
    const txWithFee = txGroup.find(tx => tx.feeAmount);
    if (txWithFee && txWithFee.feeAmount) {
      const feeWei = new Decimal(txWithFee.feeAmount);
      const feeAvax = feeWei.dividedBy(new Decimal(10).pow(18));
      fee = createMoney(feeAvax.toString(), 'AVAX');
    }

    // Simplified correlation logic - use the primary transaction
    // For a full implementation, you'd need to rebuild the correlation logic
    // to work with UniversalBlockchainTransaction instead of AvalancheTransaction
    const primaryTx = txGroup.find(tx => tx.type === 'transfer' || tx.type === 'contract_call') || firstTx;
    const amount = new Decimal(primaryTx.amount);
    const amountInEther = amount.dividedBy(new Decimal(10).pow(18));

    return ok({
      amount: createMoney(amountInEther.toString(), primaryTx.currency),
      datetime: new Date(firstTx.timestamp).toISOString(),
      fee,
      from: primaryTx.from,
      id: firstTx.id,
      metadata: {
        blockchain: 'avalanche',
        blockNumber: firstTx.blockHeight,
        correlatedTxCount: txGroup.length,
        providerId: firstTx.providerId, // Preserve original provider ID
      },
      source: 'avalanche',
      status: 'ok',
      symbol: primaryTx.currency,
      timestamp: firstTx.timestamp,
      to: primaryTx.to,
      type: primaryTx.type === 'token_transfer' ? 'transfer' : (primaryTx.type as UniversalTransaction['type']),
    });
  }

  /**
   * Check if this processor can handle the specified source type.
   */
  protected canProcessSpecific(sourceType: string): boolean {
    return sourceType === 'blockchain';
  }

  /**
   * Implement the template method with integrated correlation logic
   */
  protected async processInternal(
    rawDataItems: StoredRawData<ApiClientRawData<AvalancheRawTransactionData>>[]
  ): Promise<Result<UniversalTransaction[], string>> {
    if (rawDataItems.length === 0) {
      return ok([]);
    }

    this.correlationLogger.info(`Processing ${rawDataItems.length} Avalanche transactions with integrated correlation`);

    // Step 1: Convert raw data to UniversalBlockchainTransaction objects using individual processors
    const universalTransactions: UniversalBlockchainTransaction[] = [];

    for (const rawDataItem of rawDataItems) {
      const apiClientRawData = rawDataItem.rawData;
      const sourceAddress = apiClientRawData.sourceAddress;

      if (!sourceAddress) {
        this.correlationLogger.warn('Skipping transaction without source address');
        continue;
      }

      // Get the appropriate processor for this provider
      const processor = ProcessorFactory.create(apiClientRawData.providerId);
      if (!processor) {
        return err(`No processor found for provider: ${apiClientRawData.providerId}`);
      }

      const sessionContext = { addresses: [sourceAddress] };
      const transformResult = processor.transform(apiClientRawData.rawData, sessionContext);

      if (transformResult.isErr()) {
        this.correlationLogger.error(`Failed to transform transaction: ${transformResult.error}`);
        continue;
      }

      universalTransactions.push(transformResult.value);
    }

    // Step 2: Group UniversalBlockchainTransactions by id (hash) for correlation
    const transactionGroups = new Map<string, UniversalBlockchainTransaction[]>();

    for (const tx of universalTransactions) {
      if (!transactionGroups.has(tx.id)) {
        transactionGroups.set(tx.id, []);
      }
      transactionGroups.get(tx.id)!.push(tx);
    }

    this.correlationLogger.debug(`Created ${transactionGroups.size} correlation groups`);

    // Step 3: Apply correlation logic and convert to UniversalTransaction
    const allTransactions: UniversalTransaction[] = [];

    for (const [hash, txGroup] of transactionGroups) {
      const correlationResult = this.correlateTransactionGroup(txGroup);
      if (correlationResult.isErr()) {
        this.correlationLogger.error(`Failed to correlate group ${hash}: ${correlationResult.error}`);
        continue;
      }

      allTransactions.push(correlationResult.value);
    }

    this.correlationLogger.info(
      `Correlation processing complete: ${rawDataItems.length} raw transactions → ${allTransactions.length} correlated transactions`
    );
    return ok(allTransactions);
  }
}
