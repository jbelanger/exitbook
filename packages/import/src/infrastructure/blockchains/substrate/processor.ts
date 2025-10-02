import type { ImportSessionMetadata } from '@exitbook/import/app/ports/transaction-processor.interface.ts';
import type { ITransactionRepository } from '@exitbook/import/app/ports/transaction-repository.js';
import type { UniversalTransaction } from '@exitbook/import/domain/universal-transaction.ts';
import { createMoney } from '@exitbook/shared-utils';
import { Decimal } from 'decimal.js';
import { type Result, err, ok } from 'neverthrow';

import { BaseTransactionProcessor } from '../../shared/processors/base-transaction-processor.ts';

import type { SubstrateChainConfig } from './chain-config.interface.js';
import type { SubstrateFundFlow, SubstrateTransaction } from './types.js';
import { derivePolkadotAddressVariants } from './utils.js';

/**
 * Generic Substrate transaction processor that converts raw blockchain transaction data
 * into UniversalTransaction format. Supports Polkadot, Kusama, Bittensor, and other
 * Substrate-based chains. Uses ProcessorFactory to dispatch to provider-specific
 * processors based on data provenance.
 */
export class SubstrateProcessor extends BaseTransactionProcessor {
  private chainConfig: SubstrateChainConfig;

  constructor(
    chainConfig: SubstrateChainConfig,
    private _transactionRepository?: ITransactionRepository
  ) {
    super(chainConfig.chainName);
    this.chainConfig = chainConfig;
  }

  /**
   * Process normalized SubstrateTransaction data with sophisticated fund flow analysis
   */
  protected async processInternal(
    normalizedData: unknown[],
    sessionMetadata?: ImportSessionMetadata
  ): Promise<Result<UniversalTransaction[], string>> {
    if (!sessionMetadata?.address) {
      return err('Missing session address in metadata for Substrate processing');
    }

    const sessionContext = this.enrichSessionContext(sessionMetadata.address);
    const transactions: UniversalTransaction[] = [];

    for (const item of normalizedData) {
      const normalizedTx = item as SubstrateTransaction;
      try {
        const fundFlow = this.analyzeFundFlowFromNormalized(normalizedTx, sessionContext);
        const classification = this.determineOperationFromFundFlow(fundFlow, normalizedTx);

        // Calculate direction for primary asset
        const hasInflow = fundFlow.inflows.some((i) => i.asset === fundFlow.primary.asset);
        const hasOutflow = fundFlow.outflows.some((o) => o.asset === fundFlow.primary.asset);
        const direction: 'in' | 'out' | 'neutral' =
          hasInflow && hasOutflow ? 'neutral' : hasInflow ? 'in' : hasOutflow ? 'out' : 'neutral';

        const universalTransaction: UniversalTransaction = {
          // NEW: Structured fields
          movements: {
            inflows: fundFlow.inflows.map((i) => ({
              amount: createMoney(i.amount, i.asset),
              asset: i.asset,
            })),
            outflows: fundFlow.outflows.map((o) => ({
              amount: createMoney(o.amount, o.asset),
              asset: o.asset,
            })),
            primary: {
              amount: createMoney(fundFlow.primary.amount, fundFlow.primary.asset),
              asset: fundFlow.primary.asset,
              direction,
            },
          },
          fees: {
            network: createMoney(fundFlow.feeAmount, fundFlow.feeCurrency),
            platform: undefined,
            total: createMoney(fundFlow.feeAmount, fundFlow.feeCurrency),
          },
          operation: classification.operation,
          blockchain: {
            name: fundFlow.chainName,
            block_height: normalizedTx.blockHeight,
            transaction_hash: normalizedTx.id,
            is_confirmed: normalizedTx.status === 'success',
          },
          note: classification.note,

          // Core fields
          id: normalizedTx.id,
          datetime: new Date(normalizedTx.timestamp).toISOString(),
          timestamp: normalizedTx.timestamp,
          source: 'substrate',
          status: normalizedTx.status === 'success' ? 'ok' : 'failed',
          from: fundFlow.fromAddress,
          to: fundFlow.toAddress,

          metadata: {
            blockchain: 'substrate',
            blockHeight: normalizedTx.blockHeight,
            blockId: normalizedTx.blockId,
            call: fundFlow.call,
            chainName: fundFlow.chainName,
            module: fundFlow.module,
            providerId: normalizedTx.providerId,
          },
        };

        transactions.push(universalTransaction);

        this.logger.debug(
          `Processed Substrate transaction ${normalizedTx.id} - ` +
            `Operation: ${classification.operation.category}/${classification.operation.type}, ` +
            `Primary: ${fundFlow.primary.amount} ${fundFlow.primary.asset} (${direction}), ` +
            `Chain: ${fundFlow.chainName}`
        );
      } catch (error) {
        this.logger.warn(`Failed to process normalized transaction ${normalizedTx.id}: ${String(error)}`);
        continue;
      }
    }

    return Promise.resolve(ok(transactions));
  }

