import { createMoney } from '@exitbook/core';
import type { ITransactionRepository } from '@exitbook/import/app/ports/transaction-repository.js';
import type { UniversalTransaction } from '@exitbook/import/domain/universal-transaction.ts';
import type { SolanaTransaction } from '@exitbook/providers';
import { type Result, err, ok } from 'neverthrow';

import { BaseTransactionProcessor } from '../../shared/processors/base-transaction-processor.ts';

import type { SolanaFundFlow } from './types.js';

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
    sessionMetadata?: Record<string, unknown>
  ): Promise<Result<UniversalTransaction[], string>> {
    if (!sessionMetadata) {
      return err('Missing session metadata for normalized processing');
    }

    this.logger.info(`Processing ${normalizedData.length} normalized Solana transactions`);

    const transactions: UniversalTransaction[] = [];
    const processingErrors: { error: string; signature: string }[] = [];

    for (const item of normalizedData) {
      const normalizedTx = item as SolanaTransaction;

      try {
        // Perform enhanced fund flow analysis
        const fundFlowResult = this.analyzeFundFlowFromNormalized(normalizedTx, sessionMetadata);

        if (fundFlowResult.isErr()) {
          const errorMsg = `Fund flow analysis failed: ${fundFlowResult.error}`;
          processingErrors.push({ error: errorMsg, signature: normalizedTx.id });
          this.logger.error(`${errorMsg} for Solana transaction ${normalizedTx.id} - THIS TRANSACTION WILL BE LOST`);
          continue;
        }

        const fundFlow = fundFlowResult.value;

        // Determine transaction type and operation classification based on fund flow
        const classification = this.determineOperationFromFundFlow(fundFlow);

        // Only include fees if user was the signer/broadcaster (they paid the fee)
        // For incoming transactions (deposits, airdrops, received transfers), the sender/protocol paid the fee
        // User paid fee if:
        // 1. They have ANY outflows (sent funds, swapped, staked, etc.) OR
        // 2. They initiated a transaction with no outflows (contract interactions, approvals, account creation)
        const userAddress = sessionMetadata.address as string;
        const userAddressLower = userAddress.toLowerCase();
        const txFromLower = normalizedTx.from.toLowerCase();
        const userPaidFee = fundFlow.outflows.length > 0 || txFromLower === userAddressLower;

        const networkFee = userPaidFee
          ? createMoney(normalizedTx.feeAmount || '0', normalizedTx.feeCurrency || 'SOL')
          : createMoney('0', 'SOL');

        // Convert to UniversalTransaction with structured fields
        const universalTransaction: UniversalTransaction = {
          // Core fields
          id: normalizedTx.id,
          datetime: new Date(normalizedTx.timestamp).toISOString(),
          timestamp: normalizedTx.timestamp,
          source: 'solana',
          status: normalizedTx.status === 'success' ? 'ok' : 'failed',
          from: fundFlow.fromAddress,
          to: fundFlow.toAddress,

          // Structured movements from fund flow analysis
          movements: {
            inflows: fundFlow.inflows.map((inflow) => ({
              amount: createMoney(inflow.amount, inflow.asset),
              asset: inflow.asset,
            })),
            outflows: fundFlow.outflows.map((outflow) => ({
              amount: createMoney(outflow.amount, outflow.asset),
              asset: outflow.asset,
            })),
            primary: {
              amount: createMoney(fundFlow.primary.amount, fundFlow.primary.asset),
              asset: fundFlow.primary.asset,
              direction: (() => {
                const hasInflow = fundFlow.inflows.some((i) => i.asset === fundFlow.primary.asset);
                const hasOutflow = fundFlow.outflows.some((o) => o.asset === fundFlow.primary.asset);

                // Self-transfer (same asset in and out) = net zero = neutral
                if (hasInflow && hasOutflow) return 'neutral';
                if (hasInflow) return 'in';
                if (hasOutflow) return 'out';
                return 'neutral'; // No movement = neutral
              })(),
            },
          },

          // Structured fees
          fees: {
            network: networkFee,
            platform: undefined, // Solana has no platform fees
            total: networkFee,
          },

          // Enhanced classification
          operation: classification.operation,

          // Classification uncertainty notes
          note: classification.note,

          // Blockchain metadata
          blockchain: {
            name: 'solana',
            block_height: normalizedTx.blockHeight || normalizedTx.slot,
            transaction_hash: normalizedTx.id,
            is_confirmed: normalizedTx.status === 'success',
          },

          // Minimal metadata - only Solana-specific data
          metadata: {
            blockId: normalizedTx.blockId,
            computeUnitsUsed: fundFlow.computeUnitsUsed,
            hasMultipleInstructions: fundFlow.hasMultipleInstructions,
            hasStaking: fundFlow.hasStaking,
            hasSwaps: fundFlow.hasSwaps,
            hasTokenTransfers: fundFlow.hasTokenTransfers,
            instructionCount: fundFlow.instructionCount,
            providerId: normalizedTx.providerId,
            signature: normalizedTx.signature,
            slot: normalizedTx.slot,
            tokenAddress: fundFlow.primary.tokenAddress,
            tokenDecimals: fundFlow.primary.decimals,
          },
        };

        transactions.push(universalTransaction);

        this.logger.debug(
          `Successfully processed transaction ${universalTransaction.id} - Category: ${classification.operation.category}, Type: ${classification.operation.type}, Amount: ${fundFlow.primary.amount} ${fundFlow.primary.asset}`
        );
      } catch (error) {
        const errorMsg = `Error processing normalized transaction: ${String(error)}`;
        processingErrors.push({ error: errorMsg, signature: normalizedTx.id });
        this.logger.error(`${errorMsg} for ${normalizedTx.id} - THIS TRANSACTION WILL BE LOST`);
        continue;
      }
    }

    // Log processing summary
    const totalInputTransactions = normalizedData.length;
    const successfulTransactions = transactions.length;
    const failedTransactions = processingErrors.length;

    this.logger.info(
      `Processing completed for Solana: ${successfulTransactions} transactions processed, ${failedTransactions} failed (${failedTransactions}/${totalInputTransactions} transactions lost)`
    );

    // STRICT MODE: Fail if ANY transactions could not be processed
    // This is critical for portfolio accuracy - we cannot afford to silently drop transactions
    if (processingErrors.length > 0) {
      this.logger.error(
        `CRITICAL PROCESSING FAILURE for Solana:\n${processingErrors
          .map((e, i) => `  ${i + 1}. [${e.signature.substring(0, 10)}...] ${e.error}`)
          .join('\n')}`
      );

      return err(
        `Cannot proceed: ${failedTransactions}/${totalInputTransactions} transactions failed to process. ` +
          `Lost ${failedTransactions} transactions which would corrupt portfolio calculations. ` +
          `Errors: ${processingErrors.map((e) => `[${e.signature.substring(0, 10)}...]: ${e.error}`).join('; ')}`
      );
    }

    return Promise.resolve(ok(transactions));
  }

  /**
   * Analyze fund flow from normalized SolanaTransaction data
   */
  private analyzeFundFlowFromNormalized(
    tx: SolanaTransaction,
    sessionMetadata: Record<string, unknown>
  ): Result<SolanaFundFlow, string> {
    if (!sessionMetadata.address || typeof sessionMetadata.address !== 'string') {
      return err('Missing user address in session metadata');
    }

    const userAddress = sessionMetadata.address;
    const derivedAddresses = Array.isArray(sessionMetadata.derivedAddresses)
      ? sessionMetadata.derivedAddresses.filter((addr): addr is string => typeof addr === 'string')
      : [];
    const allWalletAddresses = new Set<string>([userAddress, ...derivedAddresses]);

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
      feeAmount: tx.feeAmount || '0',
      feeCurrency: tx.feeCurrency || 'SOL',
      feePaidByUser: flowAnalysis.feePaidByUser,
      fromAddress: flowAnalysis.fromAddress,
      toAddress: flowAnalysis.toAddress,
      hasMultipleInstructions,
      hasStaking,
      hasSwaps,
      hasTokenTransfers,
      instructionCount,
      transactionCount: 1, // Always 1 for Solana (no correlation like EVM)

      // Structured movements
      inflows: flowAnalysis.inflows,
      outflows: flowAnalysis.outflows,
      primary: flowAnalysis.primary,

      // Classification uncertainty
      classificationUncertainty: flowAnalysis.classificationUncertainty,

      // Deprecated fields for backward compatibility
      currency: flowAnalysis.primary.asset,
      isIncoming: flowAnalysis.inflows.length > 0 && flowAnalysis.outflows.length === 0,
      isOutgoing: flowAnalysis.outflows.length > 0 && flowAnalysis.inflows.length === 0,
      netAmount: flowAnalysis.primary.amount,
      primaryAmount: flowAnalysis.primary.amount,
      primarySymbol: flowAnalysis.primary.asset,
      tokenAccount: tx.tokenAccount,
      totalAmount: flowAnalysis.primary.amount,
    };

    return ok(fundFlow);
  }

  /**
   * Analyze balance changes to collect ALL asset movements (multi-asset tracking)
   */
  private analyzeBalanceChanges(
    tx: SolanaTransaction,
    allWalletAddresses: Set<string>
  ): {
    classificationUncertainty?: string | undefined;
    feePaidByUser: boolean;
    fromAddress: string;
    inflows: { amount: string; asset: string; decimals?: number | undefined; tokenAddress?: string | undefined }[];
    outflows: { amount: string; asset: string; decimals?: number | undefined; tokenAddress?: string | undefined }[];
    primary: { amount: string; asset: string; decimals?: number | undefined; tokenAddress?: string | undefined };
    toAddress: string;
  } {
    const inflows: { amount: string; asset: string; decimals?: number; tokenAddress?: string }[] = [];
    const outflows: { amount: string; asset: string; decimals?: number; tokenAddress?: string }[] = [];
    let fromAddress = tx.from;
    let toAddress = tx.to;

    // Collect ALL token balance changes involving the user
    if (tx.tokenChanges && tx.tokenChanges.length > 0) {
      for (const change of tx.tokenChanges) {
        const isUserAccount =
          allWalletAddresses.has(change.account) || (change.owner && allWalletAddresses.has(change.owner));

        if (!isUserAccount) continue;

        const tokenAmount = parseFloat(change.postAmount) - parseFloat(change.preAmount);
        if (tokenAmount === 0) continue; // Skip zero changes

        const movement: { amount: string; asset: string; decimals?: number; tokenAddress?: string } = {
          amount: Math.abs(tokenAmount).toString(),
          asset: change.symbol || change.mint,
        };

        if (change.decimals !== undefined) {
          movement.decimals = change.decimals;
        }
        if (change.mint) {
          movement.tokenAddress = change.mint;
        }

        if (tokenAmount > 0) {
          inflows.push(movement);
          toAddress = change.account;
        } else {
          outflows.push(movement);
          fromAddress = change.account;
        }
      }
    }

    // Collect ALL SOL balance changes involving the user (excluding fee-only changes)
    if (tx.accountChanges && tx.accountChanges.length > 0) {
      for (const change of tx.accountChanges) {
        const isUserAccount = allWalletAddresses.has(change.account);
        if (!isUserAccount) continue;

        const solAmount = parseFloat(change.postBalance) - parseFloat(change.preBalance);
        if (solAmount === 0) continue; // Skip zero changes

        // Convert lamports to SOL
        const solAmountConverted = solAmount / 1_000_000_000;
        const movement = {
          amount: Math.abs(solAmountConverted).toString(),
          asset: 'SOL',
        };

        if (solAmount > 0) {
          inflows.push(movement);
          toAddress = change.account;
        } else {
          outflows.push(movement);
          fromAddress = change.account;
        }
      }
    }

    // Consolidate duplicate assets (sum amounts for same asset)
    const consolidateMovements = (
      movements: { amount: string; asset: string; decimals?: number | undefined; tokenAddress?: string | undefined }[]
    ): { amount: string; asset: string; decimals?: number | undefined; tokenAddress?: string | undefined }[] => {
      const assetMap = new Map<
        string,
        { amount: number; decimals?: number | undefined; tokenAddress?: string | undefined }
      >();

      for (const movement of movements) {
        const existing = assetMap.get(movement.asset);
        if (existing) {
          existing.amount += parseFloat(movement.amount);
        } else {
          const entry: { amount: number; decimals?: number; tokenAddress?: string } = {
            amount: parseFloat(movement.amount),
          };
          if (movement.decimals !== undefined) {
            entry.decimals = movement.decimals;
          }
          if (movement.tokenAddress !== undefined) {
            entry.tokenAddress = movement.tokenAddress;
          }
          assetMap.set(movement.asset, entry);
        }
      }

      return Array.from(assetMap.entries()).map(([asset, data]) => {
        const result: { amount: string; asset: string; decimals?: number; tokenAddress?: string } = {
          amount: data.amount.toString(),
          asset,
        };
        if (data.decimals !== undefined) {
          result.decimals = data.decimals;
        }
        if (data.tokenAddress !== undefined) {
          result.tokenAddress = data.tokenAddress;
        }
        return result;
      });
    };

    const consolidatedInflows = consolidateMovements(inflows);
    const consolidatedOutflows = consolidateMovements(outflows);

    // Select primary asset for simplified consumption and single-asset display
    // Prioritizes largest movement to provide a meaningful summary of complex multi-asset transactions
    let primary: { amount: string; asset: string; decimals?: number | undefined; tokenAddress?: string | undefined } = {
      amount: '0',
      asset: 'SOL',
    };

    // Use largest inflow as primary (prefer tokens with more decimals)
    const largestInflow = consolidatedInflows
      .sort((a, b) => parseFloat(b.amount) - parseFloat(a.amount))
      .find((inflow) => parseFloat(inflow.amount) !== 0);

    if (largestInflow) {
      primary = { ...largestInflow };
    } else {
      // If no inflows, use largest outflow
      const largestOutflow = consolidatedOutflows
        .sort((a, b) => parseFloat(b.amount) - parseFloat(a.amount))
        .find((outflow) => parseFloat(outflow.amount) !== 0);

      if (largestOutflow) {
        primary = { ...largestOutflow };
      }
    }

    // Track uncertainty for complex transactions
    let classificationUncertainty: string | undefined;
    if (consolidatedInflows.length > 1 || consolidatedOutflows.length > 1) {
      classificationUncertainty = `Complex transaction with ${consolidatedOutflows.length} outflow(s) and ${consolidatedInflows.length} inflow(s). May be liquidity provision, batch operation, or multi-asset swap.`;
    }

    // Determine fee payer
    const feePaidByUser = allWalletAddresses.has(tx.from) || allWalletAddresses.has(fromAddress);

    return {
      classificationUncertainty,
      feePaidByUser,
      fromAddress,
      inflows: consolidatedInflows,
      outflows: consolidatedOutflows,
      primary,
      toAddress,
    };
  }

  /**
   * Conservative operation classification with 9/10 confidence requirement.
   * Only classifies patterns we're confident about. Complex cases get notes.
   */
  private determineOperationFromFundFlow(fundFlow: SolanaFundFlow): {
    note?:
      | { message: string; metadata?: Record<string, unknown> | undefined; severity: 'info' | 'warning'; type: string }
      | undefined;
    operation: {
      category: 'trade' | 'transfer' | 'staking' | 'defi' | 'fee';
      type: 'buy' | 'sell' | 'deposit' | 'withdrawal' | 'stake' | 'unstake' | 'reward' | 'swap' | 'fee' | 'transfer';
    };
  } {
    const { inflows, outflows } = fundFlow;
    const primaryAmount = parseFloat(fundFlow.primary.amount || '0');
    const DUST_THRESHOLD = 0.00001;
    const isDustOrZero = primaryAmount === 0 || primaryAmount < DUST_THRESHOLD;

    // Pattern 1: Staking operations (high confidence based on program detection)
    if (fundFlow.hasStaking) {
      if (outflows.length > 0 && inflows.length === 0) {
        return {
          operation: {
            category: 'staking',
            type: 'stake',
          },
        };
      }

      if (inflows.length > 0 && outflows.length === 0) {
        // Check if reward or withdrawal based on amount
        const isReward = primaryAmount > 0 && primaryAmount < 1; // Rewards are typically small
        return {
          operation: {
            category: 'staking',
            type: isReward ? 'reward' : 'unstake',
          },
        };
      }

      // Complex staking with both inflows and outflows
      return {
        note: {
          message: 'Complex staking operation with both inflows and outflows. Manual review recommended.',
          metadata: {
            hasStaking: true,
            inflows: inflows.map((i) => ({ amount: i.amount, asset: i.asset })),
            outflows: outflows.map((o) => ({ amount: o.amount, asset: o.asset })),
          },
          severity: 'info',
          type: 'classification_uncertain',
        },
        operation: {
          category: 'staking',
          type: 'stake',
        },
      };
    }

    // Pattern 2: Fee-only transaction (no movements)
    if (isDustOrZero && inflows.length === 0 && outflows.length === 0) {
      return {
        operation: {
          category: 'fee',
          type: 'fee',
        },
      };
    }

    // Pattern 3: Dust-amount deposit/withdrawal (still meaningful for accounting)
    if (isDustOrZero) {
      if (outflows.length === 0 && inflows.length >= 1) {
        return {
          note: {
            message: `Dust deposit (${fundFlow.primary.amount} ${fundFlow.primary.asset}). Amount below ${DUST_THRESHOLD} threshold but still affects balance.`,
            metadata: {
              dustThreshold: DUST_THRESHOLD,
              inflows: inflows.map((i) => ({ amount: i.amount, asset: i.asset })),
            },
            severity: 'info',
            type: 'dust_amount',
          },
          operation: {
            category: 'transfer',
            type: 'deposit',
          },
        };
      }

      if (outflows.length >= 1 && inflows.length === 0) {
        return {
          note: {
            message: `Dust withdrawal (${fundFlow.primary.amount} ${fundFlow.primary.asset}). Amount below ${DUST_THRESHOLD} threshold but still affects balance.`,
            metadata: {
              dustThreshold: DUST_THRESHOLD,
              outflows: outflows.map((o) => ({ amount: o.amount, asset: o.asset })),
            },
            severity: 'info',
            type: 'dust_amount',
          },
          operation: {
            category: 'transfer',
            type: 'withdrawal',
          },
        };
      }
    }

    // Pattern 4: Single-asset swap (9/10 confident)
    if (outflows.length === 1 && inflows.length === 1) {
      const outAsset = outflows[0]?.asset;
      const inAsset = inflows[0]?.asset;

      if (outAsset !== inAsset) {
        return {
          operation: {
            category: 'trade',
            type: 'swap',
          },
        };
      }
    }

    // Pattern 5: DEX swap detected by program (less confident than single-asset swap)
    if (fundFlow.hasSwaps) {
      return {
        note: {
          message: 'DEX program detected. Classified as swap based on program analysis.',
          metadata: {
            hasSwaps: true,
            inflows: inflows.map((i) => ({ amount: i.amount, asset: i.asset })),
            outflows: outflows.map((o) => ({ amount: o.amount, asset: o.asset })),
          },
          severity: 'info',
          type: 'program_based_classification',
        },
        operation: {
          category: 'trade',
          type: 'swap',
        },
      };
    }

    // Pattern 6: Simple deposit (only inflows)
    if (outflows.length === 0 && inflows.length >= 1) {
      return {
        operation: {
          category: 'transfer',
          type: 'deposit',
        },
      };
    }

    // Pattern 7: Simple withdrawal (only outflows)
    if (outflows.length >= 1 && inflows.length === 0) {
      return {
        operation: {
          category: 'transfer',
          type: 'withdrawal',
        },
      };
    }

    // Pattern 8: Self-transfer (same asset in and out)
    if (outflows.length === 1 && inflows.length === 1) {
      const outAsset = outflows[0]?.asset;
      const inAsset = inflows[0]?.asset;

      if (outAsset === inAsset) {
        return {
          operation: {
            category: 'transfer',
            type: 'transfer',
          },
        };
      }
    }

    // Pattern 9: Complex multi-asset transaction (UNCERTAIN - add note)
    if (fundFlow.classificationUncertainty) {
      return {
        note: {
          message: fundFlow.classificationUncertainty,
          metadata: {
            inflows: inflows.map((i) => ({ amount: i.amount, asset: i.asset })),
            outflows: outflows.map((o) => ({ amount: o.amount, asset: o.asset })),
          },
          severity: 'info',
          type: 'classification_uncertain',
        },
        operation: {
          category: 'transfer',
          type: 'transfer',
        },
      };
    }

    // Pattern 10: Batch operations (multiple instructions)
    if (fundFlow.hasMultipleInstructions && fundFlow.instructionCount > 3) {
      return {
        note: {
          message: `Batch transaction with ${fundFlow.instructionCount} instructions. May contain multiple operations.`,
          metadata: {
            hasMultipleInstructions: true,
            inflows: inflows.map((i) => ({ amount: i.amount, asset: i.asset })),
            instructionCount: fundFlow.instructionCount,
            outflows: outflows.map((o) => ({ amount: o.amount, asset: o.asset })),
          },
          severity: 'info',
          type: 'batch_operation',
        },
        operation: {
          category: 'transfer',
          type: 'transfer',
        },
      };
    }

    // Ultimate fallback: Couldn't match any confident pattern
    return {
      note: {
        message: 'Unable to determine transaction classification using confident patterns.',
        metadata: {
          inflows: inflows.map((i) => ({ amount: i.amount, asset: i.asset })),
          outflows: outflows.map((o) => ({ amount: o.amount, asset: o.asset })),
        },
        severity: 'warning',
        type: 'classification_failed',
      },
      operation: {
        category: 'transfer',
        type: 'transfer',
      },
    };
  }

  /**
   * Detect staking-related instructions
   */
  private detectStakingInstructions(instructions: SolanaTransaction['instructions']): boolean {
    if (!instructions) return false;

    const stakingPrograms = [
      '11111111111111111111111111111112', // System Program (stake account creation)
      'Stake11111111111111111111111111111111111112', // Stake Program
      'MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD', // Marinade Finance
      'CREAMfFfjMFogWFdFhLpAiRX8qC3BkyPUz7gW9DDfnMv', // Marinade MNDE staking
      'CgBg8TebSu4JbGQHRw6W7XvMc2UbNm8PXqEf9YUq4d7w', // Lido (Solido)
      'SoL1dMULNATED9WvXZVZoLTM1PnJqHQCkfkxLx7dWMk', // Solido Staking
      'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn', // Jito Staking
      'SP12tWFxD9oJsVWNavTTBZvMbA6gkAmxtVgxsgqyXsT', // Sanctum SPL Stake Pool
    ];

    return instructions.some((instruction) => instruction.programId && stakingPrograms.includes(instruction.programId));
  }

  /**
   * Detect swap/DEX instructions
   */
  private detectSwapInstructions(instructions: SolanaTransaction['instructions']): boolean {
    if (!instructions) return false;

    const dexPrograms = [
      // Aggregators
      'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', // Jupiter v6
      'JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB', // Jupiter v4
      'JUP2jxvXaqu7NQY1GmNF4m1vodw12LVXYxbFL2uJvfo', // Jupiter v2

      // DEXs
      '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM', // Serum DEX v3
      '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8', // Raydium AMM v4
      '5quBtoiQqxF9Jv6KYKctB59NT3gtJD2Y65kdnB1Uev3h', // Raydium AMM v3
      'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc', // Orca Whirlpools
      '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin', // Serum DEX v2
      'DjVE6JNiYqPL2QXyCUUh8rNjHrbz9hXHNYt99MQ59qw1', // Orca v1
      'PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY', // Phoenix
      'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo', // Meteora DLMM
      'Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB', // Meteora Pools
      '2wT8Yq49kHgDzXuPxZSaeLaH1qbmGXtEyPy64bL7aD3c', // Lifinity v2
      'EewxydAPCCVuNEyrVN68PuSYdQ7wKn27V9Gjeoi8dy3S', // Lifinity v1
      'SSwpkEEcbUqx4vtoEByFjSkhKdCT862DNVb52nZg1UZ', // Saber Stable Swap
      'MERLuDFBMmsHnsBPZw2sDQZHvXFMwp8EdjudcU2HKky', // Mercurial Stable Swap
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

  /**
   * Detect NFT-related instructions (for future use)
   * Can be used to improve classification of NFT mints, transfers, and marketplace transactions
   */
  private detectNFTInstructions(instructions: SolanaTransaction['instructions']): boolean {
    if (!instructions) return false;

    const nftPrograms = [
      // Metaplex
      'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s', // Token Metadata Program
      'p1exdMJcjVao65QdewkaZRUnU6VPSXhus9n2GzWfh98', // Token Metadata (old)
      'cndy3Z4yapfJBmL3ShUp5exZKqR3z33thTzeNMm2gRZ', // Candy Machine v3
      'cndyAnrLdpjq1Ssp1z8xxDsB8dxe7u4HL5Nxi2K5WXZ', // Candy Machine v2
      'CJsLwbP1iu5DuUikHEJnLfANgKy6stB2uFgvBBHoyxwz', // Candy Guard
      'BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY', // Bubblegum (cNFTs)

      // Marketplaces
      'M2mx93ekt1fmXSVkTrUL9xVFHkmME8HTUi5Cyc5aF7K', // Magic Eden v2
      'MEisE1HzehtrDpAAT8PnLHjpSSkRYakotTuJRPjTpo8', // Magic Eden
      'TSWAPaqyCSx2KABk68Shruf4rp7CxcNi8hAsbdwmHbN', // Tensor Swap
      'TCMPhJdwDryooaGtiocG1u3xcYbRpiJzb283XfCZsDp', // Tensor cNFT
      'hadeK9DLv9eA7ya5KCTqSvSvRZeJC3JgD5a9Y3CNbvu', // Hadeswap
      'CJsLwbP1iu5DuUikHEJnLfANgKy6stB2uFgvBBHoyxwz', // Coral Cube
    ];

    return instructions.some((instruction) => instruction.programId && nftPrograms.includes(instruction.programId));
  }
}
