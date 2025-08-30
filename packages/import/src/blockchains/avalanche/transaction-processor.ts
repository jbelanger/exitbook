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
   * Correlate a group of UniversalBlockchainTransactions with the same hash into a single UniversalTransaction
   */
  private correlateTransactionGroup(
    txGroup: UniversalBlockchainTransaction[],
    userAddress: string
  ): Result<UniversalTransaction, string> {
    if (txGroup.length === 0) {
      return err('Empty transaction group');
    }

    const firstTx = txGroup[0];

    // Use the sophisticated correlation system to classify the transaction group
    const classification = AvalancheUtils.classifyTransactionGroup(txGroup, userAddress);

    // Calculate fee from any transaction that has fee information
    let fee = createMoney('0', 'AVAX');
    const txWithFee = txGroup.find(tx => tx.feeAmount);
    if (txWithFee && txWithFee.feeAmount) {
      const feeWei = new Decimal(txWithFee.feeAmount);
      const feeAvax = feeWei.dividedBy(new Decimal(10).pow(18));
      fee = createMoney(feeAvax.toString(), 'AVAX');
    }

    // Determine from/to addresses based on transaction type and primary asset
    let fromAddress = '';
    let toAddress = '';

    if (classification.type === 'withdrawal') {
      fromAddress = userAddress;
      // Find the destination address from the primary asset flow
      if (classification.primarySymbol === 'AVAX') {
        // Look in internal transactions or transfer transactions
        const outgoingInternal = txGroup.find(
          tx => tx.type === 'internal' && tx.from.toLowerCase() === userAddress.toLowerCase() && tx.amount !== '0'
        );
        const outgoingTransfer = txGroup.find(
          tx => tx.type === 'transfer' && tx.from.toLowerCase() === userAddress.toLowerCase() && tx.amount !== '0'
        );
        toAddress = outgoingInternal?.to || outgoingTransfer?.to || '';
      } else {
        // Look in token transfers
        const outgoingToken = txGroup.find(
          tx =>
            tx.type === 'token_transfer' &&
            tx.from.toLowerCase() === userAddress.toLowerCase() &&
            tx.tokenSymbol === classification.primarySymbol
        );
        toAddress = outgoingToken?.to || '';
      }
    } else if (classification.type === 'deposit') {
      toAddress = userAddress;
      // Find the source address from the primary asset flow
      if (classification.primarySymbol === 'AVAX') {
        // Look in internal transactions or transfer transactions
        const incomingInternal = txGroup.find(
          tx => tx.type === 'internal' && tx.to.toLowerCase() === userAddress.toLowerCase() && tx.amount !== '0'
        );
        const incomingTransfer = txGroup.find(
          tx => tx.type === 'transfer' && tx.to.toLowerCase() === userAddress.toLowerCase() && tx.amount !== '0'
        );
        fromAddress = incomingInternal?.from || incomingTransfer?.from || '';
      } else {
        // Look in token transfers
        const incomingToken = txGroup.find(
          tx =>
            tx.type === 'token_transfer' &&
            tx.to.toLowerCase() === userAddress.toLowerCase() &&
            tx.tokenSymbol === classification.primarySymbol
        );
        fromAddress = incomingToken?.from || '';
      }
    } else {
      // Transfer - use primary transaction addresses if available
      const primaryTx = txGroup.find(tx => tx.type === 'transfer') || firstTx;
      fromAddress = primaryTx.from;
      toAddress = primaryTx.to;
    }

    return ok({
      amount: createMoney(classification.primaryAmount, classification.primarySymbol),
      datetime: new Date(firstTx.timestamp).toISOString(),
      fee,
      from: fromAddress,
      id: firstTx.id,
      metadata: {
        blockchain: 'avalanche',
        blockNumber: firstTx.blockHeight,
        classification,
        correlatedTxCount: txGroup.length,
        providerId: firstTx.providerId, // Preserve original provider ID
      },
      source: 'avalanche',
      status: 'ok',
      symbol: classification.primarySymbol,
      timestamp: firstTx.timestamp,
      to: toAddress,
      type: classification.type,
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
    // Also track user address for each group
    const transactionGroups = new Map<string, { txGroup: UniversalBlockchainTransaction[]; userAddress: string }>();

    for (const tx of universalTransactions) {
      if (!transactionGroups.has(tx.id)) {
        // Find the user address from the raw data - use the first available source address
        const userAddress =
          rawDataItems.find(item => item.rawData.rawData && universalTransactions.some(utx => utx.id === tx.id))
            ?.rawData.sourceAddress || '';

        transactionGroups.set(tx.id, { txGroup: [], userAddress });
      }
      transactionGroups.get(tx.id)!.txGroup.push(tx);
    }

    this.correlationLogger.debug(`Created ${transactionGroups.size} correlation groups`);

    // Step 3: Apply correlation logic and convert to UniversalTransaction
    const allTransactions: UniversalTransaction[] = [];

    for (const [hash, { txGroup, userAddress }] of transactionGroups) {
      if (!userAddress) {
        this.correlationLogger.warn(`Skipping group ${hash} - no user address found`);
        continue;
      }

      const correlationResult = this.correlateTransactionGroup(txGroup, userAddress);
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
