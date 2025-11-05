import { parseDecimal } from '@exitbook/core';
import type { OperationClassification, UniversalTransaction } from '@exitbook/core';
import type { ITransactionRepository } from '@exitbook/data';
import type { SolanaTransaction } from '@exitbook/providers';
import { normalizeNativeAmount, normalizeTokenAmount } from '@exitbook/providers';
import type { Decimal } from 'decimal.js';
import { type Result, err, ok, okAsync } from 'neverthrow';

import type { ITokenMetadataService } from '../../../services/token-metadata/token-metadata-service.interface.ts';
import { looksLikeContractAddress, isMissingMetadata } from '../../../services/token-metadata/token-metadata-utils.ts';
import { BaseTransactionProcessor } from '../../shared/processors/base-transaction-processor.ts';

import type { SolanaBalanceChangeAnalysis, SolanaFundFlow, SolanaMovement } from './types.js';

/**
 * Solana transaction processor that converts raw blockchain transaction data
 * into UniversalTransaction format. Features sophisticated fund flow analysis
 * and historical context for accurate transaction classification.
 */
export class SolanaTransactionProcessor extends BaseTransactionProcessor {
  constructor(
    private readonly tokenMetadataService: ITokenMetadataService,
    private readonly _transactionRepository?: ITransactionRepository
  ) {
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

    // Enrich all transactions with token metadata (required)
    const enrichResult = await this.enrichTokenMetadata(normalizedData as SolanaTransaction[]);
    if (enrichResult.isErr()) {
      return err(`Token metadata enrichment failed: ${enrichResult.error.message}`);
    }

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
        // Note: Solana addresses are case-sensitive (base58), so we compare them directly
        const userAddress = sessionMetadata.address as string;
        const userPaidFee = fundFlow.outflows.length > 0 || normalizedTx.from === userAddress;

        // Convert to UniversalTransaction with structured fields
        const universalTransaction: UniversalTransaction = {
          id: 0, // Will be assigned by database
          externalId: normalizedTx.id,
          datetime: new Date(normalizedTx.timestamp).toISOString(),
          timestamp: normalizedTx.timestamp,
          source: 'solana',
          status: normalizedTx.status,
          from: fundFlow.fromAddress,
          to: fundFlow.toAddress,

          // Structured movements from fund flow analysis
          movements: {
            inflows: fundFlow.inflows.map((inflow) => {
              const amount = parseDecimal(inflow.amount);
              return {
                asset: inflow.asset,
                grossAmount: amount,
                netAmount: amount,
              };
            }),
            outflows: fundFlow.outflows.map((outflow) => {
              const amount = parseDecimal(outflow.amount);
              return {
                asset: outflow.asset,
                grossAmount: amount,
                netAmount: amount,
              };
            }),
          },

          fees:
            userPaidFee && !parseDecimal(normalizedTx.feeAmount || '0').isZero()
              ? [
                  {
                    asset: normalizedTx.feeCurrency || 'SOL',
                    amount: parseDecimal(normalizedTx.feeAmount || '0'),
                    scope: 'network',
                    settlement: 'on-chain',
                  },
                ]
              : [],

          operation: classification.operation,

          note: classification.note,

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
          `Successfully processed transaction ${universalTransaction.externalId} - Category: ${classification.operation.category}, Type: ${classification.operation.type}, Amount: ${fundFlow.primary.amount} ${fundFlow.primary.asset}`
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

    return okAsync(transactions);
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

      inflows: flowAnalysis.inflows,
      outflows: flowAnalysis.outflows,
      primary: flowAnalysis.primary,

      // Classification uncertainty
      classificationUncertainty: flowAnalysis.classificationUncertainty,
    };

    return ok(fundFlow);
  }

