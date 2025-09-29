import type { UniversalTransaction } from '@exitbook/core';
import type { ImportSessionMetadata } from '@exitbook/import/app/ports/processors.js';
import type { ITransactionRepository } from '@exitbook/import/app/ports/transaction-repository.js';
import { getLogger } from '@exitbook/shared-logger';
import { createMoney } from '@exitbook/shared-utils';
import { Decimal } from 'decimal.js';
import { type Result, err, ok } from 'neverthrow';

import { BaseProcessor } from '../../shared/processors/base-processor.js';

import type { AvalancheTransaction, AvalancheFundFlow } from './types.js';

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
      fromAddress: fromAddress ?? '',
      hasContractInteraction,
      hasInternalTransactions,
      hasTokenTransfers,
      isIncoming,
      isOutgoing,
      primaryAmount,
      primarySymbol,
      toAddress: toAddress ?? '',
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
