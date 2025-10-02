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

      // Determine transaction type and operation classification based on fund flow analysis
      const classification = this.determineOperationFromFundFlow(fundFlow);

      const primaryTx = this.selectPrimaryTransaction(txGroup, fundFlow);
      if (!primaryTx) {
        const errorMsg = 'No primary transaction found for correlated group';
        processingErrors.push({ error: errorMsg, hash, txCount: txGroup.length });
        this.logger.error(
          `${errorMsg} ${hash} (${txGroup.length} items) - THIS TRANSACTION GROUP WILL BE LOST. Group types: ${txGroup.map((t) => t.type).join(', ')}`
        );
        continue;
      }

      const networkFee = createMoney(fundFlow.feeAmount, fundFlow.feeCurrency);

      const universalTransaction: UniversalTransaction = {
        // Core fields
        id: primaryTx.id,
        datetime: new Date(primaryTx.timestamp).toISOString(),
        timestamp: primaryTx.timestamp,
        source: this.chainConfig.chainName,
        status: primaryTx.status === 'success' ? 'ok' : 'failed',
        from: fundFlow.fromAddress || primaryTx.from,
        to: fundFlow.toAddress || primaryTx.to,

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
          platform: undefined, // EVM chains have no platform fees
          total: networkFee,
        },

        // Enhanced classification
        operation: classification.operation,

        // Classification uncertainty notes
        note: classification.note,

        // Blockchain metadata
        blockchain: {
          name: this.chainConfig.chainName,
          block_height: primaryTx.blockHeight,
          transaction_hash: primaryTx.id,
          is_confirmed: primaryTx.status === 'success',
        },

        // Minimal metadata - only provider-specific data
        metadata: {
          blockId: primaryTx.blockId,
          chainId: this.chainConfig.chainId,
          correlatedTxCount: fundFlow.transactionCount,
          hasContractInteraction: fundFlow.hasContractInteraction,
          hasInternalTransactions: fundFlow.hasInternalTransactions,
          hasTokenTransfers: fundFlow.hasTokenTransfers,
          providerId: primaryTx.providerId,
          tokenAddress: fundFlow.primary.tokenAddress,
          tokenDecimals: fundFlow.primary.tokenDecimals,
        },
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

    // Collect ALL assets that flow in/out (not just pick one as primary)
    const inflows: {
      amount: string;
      asset: string;
      tokenAddress?: string | undefined;
      tokenDecimals?: number | undefined;
    }[] = [];
    const outflows: {
      amount: string;
      asset: string;
      tokenAddress?: string | undefined;
      tokenDecimals?: number | undefined;
    }[] = [];

    let fromAddress = '';
    let toAddress = '';

    // Process all token transfers involving the user
    for (const tx of txGroup) {
      if (tx.type === 'token_transfer' && this.isUserParticipant(tx, userAddress)) {
        const tokenSymbol = tx.tokenSymbol || tx.currency || 'UNKNOWN';
        const amount = tx.amount ?? '0';

        // Skip zero amounts
        if (this.isZero(amount)) {
          continue;
        }

        const fromMatches = this.matchesAddress(tx.from, userAddress);
        const toMatches = this.matchesAddress(tx.to, userAddress);

        // For self-transfers (user -> user), track both inflow and outflow
        if (fromMatches && toMatches) {
          const movement: {
            amount: string;
            asset: string;
            tokenAddress?: string | undefined;
            tokenDecimals?: number | undefined;
          } = {
            amount,
            asset: tokenSymbol,
          };
          if (tx.tokenAddress !== undefined) {
            movement.tokenAddress = tx.tokenAddress;
          }
          if (tx.tokenDecimals !== undefined) {
            movement.tokenDecimals = tx.tokenDecimals;
          }
          inflows.push(movement);
          outflows.push({ ...movement });
        } else {
          if (toMatches) {
            // User received this token
            const inflow: {
              amount: string;
              asset: string;
              tokenAddress?: string | undefined;
              tokenDecimals?: number | undefined;
            } = {
              amount,
              asset: tokenSymbol,
            };
            if (tx.tokenAddress !== undefined) {
              inflow.tokenAddress = tx.tokenAddress;
            }
            if (tx.tokenDecimals !== undefined) {
              inflow.tokenDecimals = tx.tokenDecimals;
            }
            inflows.push(inflow);
          }

          if (fromMatches) {
            // User sent this token
            const outflow: {
              amount: string;
              asset: string;
              tokenAddress?: string | undefined;
              tokenDecimals?: number | undefined;
            } = {
              amount,
              asset: tokenSymbol,
            };
            if (tx.tokenAddress !== undefined) {
              outflow.tokenAddress = tx.tokenAddress;
            }
            if (tx.tokenDecimals !== undefined) {
              outflow.tokenDecimals = tx.tokenDecimals;
            }
            outflows.push(outflow);
          }
        }

        // Track addresses
        if (!fromAddress && fromMatches) {
          fromAddress = tx.from;
        }
        if (!toAddress && toMatches) {
          toAddress = tx.to;
        }
        if (!fromAddress) {
          fromAddress = tx.from;
        }
        if (!toAddress) {
          toAddress = tx.to;
        }
      }
    }

    // Process all native currency movements involving the user
    for (const tx of txGroup) {
      if (this.isNativeMovement(tx) && this.isUserParticipant(tx, userAddress)) {
        const normalizedAmount = this.normalizeNativeAmount(tx.amount);

        // Skip zero amounts
        if (this.isZero(normalizedAmount)) {
          continue;
        }

        const fromMatches = this.matchesAddress(tx.from, userAddress);
        const toMatches = this.matchesAddress(tx.to, userAddress);

        // For self-transfers (user -> user), track both inflow and outflow
        if (fromMatches && toMatches) {
          const movement = {
            amount: normalizedAmount,
            asset: this.chainConfig.nativeCurrency,
          };
          inflows.push(movement);
          outflows.push({ ...movement });
        } else {
          if (toMatches) {
            // User received native currency
            inflows.push({
              amount: normalizedAmount,
              asset: this.chainConfig.nativeCurrency,
            });
          }

          if (fromMatches) {
            // User sent native currency
            outflows.push({
              amount: normalizedAmount,
              asset: this.chainConfig.nativeCurrency,
            });
          }
        }

        // Track addresses
        if (!fromAddress && fromMatches) {
          fromAddress = tx.from;
        }
        if (!toAddress && toMatches) {
          toAddress = tx.to;
        }
        if (!fromAddress) {
          fromAddress = tx.from;
        }
        if (!toAddress) {
          toAddress = tx.to;
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

    // Consolidate duplicate assets (sum amounts for same asset)
    const consolidateMovements = (
      movements: {
        amount: string;
        asset: string;
        tokenAddress?: string | undefined;
        tokenDecimals?: number | undefined;
      }[]
    ): { amount: string; asset: string; tokenAddress?: string | undefined; tokenDecimals?: number | undefined }[] => {
      const assetMap = new Map<
        string,
        { amount: Decimal; tokenAddress?: string | undefined; tokenDecimals?: number | undefined }
      >();

      for (const movement of movements) {
        const existing = assetMap.get(movement.asset);
        if (existing) {
          existing.amount = existing.amount.plus(new Decimal(movement.amount));
        } else {
          const entry: { amount: Decimal; tokenAddress?: string; tokenDecimals?: number } = {
            amount: new Decimal(movement.amount),
          };
          if (movement.tokenAddress !== undefined) {
            entry.tokenAddress = movement.tokenAddress;
          }
          if (movement.tokenDecimals !== undefined) {
            entry.tokenDecimals = movement.tokenDecimals;
          }
          assetMap.set(movement.asset, entry);
        }
      }

      return Array.from(assetMap.entries()).map(([asset, data]) => {
        const result: { amount: string; asset: string; tokenAddress?: string; tokenDecimals?: number } = {
          amount: data.amount.toString(),
          asset,
        };
        if (data.tokenAddress !== undefined) {
          result.tokenAddress = data.tokenAddress;
        }
        if (data.tokenDecimals !== undefined) {
          result.tokenDecimals = data.tokenDecimals;
        }
        return result;
      });
    };

    const consolidatedInflows = consolidateMovements(inflows);
    const consolidatedOutflows = consolidateMovements(outflows);

    // Select primary asset for backward compatibility and simple display
    // Priority: largest token transfer > largest native transfer
    let primary = {
      asset: this.chainConfig.nativeCurrency,
      amount: '0',
      tokenAddress: undefined as string | undefined,
      tokenDecimals: undefined as number | undefined,
    };

    // Use largest inflow as primary (prefer token over native)
    const largestInflow = consolidatedInflows
      .sort((a, b) => {
        try {
          return new Decimal(b.amount).comparedTo(new Decimal(a.amount));
        } catch {
          return 0;
        }
      })
      .find((inflow) => !this.isZero(inflow.amount));

    if (largestInflow) {
      primary = {
        asset: largestInflow.asset,
        amount: largestInflow.amount,
        tokenAddress: largestInflow.tokenAddress,
        tokenDecimals: largestInflow.tokenDecimals,
      };
    } else {
      // If no inflows, use largest outflow
      const largestOutflow = consolidatedOutflows
        .sort((a, b) => {
          try {
            return new Decimal(b.amount).comparedTo(new Decimal(a.amount));
          } catch {
            return 0;
          }
        })
        .find((outflow) => !this.isZero(outflow.amount));

      if (largestOutflow) {
        primary = {
          asset: largestOutflow.asset,
          amount: largestOutflow.amount,
          tokenAddress: largestOutflow.tokenAddress,
          tokenDecimals: largestOutflow.tokenDecimals,
        };
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

    // Track uncertainty for complex transactions
    let classificationUncertainty: string | undefined;
    if (consolidatedInflows.length > 1 || consolidatedOutflows.length > 1) {
      classificationUncertainty = `Complex transaction with ${consolidatedOutflows.length} outflow(s) and ${consolidatedInflows.length} inflow(s). May be liquidity provision, batch operation, or multi-asset swap.`;
    }

    return ok({
      classificationUncertainty,
      feeAmount,
      feeCurrency: this.chainConfig.nativeCurrency,
      fromAddress,
      hasContractInteraction,
      hasInternalTransactions,
      hasTokenTransfers,
      inflows: consolidatedInflows,
      outflows: consolidatedOutflows,
      primary,
      toAddress,
      transactionCount: txGroup.length,
    });
  }

  /**
   * Conservative operation classification with uncertainty tracking.
   * Only classifies patterns we're confident about. Complex cases get notes.
   */
  private determineOperationFromFundFlow(fundFlow: EvmFundFlow): {
    legacyType: 'deposit' | 'withdrawal' | 'transfer' | 'fee';
    note?:
      | { message: string; metadata?: Record<string, unknown> | undefined; severity: 'info' | 'warning'; type: string }
      | undefined;
    operation: { category: 'trade' | 'transfer' | 'fee'; type: 'swap' | 'deposit' | 'withdrawal' | 'transfer' | 'fee' };
  } {
    const { inflows, outflows } = fundFlow;
    const amount = new Decimal(fundFlow.primary.amount || '0').abs();
    const isDustOrZero = amount.isZero() || amount.lessThan(EvmTransactionProcessor.DUST_THRESHOLD);

    // Pattern 1: Contract interaction with zero/dust value
    // Approvals, staking operations, etc. - classified as transfer with note
    // Check this BEFORE other patterns since contract interactions are special
    if (isDustOrZero && (fundFlow.hasContractInteraction || fundFlow.hasTokenTransfers)) {
      return {
        legacyType: 'transfer',
        note: {
          message: `Contract interaction with zero/dust value (${fundFlow.primary.amount} ${fundFlow.primary.asset}). May be approval, staking, or other state change.`,
          metadata: {
            hasContractInteraction: fundFlow.hasContractInteraction,
            hasTokenTransfers: fundFlow.hasTokenTransfers,
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

    // Pattern 2: Fee-only transaction
    // Zero/dust amount with NO movements at all (not even dust deposits)
    if (isDustOrZero && inflows.length === 0 && outflows.length === 0) {
      return {
        legacyType: 'fee',
        operation: {
          category: 'fee',
          type: 'fee',
        },
      };
    }

    // Pattern 2b: Dust-amount deposit/withdrawal (still meaningful for accounting)
    // Has movement but amount is below threshold - classify correctly with note
    if (isDustOrZero) {
      if (outflows.length === 0 && inflows.length >= 1) {
        return {
          legacyType: 'deposit',
          note: {
            message: `Dust deposit (${fundFlow.primary.amount} ${fundFlow.primary.asset}). Amount below ${EvmTransactionProcessor.DUST_THRESHOLD} threshold but still affects balance.`,
            metadata: {
              dustThreshold: EvmTransactionProcessor.DUST_THRESHOLD,
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
          legacyType: 'withdrawal',
          note: {
            message: `Dust withdrawal (${fundFlow.primary.amount} ${fundFlow.primary.asset}). Amount below ${EvmTransactionProcessor.DUST_THRESHOLD} threshold but still affects balance.`,
            metadata: {
              dustThreshold: EvmTransactionProcessor.DUST_THRESHOLD,
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

    // Pattern 3: Single asset swap
    // One asset out, different asset in
    if (outflows.length === 1 && inflows.length === 1) {
      const outAsset = outflows[0]?.asset;
      const inAsset = inflows[0]?.asset;

      if (outAsset !== inAsset) {
        return {
          legacyType: 'transfer',
          operation: {
            category: 'trade',
            type: 'swap',
          },
        };
      }
    }

    // Pattern 4: Simple deposit
    // Only inflows, no outflows (can be multiple assets)
    if (outflows.length === 0 && inflows.length >= 1) {
      return {
        legacyType: 'deposit',
        operation: {
          category: 'transfer',
          type: 'deposit',
        },
      };
    }

    // Pattern 5: Simple withdrawal
    // Only outflows, no inflows (can be multiple assets)
    if (outflows.length >= 1 && inflows.length === 0) {
      return {
        legacyType: 'withdrawal',
        operation: {
          category: 'transfer',
          type: 'withdrawal',
        },
      };
    }

    // Pattern 6: Self-transfer
    // Same asset in and out
    if (outflows.length === 1 && inflows.length === 1) {
      const outAsset = outflows[0]?.asset;
      const inAsset = inflows[0]?.asset;

      if (outAsset === inAsset) {
        return {
          legacyType: 'transfer',
          operation: {
            category: 'transfer',
            type: 'transfer',
          },
        };
      }
    }

    // Pattern 7: Complex multi-asset transaction (UNCERTAIN - add note)
    // Multiple inflows or outflows - could be LP, batch, multi-swap
    if (fundFlow.classificationUncertainty) {
      return {
        legacyType: 'transfer',
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

    // Ultimate fallback: Couldn't match any confident pattern
    return {
      legacyType: 'transfer',
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
    return tx.currency.toLowerCase() === native || (tx.tokenSymbol ? tx.tokenSymbol.toLowerCase() === native : false);
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