  /**
   * Analyze balance changes to collect ALL asset movements (multi-asset tracking)
   */
  private analyzeBalanceChanges(tx: SolanaTransaction, allWalletAddresses: Set<string>): SolanaBalanceChangeAnalysis {
    const inflows: SolanaMovement[] = [];
    const outflows: SolanaMovement[] = [];
    let fromAddress = tx.from;
    let toAddress = tx.to;

    // Collect ALL token balance changes involving the user
    if (tx.tokenChanges && tx.tokenChanges.length > 0) {
      for (const change of tx.tokenChanges) {
        const isUserAccount =
          allWalletAddresses.has(change.account) || (change.owner && allWalletAddresses.has(change.owner));

        if (!isUserAccount) continue;

        const tokenAmountInSmallestUnits = parseFloat(change.postAmount) - parseFloat(change.preAmount);
        if (tokenAmountInSmallestUnits === 0) continue; // Skip zero changes

        // Normalize token amount using decimals metadata
        // All providers return amounts in smallest units; normalization ensures consistency and safety
        const normalizedAmount = normalizeTokenAmount(Math.abs(tokenAmountInSmallestUnits).toString(), change.decimals);

        const movement: SolanaMovement = {
          amount: normalizedAmount,
          asset: change.symbol || change.mint,
          decimals: change.decimals,
          tokenAddress: change.mint,
        };

        if (tokenAmountInSmallestUnits > 0) {
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

        const solAmountInLamports = parseFloat(change.postBalance) - parseFloat(change.preBalance);
        if (solAmountInLamports === 0) continue; // Skip zero changes

        // Normalize lamports to SOL using native amount normalization (SOL has 9 decimals)
        const normalizedSolAmount = normalizeNativeAmount(Math.abs(solAmountInLamports).toString(), 9);
        const movement = {
          amount: normalizedSolAmount,
          asset: 'SOL',
        };

        if (solAmountInLamports > 0) {
          inflows.push(movement);
          toAddress = change.account;
        } else {
          outflows.push(movement);
          fromAddress = change.account;
        }
      }
    }

    // Consolidate duplicate assets (sum amounts for same asset)
    const consolidateMovements = (movements: SolanaMovement[]): SolanaMovement[] => {
      const assetMap = new Map<
        string,
        { amount: Decimal; decimals?: number | undefined; tokenAddress?: string | undefined }
      >();

      for (const movement of movements) {
        const existing = assetMap.get(movement.asset);
        if (existing) {
          existing.amount = existing.amount.plus(parseDecimal(movement.amount));
        } else {
          const entry: { amount: Decimal; decimals?: number; tokenAddress?: string } = {
            amount: parseDecimal(movement.amount),
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
        const result: SolanaMovement = {
          amount: data.amount.toFixed(),
          asset,
          decimals: data.decimals,
          tokenAddress: data.tokenAddress,
        };
        return result;
      });
    };

    const consolidatedInflows = consolidateMovements(inflows);
    const consolidatedOutflows = consolidateMovements(outflows);

    // Select primary asset for simplified consumption and single-asset display
    // Prioritizes largest movement to provide a meaningful summary of complex multi-asset transactions
    let primary: SolanaMovement = {
      amount: '0',
      asset: 'SOL',
    };

    // Use largest inflow as primary (prefer tokens with more decimals)
    const largestInflow = consolidatedInflows
      .sort((a, b) => {
        try {
          return parseDecimal(b.amount).comparedTo(parseDecimal(a.amount));
        } catch {
          return 0;
        }
      })
      .find((inflow) => !this.isZero(inflow.amount));

    if (largestInflow) {
      primary = { ...largestInflow };
    } else {
      // If no inflows, use largest outflow
      const largestOutflow = consolidatedOutflows
        .sort((a, b) => {
          try {
            return parseDecimal(b.amount).comparedTo(parseDecimal(a.amount));
          } catch {
            return 0;
          }
        })
        .find((outflow) => !this.isZero(outflow.amount));

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
  private determineOperationFromFundFlow(fundFlow: SolanaFundFlow): OperationClassification {
    const { inflows, outflows } = fundFlow;
    const primaryAmount = parseDecimal(fundFlow.primary.amount || '0').abs();
    const isZero = primaryAmount.isZero();

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
        const isReward = primaryAmount.greaterThan(0) && primaryAmount.lessThan(1); // Rewards are typically small
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
    if (isZero && inflows.length === 0 && outflows.length === 0) {
      return {
        operation: {
          category: 'fee',
          type: 'fee',
        },
      };
    }

    // Pattern 3: Single-asset swap (9/10 confident)
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

    // Pattern 4: DEX swap detected by program (less confident than single-asset swap)
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

  private isZero(value: string): boolean {
    try {
      return parseDecimal(value || '0').isZero();
    } catch {
      return true;
    }
  }

  /**
   * Enrich token metadata for all transactions
   * Only fetches metadata for symbols that look like mint addresses
   */
  private async enrichTokenMetadata(transactions: SolanaTransaction[]): Promise<Result<void, Error>> {
    // Collect all token changes that need enrichment
    const tokenChangesToEnrich = transactions.flatMap((tx) => {
      if (!tx.tokenChanges) return [];
      // Enrich if metadata is incomplete OR if symbol looks like a mint address (Solana = 32+ chars)
      return tx.tokenChanges.filter(
        (change) =>
          isMissingMetadata(change.symbol, change.decimals) ||
          (change.symbol ? looksLikeContractAddress(change.symbol, 32) : false)
      );
    });

    if (tokenChangesToEnrich.length === 0) {
      return ok(void 0);
    }

    this.logger.debug(`Enriching token metadata for ${tokenChangesToEnrich.length} token changes`);

    // Use the token metadata service to enrich with caching and provider fetching
    const enrichResult = await this.tokenMetadataService.enrichBatch(
      tokenChangesToEnrich,
      'solana',
      (change) => change.mint,
      (change, metadata) => {
        if (metadata.symbol) {
          change.symbol = metadata.symbol;
        }
        // Decimals are already set from provider data, but update if metadata has better info
        if (metadata.decimals !== undefined && metadata.decimals !== change.decimals) {
          this.logger.debug(`Updating decimals for ${change.mint} from ${change.decimals} to ${metadata.decimals}`);
          change.decimals = metadata.decimals;
        }
      },
      (change) => change.decimals !== undefined // Enrichment failure OK if decimals already present
    );

    if (enrichResult.isErr()) {
      return err(new Error(`Failed to enrich token metadata: ${enrichResult.error.message}`));
    }

    this.logger.debug('Successfully enriched token metadata from cache/provider');
    return ok(void 0);
  }
}
