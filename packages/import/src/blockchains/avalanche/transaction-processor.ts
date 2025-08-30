import type { UniversalTransaction } from '@crypto/core';
import { getLogger } from '@crypto/shared-logger';
import { createMoney } from '@crypto/shared-utils';
import { Decimal } from 'decimal.js';
import { type Result, err, ok } from 'neverthrow';

import type { IDependencyContainer } from '../../shared/common/interfaces.ts';
import { BaseProcessor } from '../../shared/processors/base-processor.ts';
import type { ApiClientRawData, StoredRawData } from '../../shared/processors/interfaces.ts';
import { ProcessorFactory } from '../../shared/processors/processor-registry.ts';
// Import processors to trigger registration
import './processors/index.ts';
import type { AvalancheRawTransactionData } from './transaction-importer.ts';
import type { AvalancheTransaction } from './types.ts';
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
   * Correlate a group of AvalancheTransactions with the same hash into a single UniversalTransaction
   */
  private correlateTransactionGroup(txGroup: AvalancheTransaction[]): Result<UniversalTransaction, string> {
    if (txGroup.length === 0) {
      return err('Empty transaction group');
    }

    const firstTx = txGroup[0];
    const userAddress = firstTx.from; // Will be refined by classification logic

    // Use updated classification logic that works directly with AvalancheTransaction[]
    const classification = AvalancheUtils.classifyTransactionGroup(txGroup, userAddress);

    // Calculate fee from normal transaction if available
    let fee = createMoney('0', 'AVAX');
    const normalTx = txGroup.find(tx => tx.type === 'normal');
    if (normalTx && normalTx.gasUsed && normalTx.gasPrice) {
      const gasUsed = new Decimal(normalTx.gasUsed);
      const gasPrice = new Decimal(normalTx.gasPrice);
      const feeWei = gasUsed.mul(gasPrice);
      const feeAvax = feeWei.dividedBy(new Decimal(10).pow(18));
      fee = createMoney(feeAvax.toString(), 'AVAX');
    }

    // Determine from/to addresses based on classification
    let fromAddress = '';
    let toAddress = '';

    if (classification.type === 'withdrawal') {
      fromAddress = userAddress;
      if (classification.primarySymbol === 'AVAX') {
        const outgoingInternal = txGroup.find(
          tx => tx.type === 'internal' && tx.from.toLowerCase() === userAddress.toLowerCase() && tx.value !== '0'
        );
        toAddress = outgoingInternal?.to || normalTx?.to || '';
      } else {
        const outgoingToken = txGroup.find(
          tx =>
            tx.type === 'token' &&
            tx.from.toLowerCase() === userAddress.toLowerCase() &&
            tx.symbol === classification.primarySymbol
        );
        toAddress = outgoingToken?.to || '';
      }
    } else if (classification.type === 'deposit') {
      toAddress = userAddress;
      if (classification.primarySymbol === 'AVAX') {
        const incomingInternal = txGroup.find(
          tx => tx.type === 'internal' && tx.to.toLowerCase() === userAddress.toLowerCase() && tx.value !== '0'
        );
        fromAddress = incomingInternal?.from || normalTx?.from || '';
      } else {
        const incomingToken = txGroup.find(
          tx =>
            tx.type === 'token' &&
            tx.to.toLowerCase() === userAddress.toLowerCase() &&
            tx.symbol === classification.primarySymbol
        );
        fromAddress = incomingToken?.from || '';
      }
    } else {
      // Transfer - use normal transaction addresses if available
      if (normalTx) {
        fromAddress = normalTx.from;
        toAddress = normalTx.to;
      }
    }

    return ok({
      amount: createMoney(classification.primaryAmount, classification.primarySymbol),
      datetime: new Date(firstTx.timestamp).toISOString(),
      fee,
      from: fromAddress,
      id: firstTx.hash,
      metadata: {
        blockchain: 'avalanche',
        blockNumber: firstTx.blockNumber,
        classification,
        providerId: 'avalanche-correlation',
        txGroup, // Store the correlated AvalancheTransaction group
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

    // Step 1: Convert raw data to AvalancheTransaction objects using individual processors
    const avalancheTransactions: AvalancheTransaction[] = [];

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

      // TODO: broken during refactor of issue 38
      //avalancheTransactions.push();
    }

    // Step 2: Group AvalancheTransactions by hash for correlation
    const transactionGroups = new Map<string, AvalancheTransaction[]>();

    for (const tx of avalancheTransactions) {
      if (!transactionGroups.has(tx.hash)) {
        transactionGroups.set(tx.hash, []);
      }
      transactionGroups.get(tx.hash)!.push(tx);
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
