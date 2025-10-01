import type { ImportSessionMetadata } from '@exitbook/import/app/ports/transaction-processor.interface.ts';
import type { ITransactionRepository } from '@exitbook/import/app/ports/transaction-repository.js';
import type { UniversalTransaction } from '@exitbook/import/domain/universal-transaction.ts';
import { createMoney } from '@exitbook/shared-utils';
import { Decimal } from 'decimal.js';
import { err, ok, type Result } from 'neverthrow';

import { BaseTransactionProcessor } from '../../shared/processors/base-transaction-processor.ts';

import type { EvmChainConfig } from './chain-config.interface.js';
import type { EvmFundFlow, EvmTransaction } from './types.js';

/**
 * Unified EVM transaction processor that applies Avalanche-style transaction correlation
 * to every EVM-compatible chain.
 */
export class EvmTransactionProcessor extends BaseTransactionProcessor {
  /** Minimum amount threshold below which transactions are classified as 'fee' type */
  private static readonly DUST_THRESHOLD = '0.00001';

  constructor(
    private readonly chainConfig: EvmChainConfig,
    private readonly _transactionRepository?: ITransactionRepository
  ) {
    super(chainConfig.chainName);
  }

  protected async processInternal(
    normalizedData: unknown[],
    sessionMetadata?: ImportSessionMetadata
  ): Promise<Result<UniversalTransaction[], string>> {
    if (!sessionMetadata) {
      return err('Missing session metadata for normalized processing');
    }

    const userAddress = sessionMetadata.address;
    if (!userAddress) {
      return err('Missing user address in session metadata');
    }

    this.logger.info(`Processing ${normalizedData.length} normalized ${this.chainConfig.chainName} transactions`);

    const transactionGroups = this.groupTransactionsByHash(normalizedData as EvmTransaction[]);

    this.logger.debug(
      `Created ${transactionGroups.size} transaction groups for correlation on ${this.chainConfig.chainName}`
    );

    const transactions: UniversalTransaction[] = [];
    const processingErrors: { error: string; hash: string; txCount: number }[] = [];

    for (const [hash, txGroup] of transactionGroups) {
      const fundFlowResult = this.analyzeFundFlowFromNormalized(txGroup, sessionMetadata);

      if (fundFlowResult.isErr()) {
        const errorMsg = `Fund flow analysis failed: ${fundFlowResult.error}`;
        processingErrors.push({ error: errorMsg, hash, txCount: txGroup.length });
        this.logger.error(
          `${errorMsg} for ${this.chainConfig.chainName} transaction ${hash} (${txGroup.length} correlated items) - THIS TRANSACTION GROUP WILL BE LOST`
        );
        continue;
      }

      const fundFlow = fundFlowResult.value;

      // Determine transaction type based on fund flow analysis
      const transactionType = this.determineTransactionTypeFromFundFlow(fundFlow);

      const primaryTx = this.selectPrimaryTransaction(txGroup, fundFlow);
      if (!primaryTx) {
        const errorMsg = 'No primary transaction found for correlated group';
        processingErrors.push({ error: errorMsg, hash, txCount: txGroup.length });
        this.logger.error(
          `${errorMsg} ${hash} (${txGroup.length} items) - THIS TRANSACTION GROUP WILL BE LOST. Group types: ${txGroup.map((t) => t.type).join(', ')}`
        );
        continue;
      }

      const universalTransaction: UniversalTransaction = {
        amount: createMoney(fundFlow.primaryAmount, fundFlow.primarySymbol),
        datetime: new Date(primaryTx.timestamp).toISOString(),
        fee: createMoney(fundFlow.feeAmount, fundFlow.feeCurrency),
        from: fundFlow.fromAddress || primaryTx.from,
        id: primaryTx.id,
        metadata: {
          blockchain: this.chainConfig.chainName,
          blockHeight: primaryTx.blockHeight,
          blockId: primaryTx.blockId,
          chainId: this.chainConfig.chainId,
          correlatedTxCount: fundFlow.transactionCount,
          fundFlow: {
            currency: fundFlow.primarySymbol,
            feeAmount: fundFlow.feeAmount,
            feeCurrency: fundFlow.feeCurrency,
            fromAddress: fundFlow.fromAddress,
            hasContractInteraction: fundFlow.hasContractInteraction,
            hasInternalTransactions: fundFlow.hasInternalTransactions,
            hasTokenTransfers: fundFlow.hasTokenTransfers,
            isIncoming: fundFlow.isIncoming,
            isOutgoing: fundFlow.isOutgoing,
            primaryAmount: fundFlow.primaryAmount,
            primarySymbol: fundFlow.primarySymbol,
            toAddress: fundFlow.toAddress,
            tokenAddress: fundFlow.tokenAddress,
            tokenDecimals: fundFlow.tokenDecimals,
            transactionCount: fundFlow.transactionCount,
          },
          nativeCurrency: this.chainConfig.nativeCurrency,
          providerId: primaryTx.providerId,
          tokenAddress: fundFlow.tokenAddress,
          tokenDecimals: fundFlow.tokenDecimals,
          tokenSymbol: primaryTx.tokenSymbol,
          tokenType: primaryTx.tokenType,
        },
        source: this.chainConfig.chainName,
        status: primaryTx.status === 'success' ? 'ok' : 'failed',
        symbol: fundFlow.primarySymbol,
        timestamp: primaryTx.timestamp,
        to: fundFlow.toAddress || primaryTx.to,
        type: transactionType,
      };

      transactions.push(universalTransaction);
      this.logger.debug(
        `Successfully processed correlated transaction group ${universalTransaction.id} (${fundFlow.transactionCount} items)`
      );
    }

    // Log processing summary
    const totalInputTransactions = normalizedData.length;
    const successfulGroups = transactions.length;
    const failedGroups = processingErrors.length;
    const lostTransactionCount = processingErrors.reduce((sum, e) => sum + e.txCount, 0);

    this.logger.info(
      `Processing completed for ${this.chainConfig.chainName}: ${successfulGroups} groups processed, ${failedGroups} groups failed (${lostTransactionCount}/${totalInputTransactions} transactions lost)`
    );

    // STRICT MODE: Fail if ANY transaction groups could not be processed
    // This is critical for portfolio accuracy - we cannot afford to silently drop transactions
    if (processingErrors.length > 0) {
      this.logger.error(
        `CRITICAL PROCESSING FAILURE for ${this.chainConfig.chainName}:\n${processingErrors
          .map((e, i) => `  ${i + 1}. [${e.hash.substring(0, 10)}...] ${e.error} (${e.txCount} items)`)
          .join('\n')}`
      );

      return err(
        `Cannot proceed: ${failedGroups}/${transactionGroups.size} transaction groups failed to process. ` +
          `Lost ${lostTransactionCount} transactions which would corrupt portfolio calculations. ` +
          `Errors: ${processingErrors.map((e) => `[${e.hash.substring(0, 10)}...]: ${e.error}`).join('; ')}`
      );
    }

    return Promise.resolve(ok(transactions));
  }

