import type { ITransactionRepository } from '@exitbook/import/app/ports/transaction-repository.js';
import type { TransactionType, UniversalTransaction } from '@exitbook/import/domain/universal-transaction.ts';
import { createMoney } from '@exitbook/shared-utils';
import { type Result, err, ok } from 'neverthrow';

import type { ImportSessionMetadata } from '../../../app/ports/transaction-processor.interface.ts';
import { BaseTransactionProcessor } from '../../shared/processors/base-transaction-processor.ts';

import type { SolanaAccountChange, SolanaFundFlow, SolanaTokenChange, SolanaTransaction } from './types.js';

/**
 * Solana transaction processor that converts raw blockchain transaction data
 * into UniversalTransaction format. Features sophisticated fund flow analysis
 * and historical context for accurate transaction classification.
 */
export class SolanaTransactionProcessor extends BaseTransactionProcessor {
  constructor(private _transactionRepository?: ITransactionRepository) {
    super('solana');
  }

  /**
   * Process normalized data (structured SolanaTransaction objects)
   * with sophisticated fund flow analysis
   */
  protected async processInternal(
    normalizedData: unknown[],
    sessionMetadata?: ImportSessionMetadata
  ): Promise<Result<UniversalTransaction[], string>> {
    if (!sessionMetadata) {
      return err('Missing session metadata for normalized processing');
    }

    this.logger.info(`Processing ${normalizedData.length} normalized Solana transactions`);

    const transactions: UniversalTransaction[] = [];

    for (const item of normalizedData) {
      const normalizedTx = item as SolanaTransaction;

      try {
        // Perform enhanced fund flow analysis
        const fundFlowResult = this.analyzeFundFlowFromNormalized(normalizedTx, sessionMetadata);

        if (fundFlowResult.isErr()) {
          this.logger.warn(`Fund flow analysis failed for ${normalizedTx.id}: ${fundFlowResult.error}`);
          continue;
        }

        const fundFlow = fundFlowResult.value;

        // Determine transaction type based on fund flow with enhanced classification
        const transactionType = this.determineTransactionTypeFromFundFlow(fundFlow, sessionMetadata);

        // Convert to UniversalTransaction
        const universalTransaction: UniversalTransaction = {
          amount: createMoney(fundFlow.netAmount, fundFlow.currency),
          datetime: new Date(normalizedTx.timestamp).toISOString(),
          fee: normalizedTx.feeAmount
            ? createMoney(normalizedTx.feeAmount, normalizedTx.feeCurrency || 'SOL')
            : createMoney('0', 'SOL'),
          from: fundFlow.fromAddress,
          id: normalizedTx.id,
          metadata: {
            blockchain: 'solana',
            blockHeight: normalizedTx.blockHeight || normalizedTx.slot,
            blockId: normalizedTx.blockId,
            fundFlow: {
              computeUnitsUsed: fundFlow.computeUnitsUsed,
              currency: fundFlow.currency,
              feePaidByUser: fundFlow.feePaidByUser,
              hasMultipleInstructions: fundFlow.hasMultipleInstructions,
              hasStaking: fundFlow.hasStaking,
              hasSwaps: fundFlow.hasSwaps,
              hasTokenTransfers: fundFlow.hasTokenTransfers,
              instructionCount: fundFlow.instructionCount,
              isIncoming: fundFlow.isIncoming,
              isOutgoing: fundFlow.isOutgoing,
              netAmount: fundFlow.netAmount,
              totalAmount: fundFlow.totalAmount,
            },
            providerId: normalizedTx.providerId,
            signature: normalizedTx.signature,
            slot: normalizedTx.slot,
            tokenAddress: normalizedTx.tokenAddress,
            tokenDecimals: normalizedTx.tokenDecimals,
            tokenSymbol: normalizedTx.tokenSymbol,
          },
          source: 'solana',
          status: normalizedTx.status === 'success' ? 'ok' : 'failed',
          symbol: fundFlow.currency,
          timestamp: normalizedTx.timestamp,
          to: fundFlow.toAddress,
          type: transactionType,
        };

        transactions.push(universalTransaction);

        this.logger.debug(
          `Successfully processed normalized transaction ${universalTransaction.id} - Type: ${transactionType}, Amount: ${fundFlow.netAmount} ${fundFlow.currency}`
        );
      } catch (error) {
        this.logger.error(`Error processing normalized transaction ${normalizedTx.id}: ${String(error)}`);
        continue;
      }
    }

    return Promise.resolve(ok(transactions));
  }