  /**
   * Enrich session context with SS58 address variants for better transaction matching.
   * Similar to Bitcoin's derived address approach but for Substrate/Polkadot ecosystem.
   */
  protected enrichSessionContext(address: string): ImportSessionMetadata {
    if (!address) {
      throw new Error('Missing session address in metadata for Polkadot processing');
    }

    // Generate SS58 address variants for all addresses
    const allDerivedAddresses: string[] = [];

    const variants = derivePolkadotAddressVariants(address);
    allDerivedAddresses.push(...variants);

    // Remove duplicates
    const uniqueDerivedAddresses = Array.from(new Set(allDerivedAddresses));

    this.logger.info(
      `Enriched Polkadot session context - Original address: ${address}, ` +
        `SS58 variants generated: ${uniqueDerivedAddresses.length}`
    );

    return {
      address: address,
      derivedAddresses: uniqueDerivedAddresses,
    };
  }

  /**
   * Analyze fund flow from normalized Substrate transaction data
   * Following EVM's comprehensive asset collection approach
   */
  private analyzeFundFlowFromNormalized(
    transaction: SubstrateTransaction,
    sessionContext: ImportSessionMetadata
  ): SubstrateFundFlow {
    const userAddresses = new Set(sessionContext.derivedAddresses || [sessionContext.address]);

    const isFromUser = userAddresses.has(transaction.from);
    const isToUser = userAddresses.has(transaction.to);

    // Analyze transaction characteristics
    const hasStaking =
      transaction.module === 'staking' ||
      transaction.call?.includes('bond') ||
      transaction.call?.includes('nominate') ||
      transaction.call?.includes('unbond') ||
      transaction.call?.includes('withdraw');

    const hasGovernance =
      transaction.module === 'democracy' ||
      transaction.module === 'council' ||
      transaction.module === 'treasury' ||
      transaction.module === 'phragmenElection';

    const hasUtilityBatch = transaction.module === 'utility' && transaction.call?.includes('batch');
    const hasProxy = transaction.module === 'proxy';
    const hasMultisig = transaction.module === 'multisig';

    // Collect ALL asset movements (most Substrate transactions are single-asset, but support multi-asset)
    const inflows: { amount: string; asset: string }[] = [];
    const outflows: { amount: string; asset: string }[] = [];

    const amount = new Decimal(transaction.amount);
    const normalizedAmount = this.normalizeAmount(transaction.amount);
    const currency = transaction.currency;

    // Skip zero amounts (but NOT fees)
    const isZeroAmount = amount.isZero();

    // Collect movements based on fund flow direction
    if (isFromUser && isToUser) {
      // Self-transfer: same asset in and out (net zero for asset, only fee affects balance)
      if (!isZeroAmount) {
        inflows.push({ amount: normalizedAmount, asset: currency });
        outflows.push({ amount: normalizedAmount, asset: currency });
      }
    } else if (isToUser && !isZeroAmount) {
      // User received funds
      inflows.push({ amount: normalizedAmount, asset: currency });
    } else if (isFromUser && !isZeroAmount) {
      // User sent funds
      outflows.push({ amount: normalizedAmount, asset: currency });
    }

    // Determine primary asset (for simplified consumption and single-asset display)
    let primaryAmount: string;
    let primaryAsset: string;

    if (outflows.length > 0) {
      // Primary is what user sent
      primaryAmount = outflows[0]!.amount;
      primaryAsset = outflows[0]!.asset;
    } else if (inflows.length > 0) {
      // Primary is what user received
      primaryAmount = inflows[0]!.amount;
      primaryAsset = inflows[0]!.asset;
    } else {
      // No movements (fee-only transaction)
      primaryAmount = '0';
      primaryAsset = currency;
    }

    // Track uncertainty for complex transactions
    let classificationUncertainty: string | undefined;
    if (hasUtilityBatch && transaction.events && transaction.events.length > 5) {
      classificationUncertainty = `Utility batch with ${transaction.events.length} events. May contain multiple operations that need separate accounting.`;
    }

    return {
      call: transaction.call || 'unknown',
      chainName: transaction.chainName || 'unknown',
      classificationUncertainty,
      eventCount: transaction.events?.length || 0,
      extrinsicCount: hasUtilityBatch ? 1 : 1, // TODO: Parse batch details if needed
      feeAmount: this.normalizeAmount(transaction.feeAmount),
      feeCurrency: transaction.feeCurrency || transaction.currency,
      fromAddress: transaction.from,
      hasGovernance: hasGovernance || false,
      hasMultisig: hasMultisig || false,
      hasProxy: hasProxy || false,
      hasStaking: hasStaking || false,
      hasUtilityBatch: hasUtilityBatch || false,
      inflows,
      module: transaction.module || 'unknown',
      outflows,
      primary: {
        amount: primaryAmount,
        asset: primaryAsset,
      },
      toAddress: transaction.to,
    };
  }

