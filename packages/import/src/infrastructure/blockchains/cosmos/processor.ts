import { createMoney } from '@exitbook/core';
import type { ITransactionRepository } from '@exitbook/import/app/ports/transaction-repository.js';
import type { UniversalTransaction } from '@exitbook/import/domain/universal-transaction.ts';
import type { CosmosChainConfig, CosmosTransaction } from '@exitbook/providers';
import { Decimal } from 'decimal.js';
import { type Result, err, ok } from 'neverthrow';

import { BaseTransactionProcessor } from '../../shared/processors/base-transaction-processor.ts';

import type { CosmosFundFlow } from './types.ts';

/**
 * Generic Cosmos SDK transaction processor that converts raw blockchain transaction data
 * into UniversalTransaction format. Works with any Cosmos SDK-based chain (Injective, Osmosis, etc.)
 * Uses ProcessorFactory to dispatch to provider-specific processors based on data provenance.
 * Enhanced with sophisticated fund flow analysis.
 */
export class CosmosProcessor extends BaseTransactionProcessor {
  /** Minimum amount threshold below which transactions are classified as 'fee' type */
  private static readonly DUST_THRESHOLD = '0.00001';

  private chainConfig: CosmosChainConfig;

  constructor(chainConfig: CosmosChainConfig, _transactionRepository?: ITransactionRepository) {
    super(chainConfig.chainName);
    this.chainConfig = chainConfig;
  }

  /**
   * Process normalized CosmosTransaction data with sophisticated fund flow analysis
   */
  protected async processInternal(
    normalizedData: unknown[],
    sessionMetadata?: Record<string, unknown>
  ): Promise<Result<UniversalTransaction[], string>> {
    if (!sessionMetadata?.address || typeof sessionMetadata.address !== 'string') {
      return err('No address provided in session metadata');
    }

    const userAddress = sessionMetadata.address;
    const universalTransactions: UniversalTransaction[] = [];

    for (const transaction of normalizedData) {
      const normalizedTx = transaction as CosmosTransaction;
      try {
        // Analyze fund flow for sophisticated transaction classification
        const fundFlow = this.analyzeFundFlowFromNormalized(normalizedTx, userAddress);

        // Determine operation classification based on fund flow
        const classification = this.determineOperationFromFundFlow(fundFlow);

        const networkFee = createMoney(fundFlow.feeAmount, fundFlow.feeCurrency);

        // Convert to UniversalTransaction with enhanced metadata
        const universalTransaction: UniversalTransaction = {
          // Core fields
          id: normalizedTx.id,
          datetime: new Date(normalizedTx.timestamp).toISOString(),
          timestamp: normalizedTx.timestamp,
          source: this.chainConfig.chainName,
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
            platform: undefined, // Cosmos SDK chains have no platform fees
            total: networkFee,
          },

          // Enhanced classification
          operation: classification.operation,

          // Classification uncertainty notes
          note: classification.note,

          // Blockchain metadata
          blockchain: {
            name: this.chainConfig.chainName,
            block_height: normalizedTx.blockHeight,
            transaction_hash: normalizedTx.id,
            is_confirmed: normalizedTx.status === 'success',
          },

          // Minimal metadata - only Cosmos-specific data
          metadata: {
            providerId: normalizedTx.providerId,
            blockId: normalizedTx.blockId,
            bridgeType: fundFlow.bridgeType,
            messageType: normalizedTx.messageType,
            ethereumSender: normalizedTx.ethereumSender,
            ethereumReceiver: normalizedTx.ethereumReceiver,
            eventNonce: normalizedTx.eventNonce,
            sourceChannel: normalizedTx.sourceChannel,
            sourcePort: normalizedTx.sourcePort,
            tokenAddress: fundFlow.primary.tokenAddress,
            tokenType: normalizedTx.tokenType,
            hasBridgeTransfer: fundFlow.hasBridgeTransfer,
            hasIbcTransfer: fundFlow.hasIbcTransfer,
            hasContractInteraction: fundFlow.hasContractInteraction,
          },
        };

        universalTransactions.push(universalTransaction);
      } catch (error) {
        this.logger.warn(`Failed to process normalized transaction ${normalizedTx.id}: ${String(error)}`);
        continue;
      }
    }