  private groupTransactionsByHash(transactions: EvmTransaction[]): Map<string, EvmTransaction[]> {
    const groups = new Map<string, EvmTransaction[]>();

    for (const tx of transactions) {
      if (!tx?.id) {
        this.logger.warn('Encountered transaction without id during grouping');
        continue;
      }

      if (!groups.has(tx.id)) {
        groups.set(tx.id, []);
      }

      groups.get(tx.id)!.push(tx);
    }

    return groups;
  }

  private analyzeFundFlowFromNormalized(
    txGroup: EvmTransaction[],
    sessionMetadata: ImportSessionMetadata
  ): Result<EvmFundFlow, string> {
    if (txGroup.length === 0) {
      return err('Empty transaction group');
    }

    const userAddress = sessionMetadata.address?.toLowerCase();
    if (!userAddress) {
      return err('Missing user address in session metadata');
    }

    // Analyze transaction group complexity - essential for proper EVM classification
    const hasTokenTransfers = txGroup.some((tx) => tx.type === 'token_transfer');
    const hasInternalTransactions = txGroup.some((tx) => tx.type === 'internal');
    const hasContractInteraction = txGroup.some(
      (tx) =>
        tx.type === 'contract_call' ||
        Boolean(tx.methodId) || // Has function selector (0x12345678)
        Boolean(tx.functionName) // Function name decoded by provider
    );

    let fromAddress = '';
    let toAddress = '';
    let isIncoming = false;
    let isOutgoing = false;
    let primaryAmount = '0';
    let primarySymbol = this.chainConfig.nativeCurrency;
    let tokenAddress: string | undefined;
    let tokenDecimals: number | undefined;

    // Prefer token transfers as the primary fund flow when present (most DeFi interactions)
    const tokenTransfer = txGroup.find((tx) =>
      tx.type === 'token_transfer' ? this.isUserParticipant(tx, userAddress) : false
    );

    if (tokenTransfer) {
      primarySymbol = tokenTransfer.tokenSymbol || tokenTransfer.currency || primarySymbol;
      tokenAddress = tokenTransfer.tokenAddress;
      tokenDecimals = tokenTransfer.tokenDecimals;

      // Token amounts arrive pre-normalized from mappers (already in token units, not wei)
      // Example: USDC with 6 decimals comes as '2500000' meaning 2.5 USDC
      primaryAmount = tokenTransfer.amount ?? '0';

      const fromMatches = this.matchesAddress(tokenTransfer.from, userAddress);
      const toMatches = this.matchesAddress(tokenTransfer.to, userAddress);

      if (fromMatches) {
        isOutgoing = true;
        fromAddress = tokenTransfer.from;
      }
      if (toMatches) {
        isIncoming = true;
        toAddress = tokenTransfer.to;
      }

      if (!fromAddress) {
        fromAddress = tokenTransfer.from;
      }
      if (!toAddress) {
        toAddress = tokenTransfer.to;
      }
    } else {
      // Fallback to native currency transfers/internal movements
      // Note: Native amounts come in wei and must be normalized by the processor.
      // Token amounts arrive pre-normalized from mappers (handled above).

      // Find first non-zero native transfer involving the user
      const nativeTransfer = txGroup.find((tx) => {
        if (!this.isNativeMovement(tx) || !this.isUserParticipant(tx, userAddress)) {
          return false;
        }
        const normalizedAmount = this.normalizeNativeAmount(tx.amount);
        return !this.isZero(normalizedAmount);
      });

      if (nativeTransfer) {
        const normalizedAmount = this.normalizeNativeAmount(nativeTransfer.amount);
        primarySymbol = this.chainConfig.nativeCurrency;
        primaryAmount = normalizedAmount;

        const fromMatches = this.matchesAddress(nativeTransfer.from, userAddress);
        const toMatches = this.matchesAddress(nativeTransfer.to, userAddress);

        if (fromMatches) {
          isOutgoing = true;
          fromAddress = nativeTransfer.from;
        }
        if (toMatches) {
          isIncoming = true;
          toAddress = nativeTransfer.to;
        }

        if (!fromAddress) {
          fromAddress = nativeTransfer.from;
        }
        if (!toAddress) {
          toAddress = nativeTransfer.to;
        }
      }
    }

    // Final fallback: use first transaction to populate addresses
    const primaryTx = txGroup[0];
    if (primaryTx) {
      if (!fromAddress) {
        fromAddress = primaryTx.from;
      }
      if (!toAddress) {
        toAddress = primaryTx.to;
      }
    }

    // Calculate total fee across all correlated transactions in the group
    // Note: In practice, only the main transaction pays gas fees, but we sum defensively
    // in case providers report fees differently across internal/token transactions
    const totalFeeWei = txGroup.reduce((acc, tx) => {
      if (!tx.feeAmount) {
        return acc;
      }

      try {
        return acc.plus(new Decimal(tx.feeAmount));
      } catch (error) {
        this.logger.warn(`Unable to parse fee amount for transaction ${tx.id}: ${String(error)}`);
        return acc;
      }
    }, new Decimal(0));

    const feeAmount = totalFeeWei.dividedBy(new Decimal(10).pow(this.chainConfig.nativeDecimals)).toString();

    return ok({
      feeAmount,
      feeCurrency: this.chainConfig.nativeCurrency,
      fromAddress,
      hasContractInteraction,
      hasInternalTransactions,
      hasTokenTransfers,
      isIncoming,
      isOutgoing,
      primaryAmount,
      primarySymbol,
      toAddress,
      tokenAddress,
      tokenDecimals,
      transactionCount: txGroup.length,
    });
  }