  /**
   * Analyze fund flow from normalized SolanaTransaction data
   */
  private analyzeFundFlowFromNormalized(
    tx: SolanaTransaction,
    sessionMetadata: ImportSessionMetadata
  ): Result<SolanaFundFlow, string> {
    if (!sessionMetadata.address) {
      return err('Missing user address in session metadata');
    }

    const userAddress = sessionMetadata.address;
    const allWalletAddresses = new Set([userAddress, ...(sessionMetadata.derivedAddresses || [])]);

    // Analyze instruction complexity
    const instructionCount = tx.instructions?.length || 0;
    const hasMultipleInstructions = instructionCount > 1;

    // Detect transaction types based on instructions
    const hasStaking = this.detectStakingInstructions(tx.instructions || []);
    const hasSwaps = this.detectSwapInstructions(tx.instructions || []);
    const hasTokenTransfers = this.detectTokenTransferInstructions(tx.instructions || []);

    // Enhanced fund flow analysis using balance changes
    const flowAnalysis = this.analyzeBalanceChanges(tx, allWalletAddresses);

    const fundFlow: SolanaFundFlow = {
      computeUnitsUsed: tx.computeUnitsConsumed,
      currency: flowAnalysis.currency,
      feeAmount: tx.feeAmount || '0',
      feeCurrency: tx.feeCurrency || 'SOL',
      feePaidByUser: flowAnalysis.feePaidByUser,
      fromAddress: flowAnalysis.fromAddress,
      hasMultipleInstructions,
      hasStaking,
      hasSwaps,
      hasTokenTransfers,
      instructionCount,
      isIncoming: flowAnalysis.isIncoming,
      isOutgoing: flowAnalysis.isOutgoing,
      netAmount: flowAnalysis.netAmount,
      primaryAmount: flowAnalysis.primaryAmount,
      primarySymbol: flowAnalysis.currency,
      toAddress: flowAnalysis.toAddress,
      tokenAccount: tx.tokenAccount,
      totalAmount: flowAnalysis.totalAmount,
    };

    return ok(fundFlow);
  }

  /**
   * Analyze balance changes to determine accurate fund flow
   */
  private analyzeBalanceChanges(
    tx: SolanaTransaction,
    allWalletAddresses: Set<string>
  ): {
    currency: string;
    feePaidByUser: boolean;
    fromAddress: string;
    isIncoming: boolean;
    isOutgoing: boolean;
    netAmount: string;
    primaryAmount: string;
    toAddress: string;
    totalAmount: string;
  } {
    // Start with defaults from the transaction
    let currency = tx.currency;
    let primaryAmount = tx.amount || '0';
    let fromAddress = tx.from;
    let toAddress = tx.to;
    let isIncoming = false;
    let isOutgoing = false;
    let netAmount = '0';

    // Prioritize token changes over SOL changes
    if (tx.tokenChanges && tx.tokenChanges.length > 0) {
      // Find the largest token transfer involving user addresses
      const userTokenChange = this.findUserTokenChange(tx.tokenChanges, allWalletAddresses);

      if (userTokenChange) {
        const tokenAmount = parseFloat(userTokenChange.postAmount) - parseFloat(userTokenChange.preAmount);
        currency = userTokenChange.symbol || userTokenChange.mint;
        primaryAmount = Math.abs(tokenAmount).toString();
        netAmount = tokenAmount.toString();
        isIncoming = tokenAmount > 0;
        isOutgoing = tokenAmount < 0;

        // Try to find corresponding sender/receiver
        if (isIncoming) {
          toAddress = userTokenChange.account;
        } else if (isOutgoing) {
          fromAddress = userTokenChange.account;
        }
      }
    } else if (tx.accountChanges && tx.accountChanges.length > 0) {
      // Analyze SOL balance changes for user accounts
      const userSolChange = this.findUserSolChange(tx.accountChanges, allWalletAddresses);

      if (userSolChange) {
        const solAmount = parseFloat(userSolChange.postBalance) - parseFloat(userSolChange.preBalance);
        currency = 'SOL';
        primaryAmount = Math.abs(solAmount).toString();
        netAmount = solAmount.toString();
        isIncoming = solAmount > 0;
        isOutgoing = solAmount < 0;

        // Set addresses based on direction
        if (isIncoming) {
          toAddress = userSolChange.account;
        } else if (isOutgoing) {
          fromAddress = userSolChange.account;
        }
      }
    }

    // Determine fee payer (usually the first signer or sender)
    const feePaidByUser = allWalletAddresses.has(tx.from) || allWalletAddresses.has(fromAddress);

    // If still no direction determined, fall back to original logic
    if (!isIncoming && !isOutgoing) {
      const isFromWallet = allWalletAddresses.has(tx.from);
      const isToWallet = allWalletAddresses.has(tx.to);
      isIncoming = !isFromWallet && isToWallet;
      isOutgoing = isFromWallet && !isToWallet;
      netAmount = isOutgoing ? `-${primaryAmount}` : primaryAmount;
    }

    return {
      currency,
      feePaidByUser,
      fromAddress,
      isIncoming,
      isOutgoing,
      netAmount,
      primaryAmount,
      toAddress,
      totalAmount: primaryAmount,
    };
  }