  /**
   * Conservative operation classification with uncertainty tracking.
   * Following EVM's 9/10 confidence approach, with Substrate-specific patterns first.
   */
  private determineOperationFromFundFlow(
    fundFlow: SubstrateFundFlow,
    transaction: SubstrateTransaction
  ): {
    note?:
      | { message: string; metadata?: Record<string, unknown> | undefined; severity: 'info' | 'warning'; type: string }
      | undefined;
    operation: {
      category: 'staking' | 'governance' | 'transfer' | 'fee';
      type:
        | 'stake'
        | 'unstake'
        | 'reward'
        | 'vote'
        | 'proposal'
        | 'refund'
        | 'deposit'
        | 'withdrawal'
        | 'transfer'
        | 'fee';
    };
  } {
    const { inflows, outflows } = fundFlow;
    const amount = new Decimal(fundFlow.primary.amount || '0').abs();
    const isZeroAmount = amount.isZero();

    // Pattern 1: Staking operations (9/10 confident)
    if (fundFlow.hasStaking) {
      // Unbond and withdraw are always withdrawals, regardless of flow direction
      if (transaction.call?.includes('unbond') || transaction.call?.includes('withdraw')) {
        return {
          operation: {
            category: 'staking',
            type: 'unstake',
          },
        };
      }

      // Bond operations - check flow direction
      if (transaction.call?.includes('bond')) {
        if (outflows.length > 0) {
          return {
            operation: {
              category: 'staking',
              type: 'stake',
            },
          };
        } else {
          // Incoming bond (reward)
          return {
            operation: {
              category: 'staking',
              type: 'reward',
            },
          };
        }
      }

      // Nominate and chill are staking operations (no funds move)
      if (transaction.call?.includes('nominate') || transaction.call?.includes('chill')) {
        return {
          note: {
            message: `Staking operation (${transaction.call}) with no fund movement. Changes validator selection but doesn't affect balance.`,
            metadata: {
              call: transaction.call,
              module: fundFlow.module,
            },
            severity: 'info',
            type: 'staking_operation',
          },
          operation: {
            category: 'staking',
            type: 'stake',
          },
        };
      }

      // Default staking behavior based on fund flow
      if (outflows.length > 0) {
        return {
          operation: {
            category: 'staking',
            type: 'stake',
          },
        };
      } else if (inflows.length > 0) {
        return {
          operation: {
            category: 'staking',
            type: 'reward',
          },
        };
      }

      // Staking transaction with no movements (fee-only)
      return {
        note: {
          message: `Staking transaction with no asset movement. Fee-only staking operation.`,
          metadata: {
            feeAmount: fundFlow.feeAmount,
            feeCurrency: fundFlow.feeCurrency,
          },
          severity: 'info',
          type: 'fee_only_staking',
        },
        operation: {
          category: 'staking',
          type: 'stake',
        },
      };
    }

    // Pattern 2: Governance operations (9/10 confident)
    if (fundFlow.hasGovernance) {
      if (outflows.length > 0) {
        return {
          operation: {
            category: 'governance',
            type: transaction.call?.includes('propose') ? 'proposal' : 'vote',
          },
        };
      } else if (inflows.length > 0) {
        return {
          operation: {
            category: 'governance',
            type: 'refund',
          },
        };
      }
    }

    // Pattern 3: Utility batch (complex - add uncertainty note)
    if (fundFlow.hasUtilityBatch) {
      return {
        note: {
          message:
            fundFlow.classificationUncertainty ||
            `Utility batch transaction with ${fundFlow.eventCount} events. May contain multiple operations.`,
          metadata: {
            eventCount: fundFlow.eventCount,
            inflows: inflows.map((i) => ({ amount: i.amount, asset: i.asset })),
            outflows: outflows.map((o) => ({ amount: o.amount, asset: o.asset })),
          },
          severity: 'warning',
          type: 'utility_batch',
        },
        operation: {
          category: 'transfer',
          type: 'transfer',
        },
      };
    }

    // Pattern 4: Proxy operations (add note)
    if (fundFlow.hasProxy) {
      return {
        note: {
          message: `Proxy transaction. User authorized another account to perform operations.`,
          metadata: {
            call: fundFlow.call,
            module: fundFlow.module,
          },
          severity: 'info',
          type: 'proxy_operation',
        },
        operation: {
          category: 'transfer',
          type: 'transfer',
        },
      };
    }

    // Pattern 5: Multisig operations (add note)
    if (fundFlow.hasMultisig) {
      return {
        note: {
          message: `Multisig transaction. Requires multiple signatures to execute.`,
          metadata: {
            call: fundFlow.call,
            module: fundFlow.module,
          },
          severity: 'info',
          type: 'multisig_operation',
        },
        operation: {
          category: 'transfer',
          type: 'transfer',
        },
      };
    }

    // Pattern 6: Fee-only transaction (no asset movements)
    if (isZeroAmount && inflows.length === 0 && outflows.length === 0) {
      return {
        operation: {
          category: 'fee',
          type: 'fee',
        },
      };
    }

    // Pattern 7: Simple deposit (only inflows)
    if (outflows.length === 0 && inflows.length >= 1) {
      return {
        operation: {
          category: 'transfer',
          type: 'deposit',
        },
      };
    }

    // Pattern 8: Simple withdrawal (only outflows)
    if (outflows.length >= 1 && inflows.length === 0) {
      return {
        operation: {
          category: 'transfer',
          type: 'withdrawal',
        },
      };
    }

    // Pattern 9: Self-transfer (same asset in and out)
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

    // Pattern 10: Unknown/complex transaction
    return {
      note: {
        message: `Unable to classify transaction with confidence. Module: ${fundFlow.module}, Call: ${fundFlow.call}`,
        metadata: {
          call: fundFlow.call,
          inflows: inflows.map((i) => ({ amount: i.amount, asset: i.asset })),
          module: fundFlow.module,
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
   * Normalize amount from planck (or smallest unit) to token units using chain-specific decimals
   * Similar to EVM's wei-to-ETH normalization
   */
  private normalizeAmount(amountPlanck: string | undefined): string {
    if (!amountPlanck || amountPlanck === '0') {
      return '0';
    }

    try {
      return new Decimal(amountPlanck).dividedBy(new Decimal(10).pow(this.chainConfig.nativeDecimals)).toString();
    } catch (error) {
      this.logger.warn(`Unable to normalize amount: ${String(error)}`);
      return '0';
    }
  }
}