  private determineTransactionTypeFromFundFlow(fundFlow: EvmFundFlow): 'deposit' | 'withdrawal' | 'transfer' | 'fee' {
    const amount = new Decimal(fundFlow.primaryAmount || '0').abs();
    const isDustOrZero = amount.isZero() || amount.lessThan(EvmTransactionProcessor.DUST_THRESHOLD);

    // Check fund flow direction first for non-dust amounts
    if (!isDustOrZero) {
      if (fundFlow.isIncoming && !fundFlow.isOutgoing) {
        return 'deposit';
      }

      if (!fundFlow.isIncoming && fundFlow.isOutgoing) {
        return 'withdrawal';
      }

      if (fundFlow.isIncoming && fundFlow.isOutgoing) {
        return 'transfer';
      }
    }

    // For dust/zero amounts or no clear direction, check if it's a meaningful interaction
    // Contract interactions (approvals, etc.) are classified as 'transfer', not 'fee'
    if (fundFlow.hasContractInteraction || fundFlow.hasTokenTransfers) {
      return 'transfer';
    }

    return 'fee';
  }

  private selectPrimaryTransaction(txGroup: EvmTransaction[], fundFlow: EvmFundFlow): EvmTransaction | undefined {
    if (fundFlow.hasTokenTransfers) {
      const tokenTx = txGroup.find((tx) => tx.type === 'token_transfer');
      if (tokenTx) {
        return tokenTx;
      }
    }

    const preferredOrder: EvmTransaction['type'][] = ['transfer', 'contract_call', 'internal'];

    for (const type of preferredOrder) {
      const match = txGroup.find((tx) => tx.type === type);
      if (match) {
        return match;
      }
    }

    return txGroup[0];
  }

  private matchesAddress(address: string | undefined, target: string): boolean {
    return address ? address.toLowerCase() === target : false;
  }

  private isUserParticipant(tx: EvmTransaction, userAddress: string): boolean {
    return this.matchesAddress(tx.from, userAddress) || this.matchesAddress(tx.to, userAddress);
  }

  private isNativeMovement(tx: EvmTransaction): boolean {
    const native = this.chainConfig.nativeCurrency.toLowerCase();
    return (
      (tx.tokenType === 'native' && !!tx.amount) ||
      tx.currency.toLowerCase() === native ||
      (tx.tokenSymbol ? tx.tokenSymbol.toLowerCase() === native : false)
    );
  }

  private normalizeNativeAmount(amountWei: string | undefined): string {
    if (!amountWei || amountWei === '0') {
      return '0';
    }

    try {
      return new Decimal(amountWei).dividedBy(new Decimal(10).pow(this.chainConfig.nativeDecimals)).toString();
    } catch (error) {
      this.logger.warn(`Unable to normalize native amount: ${String(error)}`);
      return '0';
    }
  }

  private isZero(value: string): boolean {
    try {
      return new Decimal(value || '0').isZero();
    } catch {
      return true;
    }
  }
}