  /**
   * Find the most significant token change involving user addresses
   */
  private findUserTokenChange(
    tokenChanges: SolanaTokenChange[],
    allWalletAddresses: Set<string>
  ): SolanaTokenChange | undefined {
    const userTokenChanges = tokenChanges.filter(
      (change) => allWalletAddresses.has(change.account) || (change.owner && allWalletAddresses.has(change.owner))
    );

    if (userTokenChanges.length === 0) {
      return undefined;
    }

    // Return the token change with the largest absolute amount change
    return userTokenChanges.reduce((largest, change) => {
      const changeAmount = Math.abs(parseFloat(change.postAmount) - parseFloat(change.preAmount));
      const largestAmount = Math.abs(parseFloat(largest.postAmount) - parseFloat(largest.preAmount));
      return changeAmount > largestAmount ? change : largest;
    });
  }

  /**
   * Find the most significant SOL balance change involving user addresses
   */
  private findUserSolChange(
    accountChanges: SolanaAccountChange[],
    allWalletAddresses: Set<string>
  ): SolanaAccountChange | undefined {
    const userAccountChanges = accountChanges.filter((change) => allWalletAddresses.has(change.account));

    if (userAccountChanges.length === 0) {
      return undefined;
    }

    // Return the account change with the largest absolute balance change
    return userAccountChanges.reduce((largest, change) => {
      const changeAmount = Math.abs(parseFloat(change.postBalance) - parseFloat(change.preBalance));
      const largestAmount = Math.abs(parseFloat(largest.postBalance) - parseFloat(largest.preBalance));
      return changeAmount > largestAmount ? change : largest;
    });
  }

  /**
   * Determine transaction type from fund flow with enhanced Solana-specific classification
   */
  private determineTransactionTypeFromFundFlow(
    fundFlow: SolanaFundFlow,
    _sessionMetadata: ImportSessionMetadata
  ): TransactionType {
    // Enhanced classification using new TransactionType enum
    if (fundFlow.hasStaking) {
      // Use specific staking transaction types
      if (fundFlow.isOutgoing) {
        return 'staking_deposit'; // Staking funds (bonding)
      } else {
        // Check if this is a reward or withdrawal
        const netAmount = parseFloat(fundFlow.netAmount);
        return netAmount > 0 ? 'staking_reward' : 'staking_withdrawal';
      }
    }

    if (fundFlow.hasSwaps) {
      return 'trade'; // DEX swaps
    }

    // Check for batch transactions (multiple instructions)
    if (fundFlow.hasMultipleInstructions && fundFlow.instructionCount > 3) {
      return 'utility_batch'; // Complex batch operations
    }

    // Self-transfers (same from/to address)
    if (fundFlow.fromAddress === fundFlow.toAddress) {
      return 'internal_transfer'; // Self-to-self transfers
    }

    if (fundFlow.hasTokenTransfers) {
      // Token transfers follow standard direction logic
      if (fundFlow.isIncoming) return 'deposit';
      if (fundFlow.isOutgoing) return 'withdrawal';
      return 'transfer';
    }

    // SOL transfers
    if (fundFlow.isIncoming) return 'deposit';
    if (fundFlow.isOutgoing) return 'withdrawal';

    // Fee-only transactions
    if (parseFloat(fundFlow.netAmount) === 0) return 'fee';

    return 'transfer';
  }

  /**
   * Detect staking-related instructions
   */
  private detectStakingInstructions(instructions: SolanaTransaction['instructions']): boolean {
    if (!instructions) return false;

    const stakingPrograms = [
      '11111111111111111111111111111112', // System Program (stake account creation)
      'Stake11111111111111111111111111111111111112', // Stake Program
    ];

    return instructions.some((instruction) => instruction.programId && stakingPrograms.includes(instruction.programId));
  }

  /**
   * Detect swap/DEX instructions
   */
  private detectSwapInstructions(instructions: SolanaTransaction['instructions']): boolean {
    if (!instructions) return false;

    const dexPrograms = [
      '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM', // Serum DEX
      'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', // Jupiter
      '5quBtoiQqxF9Jv6KYKctB59NT3gtJD2Y65kdnB1Uev3h', // Raydium
    ];

    return instructions.some((instruction) => instruction.programId && dexPrograms.includes(instruction.programId));
  }

  /**
   * Detect SPL token transfer instructions
   */
  private detectTokenTransferInstructions(instructions: SolanaTransaction['instructions']): boolean {
    if (!instructions) return false;

    const tokenPrograms = [
      'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', // SPL Token Program
      'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', // Token-2022 Program
    ];

    return instructions.some((instruction) => instruction.programId && tokenPrograms.includes(instruction.programId));
  }
}
