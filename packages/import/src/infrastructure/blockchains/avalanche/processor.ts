import type { UniversalTransaction } from '@crypto/core';
import type { StoredRawData } from '@crypto/data';
import { getLogger } from '@crypto/shared-logger';
import { createMoney } from '@crypto/shared-utils';
import { Decimal } from 'decimal.js';
import { type Result, err, ok } from 'neverthrow';

import type { ImportSessionMetadata } from '../../../app/ports/processors.ts';
import type { UniversalBlockchainTransaction } from '../../../app/ports/raw-data-mappers.ts';
import type { ITransactionRepository } from '../../../app/ports/transaction-repository.ts';

// Import processors to trigger registration
import './register-mappers.ts';
import { BaseProcessor } from '../../shared/processors/base-processor.ts';
import { TransactionMapperFactory } from '../../shared/processors/processor-registry.ts';

import type { AvalancheTransaction, AvalancheFundFlow } from './types.ts';
import { AvalancheUtils } from './utils.ts';

/**
 * Avalanche transaction processor that converts raw blockchain transaction data
 * into UniversalTransaction format using correlation system for smart classification.
 */
export class AvalancheTransactionProcessor extends BaseProcessor {
  private correlationLogger = getLogger('AvalancheCorrelation');

  constructor(private readonly transactionRepository?: ITransactionRepository) {
    super('avalanche');
    // transactionRepository will be used for historical context analysis in future enhancements
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
  protected processInternal(
    rawDataItems: StoredRawData[],
    sessionMetadata?: ImportSessionMetadata
  ): Promise<Result<UniversalTransaction[], string>> {
    if (rawDataItems.length === 0) {
      return Promise.resolve(ok([]));
    }

    this.correlationLogger.info(`Processing ${rawDataItems.length} Avalanche transactions with integrated correlation`);

    // Step 1: Convert raw data to UniversalBlockchainTransaction objects using individual processors
    const universalTransactions: UniversalBlockchainTransaction[] = [];

    for (const rawDataItem of rawDataItems) {
      const sourceAddress = sessionMetadata?.address;

      if (!sourceAddress) {
        this.correlationLogger.warn('Skipping transaction without source address');
        continue;
      }

      // Get the appropriate processor for this provider
      const processor = TransactionMapperFactory.create(rawDataItem.metadata.providerId);
      if (!processor) {
        return Promise.resolve(err(`No processor found for provider: ${rawDataItem.metadata.providerId}`));
      }

      const transformResult = processor.map(rawDataItem.rawData, sessionMetadata) as Result<
        UniversalBlockchainTransaction,
        string
      >;

      if (transformResult.isErr()) {
        this.correlationLogger.error(`Failed to transform transaction: ${transformResult.error}`);
        continue;
      }

      const blockchainTransactions = transformResult.value;
      if (!blockchainTransactions) {
        this.correlationLogger.warn(`No transactions returned from ${rawDataItem.metadata.providerId} processor`);
        continue;
      }

      // Avalanche processors return array with single transaction
      const firstTransaction = blockchainTransactions;
      if (firstTransaction) {
        universalTransactions.push(firstTransaction);
      }
    }

    // Step 2: Group UniversalBlockchainTransactions by id (hash) for correlation
    // Also track user address for each group
    const transactionGroups = new Map<string, { txGroup: UniversalBlockchainTransaction[]; userAddress: string }>();

    for (const tx of universalTransactions) {
      if (!transactionGroups.has(tx.id)) {
        // Find the user address from the raw data - use the first available source address
        const userAddress =
          rawDataItems.find((item) => item.rawData && universalTransactions.some((utx) => utx.id === tx.id))?.metadata
            .sourceAddress || '';

        transactionGroups.set(tx.id, { txGroup: [], userAddress });
      }
      const group = transactionGroups.get(tx.id);
      if (group) {
        group.txGroup.push(tx);
      }
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
    return Promise.resolve(ok(allTransactions));
  }

  /**
   * Process normalized Avalanche transactions with enhanced fund flow analysis.
   * Handles AvalancheTransaction objects with structured data.
   */
  protected async processNormalizedInternal(
    normalizedData: unknown[],
    sessionMetadata?: ImportSessionMetadata
  ): Promise<Result<UniversalTransaction[], string>> {
    if (!sessionMetadata) {
      return err('Missing session metadata for normalized processing');
    }

    this.logger.info(`Processing ${normalizedData.length} normalized Avalanche transactions`);

    const transactions: UniversalTransaction[] = [];

    // Group transactions by hash for correlation
    const transactionGroups = new Map<string, AvalancheTransaction[]>();

    for (const item of normalizedData) {
      const normalizedTx = item as AvalancheTransaction;

      if (!transactionGroups.has(normalizedTx.id)) {
        transactionGroups.set(normalizedTx.id, []);
      }
      transactionGroups.get(normalizedTx.id)!.push(normalizedTx);
    }

    this.logger.debug(`Created ${transactionGroups.size} transaction groups for correlation`);

    // Process each group
    for (const [hash, txGroup] of transactionGroups) {
      try {
        // Perform enhanced fund flow analysis with structured data
        const fundFlowResult = await Promise.resolve(this.analyzeFundFlowFromNormalized(txGroup, sessionMetadata));

        if (fundFlowResult.isErr()) {
          this.logger.warn(`Fund flow analysis failed for ${hash}: ${fundFlowResult.error}`);
          continue;
        }

        const fundFlow = fundFlowResult.value;

        // Determine transaction type based on fund flow
        const transactionType = this.determineTransactionTypeFromFundFlow(fundFlow, sessionMetadata);

        // Use the first transaction for core data
        const firstTx = txGroup[0];
        if (!firstTx) continue;

        // Calculate total fee from any transaction with fee data
        let totalFee = createMoney('0', 'AVAX');
        const txWithFee = txGroup.find((tx) => tx.feeAmount);
        if (txWithFee && txWithFee.feeAmount) {
          const feeWei = new Decimal(txWithFee.feeAmount);
          const feeAvax = feeWei.dividedBy(new Decimal(10).pow(18));
          totalFee = createMoney(feeAvax.toString(), 'AVAX');
        }

        // Convert to UniversalTransaction
        const universalTransaction: UniversalTransaction = {
          amount: createMoney(fundFlow.primaryAmount, fundFlow.primarySymbol),
          datetime: new Date(firstTx.timestamp).toISOString(),
          fee: totalFee,
          from: fundFlow.fromAddress || '',
          id: firstTx.id,
          metadata: {
            blockchain: 'avalanche',
            blockHeight: firstTx.blockHeight,
            blockId: firstTx.blockId,
            correlatedTxCount: txGroup.length,
            fundFlow: {
              currency: fundFlow.currency,
              feeAmount: fundFlow.feeAmount,
              hasContractInteraction: fundFlow.hasContractInteraction,
              hasInternalTransactions: fundFlow.hasInternalTransactions,
              hasTokenTransfers: fundFlow.hasTokenTransfers,
              isIncoming: fundFlow.isIncoming,
              isOutgoing: fundFlow.isOutgoing,
              primaryAmount: fundFlow.primaryAmount,
              primarySymbol: fundFlow.primarySymbol,
              transactionCount: fundFlow.transactionCount,
            },
            providerId: firstTx.providerId,
          },
          source: 'avalanche',
          status: firstTx.status === 'success' ? 'ok' : 'failed',
          symbol: fundFlow.primarySymbol,
          timestamp: firstTx.timestamp,
          to: fundFlow.toAddress || '',
          type: transactionType,
        };

        transactions.push(universalTransaction);
        this.logger.debug(`Successfully processed normalized transaction group ${universalTransaction.id}`);
      } catch (error) {
        this.logger.error(`Failed to process normalized transaction group ${hash}: ${String(error)}`);
        continue;
      }
    }

    this.logger.info(`Normalized processing completed: ${transactions.length} transactions processed successfully`);
    return ok(transactions);
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
    if (!firstTx) {
      return err('First transaction is undefined');
    }

    // Use the sophisticated correlation system to classify the transaction group
    const classification = AvalancheUtils.classifyTransactionGroup(txGroup, userAddress);

    // Calculate fee from any transaction that has fee information
    let fee = createMoney('0', 'AVAX');
    const txWithFee = txGroup.find((tx) => tx.feeAmount);
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
          (tx) => tx.type === 'internal' && tx.from.toLowerCase() === userAddress.toLowerCase() && tx.amount !== '0'
        );
        const outgoingTransfer = txGroup.find(
          (tx) => tx.type === 'transfer' && tx.from.toLowerCase() === userAddress.toLowerCase() && tx.amount !== '0'
        );
        toAddress = outgoingInternal?.to || outgoingTransfer?.to || '';
      } else {
        // Look in token transfers
        const outgoingToken = txGroup.find(
          (tx) =>
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
          (tx) => tx.type === 'internal' && tx.to.toLowerCase() === userAddress.toLowerCase() && tx.amount !== '0'
        );
        const incomingTransfer = txGroup.find(
          (tx) => tx.type === 'transfer' && tx.to.toLowerCase() === userAddress.toLowerCase() && tx.amount !== '0'
        );
        fromAddress = incomingInternal?.from || incomingTransfer?.from || '';
      } else {
        // Look in token transfers
        const incomingToken = txGroup.find(
          (tx) =>
            tx.type === 'token_transfer' &&
            tx.to.toLowerCase() === userAddress.toLowerCase() &&
            tx.tokenSymbol === classification.primarySymbol
        );
        fromAddress = incomingToken?.from || '';
      }
    } else {
      // Transfer - use primary transaction addresses if available
      const primaryTx = txGroup.find((tx) => tx.type === 'transfer') || firstTx;
      if (primaryTx) {
        fromAddress = primaryTx.from;
        toAddress = primaryTx.to;
      }
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
   * Analyze fund flow from normalized Avalanche transaction group with structured data.
   */
  private analyzeFundFlowFromNormalized(
    txGroup: AvalancheTransaction[],
    sessionMetadata: ImportSessionMetadata
  ): Result<AvalancheFundFlow, string> {
    if (txGroup.length === 0) {
      return err('Empty transaction group');
    }

    const userAddress = sessionMetadata.address?.toLowerCase();
    if (!userAddress) {
      return err('Missing user address in session metadata');
    }

    // Analyze transaction types
    const hasTokenTransfers = txGroup.some((tx) => tx.type === 'token_transfer');
    const hasInternalTransactions = txGroup.some((tx) => tx.type === 'internal');
    const hasContractInteraction = txGroup.some((tx) => tx.type === 'contract_call');

    // Find primary currency and amount
    let primarySymbol = 'AVAX';
    let primaryAmount = '0';
    let currency = 'AVAX';

    // Determine primary asset and amount based on user interaction
    let isIncoming = false;
    let isOutgoing = false;
    let fromAddress: string | undefined;
    let toAddress: string | undefined;

    // Check for token transfers first (they usually represent the main value transfer)
    const userTokenTransfer = txGroup.find(
      (tx) =>
        tx.type === 'token_transfer' && (tx.from.toLowerCase() === userAddress || tx.to.toLowerCase() === userAddress)
    );

    if (userTokenTransfer) {
      primarySymbol = userTokenTransfer.tokenSymbol || userTokenTransfer.currency;
      currency = primarySymbol;

      if (userTokenTransfer.to.toLowerCase() === userAddress) {
        isIncoming = true;
        primaryAmount = userTokenTransfer.amount;
        fromAddress = userTokenTransfer.from;
        toAddress = userAddress;
      } else if (userTokenTransfer.from.toLowerCase() === userAddress) {
        isOutgoing = true;
        primaryAmount = userTokenTransfer.amount;
        fromAddress = userAddress;
        toAddress = userTokenTransfer.to;
      }
    } else {
      // Check AVAX transfers (regular or internal)
      const userAvaxTransfer = txGroup.find(
        (tx) =>
          (tx.type === 'transfer' || tx.type === 'internal') &&
          tx.currency === 'AVAX' &&
          tx.amount !== '0' &&
          (tx.from.toLowerCase() === userAddress || tx.to.toLowerCase() === userAddress)
      );

      if (userAvaxTransfer) {
        primarySymbol = 'AVAX';
        currency = 'AVAX';

        if (userAvaxTransfer.to.toLowerCase() === userAddress) {
          isIncoming = true;
          primaryAmount = new Decimal(userAvaxTransfer.amount).dividedBy(new Decimal(10).pow(18)).toString();
          fromAddress = userAvaxTransfer.from;
          toAddress = userAddress;
        } else if (userAvaxTransfer.from.toLowerCase() === userAddress) {
          isOutgoing = true;
          primaryAmount = new Decimal(userAvaxTransfer.amount).dividedBy(new Decimal(10).pow(18)).toString();
          fromAddress = userAddress;
          toAddress = userAvaxTransfer.to;
        }
      }
    }

    // Calculate total fee
    let totalFeeWei = new Decimal(0);
    for (const tx of txGroup) {
      if (tx.feeAmount) {
        totalFeeWei = totalFeeWei.plus(new Decimal(tx.feeAmount));
      }
    }
    const feeAmount = totalFeeWei.dividedBy(new Decimal(10).pow(18)).toString();

    return ok({
      currency,
      feeAmount,
      feeCurrency: 'AVAX',
      fromAddress,
      hasContractInteraction,
      hasInternalTransactions,
      hasTokenTransfers,
      isIncoming,
      isOutgoing,
      primaryAmount,
      primarySymbol,
      toAddress,
      transactionCount: txGroup.length,
    });
  }

  /**
   * Determine transaction type from fund flow analysis with historical context.
   */
  private determineTransactionTypeFromFundFlow(
    fundFlow: AvalancheFundFlow,
    _sessionMetadata: ImportSessionMetadata
  ): 'deposit' | 'withdrawal' | 'transfer' | 'fee' {
    const { isIncoming, isOutgoing, primaryAmount } = fundFlow;

    // Check if this is a fee-only transaction
    const amount = parseFloat(primaryAmount);
    if (amount === 0 || amount < 0.00001) {
      return 'fee';
    }

    // Determine transaction type based on fund flow direction
    if (isIncoming && !isOutgoing) {
      return 'deposit';
    } else if (!isIncoming && isOutgoing) {
      return 'withdrawal';
    } else if (isIncoming && isOutgoing) {
      // Both directions - likely internal transfer or self-send
      return 'transfer';
    } else {
      // Neither direction - contract interaction or fee transaction
      return fundFlow.hasContractInteraction ? 'transfer' : 'fee';
    }
  }
}