    return Promise.resolve(ok(universalTransactions));
  }

  /**
   * Analyze fund flow from normalized CosmosTransaction data
   * Collects ALL assets that move in/out (following EVM pattern)
   */
  private analyzeFundFlowFromNormalized(transaction: CosmosTransaction, userAddress: string): CosmosFundFlow {
    const userAddressLower = userAddress.toLowerCase();
    const fromAddressLower = transaction.from.toLowerCase();
    const toAddressLower = transaction.to.toLowerCase();

    // Analyze transaction type context
    const hasBridgeTransfer = transaction.bridgeType === 'peggy' || transaction.bridgeType === 'ibc';
    const hasIbcTransfer = transaction.bridgeType === 'ibc';
    const hasContractInteraction = Boolean(
      transaction.tokenAddress ||
        transaction.messageType?.includes('wasm') ||
        transaction.messageType?.includes('contract')
    );

    // Collect ALL assets that flow in/out
    const inflows: {
      amount: string;
      asset: string;
      tokenAddress?: string;
      tokenDecimals?: number;
    }[] = [];
    const outflows: {
      amount: string;
      asset: string;
      tokenAddress?: string;
      tokenDecimals?: number;
    }[] = [];

    // Determine flow direction
    const isIncoming = toAddressLower === userAddressLower;
    const isOutgoing = fromAddressLower === userAddressLower;

    // Skip zero amounts
    const amount = transaction.amount;
    const isZero = this.isZero(amount);

    if (!isZero) {
      const asset = transaction.currency || this.chainConfig.nativeCurrency;
      const movement: {
        amount: string;
        asset: string;
        tokenAddress?: string;
        tokenDecimals?: number;
      } = {
        amount,
        asset,
      };

      // Only add optional fields if they have values
      if (transaction.tokenAddress !== undefined) {
        movement.tokenAddress = transaction.tokenAddress;
      }
      if (transaction.tokenDecimals !== undefined) {
        movement.tokenDecimals = transaction.tokenDecimals;
      }

      // For self-transfers (user -> user), track both inflow and outflow
      if (isIncoming && isOutgoing) {
        inflows.push({ ...movement });
        outflows.push({ ...movement });
      } else {
        if (isIncoming) {
          inflows.push(movement);
        }
        if (isOutgoing) {
          outflows.push(movement);
        }
      }
    }

    // Select primary asset (for simplified consumption and single-asset display)
    // Use the transferred asset as primary
    const primary: {
      amount: string;
      asset: string;
      tokenAddress?: string;
      tokenDecimals?: number;
    } = {
      amount: transaction.amount,
      asset: transaction.currency || this.chainConfig.nativeCurrency,
    };

    // Only add optional fields if they have values
    if (transaction.tokenAddress !== undefined) {
      primary.tokenAddress = transaction.tokenAddress;
    }
    if (transaction.tokenDecimals !== undefined) {
      primary.tokenDecimals = transaction.tokenDecimals;
    }

    // Fee information (always in native currency for Cosmos SDK chains)
    const feeAmount = transaction.feeAmount || '0';
    const feeCurrency = transaction.feeCurrency || this.chainConfig.nativeCurrency;

    // Track uncertainty for complex transactions
    let classificationUncertainty: string | undefined;
    if (inflows.length > 1 || outflows.length > 1) {
      classificationUncertainty = `Complex transaction with ${outflows.length} outflow(s) and ${inflows.length} inflow(s). May be multi-asset operation.`;
    }

    const result: CosmosFundFlow = {
      bridgeType: transaction.bridgeType,
      destinationChain: transaction.sourceChannel ? this.chainConfig.chainName : undefined,
      feeAmount,
      feeCurrency,
      fromAddress: transaction.from,
      hasBridgeTransfer,
      hasContractInteraction,
      hasIbcTransfer,
      inflows,
      outflows,
      primary,
      sourceChain: transaction.sourceChannel ? 'ibc' : undefined,
      toAddress: transaction.to,
    };

    // Only add classificationUncertainty if it has a value
    if (classificationUncertainty !== undefined) {
      result.classificationUncertainty = classificationUncertainty;
    }

    return result;
  }

  /**
   * Conservative operation classification with uncertainty tracking.
   * Only classifies patterns we're confident about (9/10 confidence). Complex cases get notes.
   */
  private determineOperationFromFundFlow(fundFlow: CosmosFundFlow): {
    note?:
      | { message: string; metadata?: Record<string, unknown> | undefined; severity: 'info' | 'warning'; type: string }
      | undefined;
    operation: {
      category: 'trade' | 'transfer' | 'staking' | 'defi' | 'fee';
      type: 'buy' | 'sell' | 'deposit' | 'withdrawal' | 'stake' | 'unstake' | 'reward' | 'swap' | 'fee' | 'transfer';
    };
  } {
    const { inflows, outflows } = fundFlow;
    const amount = this.toDecimal(fundFlow.primary.amount).abs();
    const isDustOrZero = amount.isZero() || amount.lessThan(CosmosProcessor.DUST_THRESHOLD);

    // Pattern 1: Contract interaction with zero/dust value
    // Classified as transfer with note (contract call, approval, etc.)
    if (isDustOrZero && fundFlow.hasContractInteraction) {
      return {
        note: {
          message: `Contract interaction with zero/dust value (${fundFlow.primary.amount} ${fundFlow.primary.asset}). May be approval, delegation, or other state change.`,
          metadata: {
            hasContractInteraction: fundFlow.hasContractInteraction,
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
    // Zero/dust amount with NO movements at all
    if (isDustOrZero && inflows.length === 0 && outflows.length === 0) {
      return {
        operation: {
          category: 'fee',
          type: 'fee',
        },
      };
    }

    // Pattern 2b: Dust-amount deposit/withdrawal (still meaningful for accounting)
    if (isDustOrZero) {
      if (outflows.length === 0 && inflows.length >= 1) {
        return {
          note: {
            message: `Dust deposit (${fundFlow.primary.amount} ${fundFlow.primary.asset}). Amount below ${CosmosProcessor.DUST_THRESHOLD} threshold but still affects balance.`,
            metadata: {
              dustThreshold: CosmosProcessor.DUST_THRESHOLD,
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
            message: `Dust withdrawal (${fundFlow.primary.amount} ${fundFlow.primary.asset}). Amount below ${CosmosProcessor.DUST_THRESHOLD} threshold but still affects balance.`,
            metadata: {
              dustThreshold: CosmosProcessor.DUST_THRESHOLD,
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

    // Pattern 3: Bridge deposit (Peggy, Gravity Bridge, or IBC)
    // Receiving funds from another chain
    if (fundFlow.hasBridgeTransfer && outflows.length === 0 && inflows.length >= 1) {
      const bridgeInfo =
        fundFlow.bridgeType === 'peggy'
          ? 'Peggy bridge from Ethereum'
          : fundFlow.bridgeType === 'gravity'
            ? 'Gravity Bridge from Ethereum'
            : 'IBC transfer from another chain';
      return {
        note: {
          message: `Bridge deposit via ${bridgeInfo}.`,
          metadata: {
            bridgeType: fundFlow.bridgeType,
            destinationChain: fundFlow.destinationChain,
            sourceChain: fundFlow.sourceChain,
          },
          severity: 'info',
          type: 'bridge_transfer',
        },
        operation: {
          category: 'transfer',
          type: 'deposit',
        },
      };
    }

    // Pattern 4: Bridge withdrawal (Peggy, Gravity Bridge, or IBC)
    // Sending funds to another chain
    if (fundFlow.hasBridgeTransfer && outflows.length >= 1 && inflows.length === 0) {
      const bridgeInfo =
        fundFlow.bridgeType === 'peggy'
          ? 'Peggy bridge to Ethereum'
          : fundFlow.bridgeType === 'gravity'
            ? 'Gravity Bridge to Ethereum'
            : 'IBC transfer to another chain';
      return {
        note: {
          message: `Bridge withdrawal via ${bridgeInfo}.`,
          metadata: {
            bridgeType: fundFlow.bridgeType,
            destinationChain: fundFlow.destinationChain,
            sourceChain: fundFlow.sourceChain,
          },
          severity: 'info',
          type: 'bridge_transfer',
        },
        operation: {
          category: 'transfer',
          type: 'withdrawal',
        },
      };
    }

    // Pattern 5: Single asset swap
    // One asset out, different asset in (DeFi swap)
    if (outflows.length === 1 && inflows.length === 1) {
      const outAsset = outflows[0]?.asset;
      const inAsset = inflows[0]?.asset;

      if (outAsset !== inAsset) {
        return {
          note: {
            message: `Asset swap: ${outAsset} � ${inAsset}.`,
            metadata: {
              inAsset,
              outAsset,
            },
            severity: 'info',
            type: 'swap',
          },
          operation: {
            category: 'trade',
            type: 'swap',
          },
        };
      }
    }

    // Pattern 6: Simple deposit
    // Only inflows, no outflows
    if (outflows.length === 0 && inflows.length >= 1) {
      return {
        operation: {
          category: 'transfer',
          type: 'deposit',
        },
      };
    }

    // Pattern 7: Simple withdrawal
    // Only outflows, no inflows
    if (outflows.length >= 1 && inflows.length === 0) {
      return {
        operation: {
          category: 'transfer',
          type: 'withdrawal',
        },
      };
    }

    // Pattern 8: Self-transfer
    // Same asset in and out
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

  private isZero(value: string): boolean {
    try {
      return new Decimal(value || '0').isZero();
    } catch {
      return true;
    }
  }

  private toDecimal(value: string): Decimal {
    return new Decimal(value || '0');
  }
}
