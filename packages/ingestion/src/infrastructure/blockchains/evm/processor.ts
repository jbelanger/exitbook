import type { UniversalTransaction } from '@exitbook/core';
import { parseDecimal } from '@exitbook/core';
import type { ITransactionRepository } from '@exitbook/data';
import type { EvmChainConfig, EvmTransaction } from '@exitbook/providers';
import { normalizeNativeAmount, normalizeTokenAmount } from '@exitbook/providers';
import type { Decimal } from 'decimal.js';
import { err, ok, type Result } from 'neverthrow';

import type { ITokenMetadataService } from '../../../services/token-metadata/token-metadata-service.interface.ts';
import { looksLikeContractAddress, needsEnrichment } from '../../../services/token-metadata/token-metadata-utils.ts';
import { BaseTransactionProcessor } from '../../shared/processors/base-transaction-processor.ts';

import type { EvmFundFlow } from './types.ts';

/**
 * Unified EVM transaction processor that applies Avalanche-style transaction correlation
 * to every EVM-compatible chain.
 */
export class EvmTransactionProcessor extends BaseTransactionProcessor {
  constructor(
    private readonly chainConfig: EvmChainConfig,
    private readonly tokenMetadataService: ITokenMetadataService,
    private readonly _transactionRepository?: ITransactionRepository
  ) {
    super(chainConfig.chainName);
  }

  protected async processInternal(
    normalizedData: unknown[],
    sessionMetadata?: Record<string, unknown>
  ): Promise<Result<UniversalTransaction[], string>> {
    if (!sessionMetadata) {
      return err('Missing session metadata for normalized processing');
    }

    const userAddress = sessionMetadata.address;
    if (!userAddress || typeof userAddress !== 'string') {
      return err('Missing user address in session metadata');
    }

    this.logger.info(`Processing ${normalizedData.length} normalized ${this.chainConfig.chainName} transactions`);

    // Enrich token metadata before processing (required for proper decimal normalization)
    const enrichResult = await this.enrichTokenMetadata(normalizedData as EvmTransaction[]);
    if (enrichResult.isErr()) {
      return err(`Token metadata enrichment failed: ${enrichResult.error.message}`);
    }

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

      // Only include fees if user initiated the transaction (they paid the fee)
      // For incoming-only transactions (deposits, received transfers), the sender paid the fee
      // User paid fee if:
      // 1. They have ANY outflows (sent funds, swapped, etc.) OR
      // 2. They initiated a contract interaction with no outflows (approval, state change, etc.)
      // Addresses already normalized to lowercase via EvmAddressSchema
      const userInitiatedTransaction = (fundFlow.fromAddress || '') === userAddress;
      const userPaidFee = fundFlow.outflows.length > 0 || userInitiatedTransaction;

      const networkFee = userPaidFee
        ? { amount: parseDecimal(fundFlow.feeAmount), asset: fundFlow.feeCurrency }
        : { amount: parseDecimal('0'), asset: fundFlow.feeCurrency };

      const universalTransaction: UniversalTransaction = {
        id: 0, // Will be assigned by database
        externalId: primaryTx.id,
        datetime: new Date(primaryTx.timestamp).toISOString(),
        timestamp: primaryTx.timestamp,
        source: this.chainConfig.chainName,
        status: primaryTx.status,
        from: fundFlow.fromAddress || primaryTx.from,
        to: fundFlow.toAddress || primaryTx.to,

        // Structured movements from fund flow analysis
        movements: {
          inflows: fundFlow.inflows.map((inflow) => ({
            amount: parseDecimal(inflow.amount),
            asset: inflow.asset,
          })),
          outflows: fundFlow.outflows.map((outflow) => ({
            amount: parseDecimal(outflow.amount),
            asset: outflow.asset,
          })),
        },

        fees: {
          network: networkFee,
          platform: undefined, // EVM chains have no platform fees
        },

        operation: classification.operation,

        note: classification.note,

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
        `Successfully processed correlated transaction group ${universalTransaction.externalId} (${fundFlow.transactionCount} items)`
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
    sessionMetadata: Record<string, unknown>
  ): Result<EvmFundFlow, string> {
    if (txGroup.length === 0) {
      return err('Empty transaction group');
    }

    if (!sessionMetadata.address || typeof sessionMetadata.address !== 'string') {
      return err('Missing user address in session metadata');
    }

    // Address already normalized to lowercase via EvmAddressSchema
    const userAddress = sessionMetadata.address;

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
    let toAddress: string | undefined = '';

    // Process all token transfers involving the user
    for (const tx of txGroup) {
      if (tx.type === 'token_transfer' && this.isUserParticipant(tx, userAddress)) {
        const tokenSymbol = tx.tokenSymbol || tx.currency || 'UNKNOWN';
        const rawAmount = tx.amount ?? '0';

        // Normalize token amount using decimals metadata
        // All providers return amounts in smallest units; normalization ensures consistency and safety
        const amount = normalizeTokenAmount(rawAmount, tx.tokenDecimals);

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
        const normalizedAmount = normalizeNativeAmount(tx.amount, this.chainConfig.nativeDecimals);

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
          existing.amount = existing.amount.plus(parseDecimal(movement.amount));
        } else {
          const entry: { amount: Decimal; tokenAddress?: string; tokenDecimals?: number } = {
            amount: parseDecimal(movement.amount),
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
          amount: data.amount.toFixed(),
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

    // Select primary asset for simplified consumption and single-asset display
    // Prioritizes largest movement to provide a meaningful summary of complex multi-asset transactions
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
          return parseDecimal(b.amount).comparedTo(parseDecimal(a.amount));
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
            return parseDecimal(b.amount).comparedTo(parseDecimal(a.amount));
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

    // Get fee from the parent transaction (NOT from token_transfer events)
    // A single on-chain transaction has only ONE fee, but providers may duplicate it across
    // the parent transaction and child events (token transfers, internal calls).
    // We take the fee from the first non-token_transfer transaction to avoid double-counting.
    const parentTx = txGroup.find((tx) => tx.type !== 'token_transfer') || txGroup[0];
    const feeWei = parentTx?.feeAmount ? parseDecimal(parentTx.feeAmount) : parseDecimal('0');
    const feeAmount = feeWei.dividedBy(parseDecimal('10').pow(this.chainConfig.nativeDecimals)).toFixed();

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
   * Conservative operation classification based purely on fund flow structure.
   * Only classifies patterns we're confident about. Complex cases get notes.
   */
  private determineOperationFromFundFlow(fundFlow: EvmFundFlow): {
    note?:
      | { message: string; metadata?: Record<string, unknown> | undefined; severity: 'info' | 'warning'; type: string }
      | undefined;
    operation: { category: 'trade' | 'transfer' | 'fee'; type: 'swap' | 'deposit' | 'withdrawal' | 'transfer' | 'fee' };
  } {
    const { inflows, outflows } = fundFlow;
    const amount = parseDecimal(fundFlow.primary.amount || '0').abs();
    const isZero = amount.isZero();

    // Pattern 1: Contract interaction with zero value
    // Approvals, staking operations, state changes - classified as transfer with note
    if (isZero && (fundFlow.hasContractInteraction || fundFlow.hasTokenTransfers)) {
      return {
        note: {
          message: `Contract interaction with zero value. May be approval, staking, or other state change.`,
          metadata: {
            hasContractInteraction: fundFlow.hasContractInteraction,
            hasTokenTransfers: fundFlow.hasTokenTransfers,
          },
          severity: 'info',
          type: 'contract_interaction',
        },
        operation: {
          category: 'transfer',
          type: 'transfer',
        },
      };
    }

    // Pattern 2: Fee-only transaction
    // Zero value with NO fund movements at all
    if (isZero && inflows.length === 0 && outflows.length === 0) {
      return {
        operation: {
          category: 'fee',
          type: 'fee',
        },
      };
    }

    // Pattern 3: Single asset swap
    // One asset out, different asset in
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

    // Pattern 4: Simple deposit
    // Only inflows, no outflows (can be multiple assets)
    if (outflows.length === 0 && inflows.length >= 1) {
      return {
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

  // Addresses already normalized to lowercase via EvmAddressSchema
  private matchesAddress(address: string | undefined, target: string): boolean {
    return address ? address === target : false;
  }

  private isUserParticipant(tx: EvmTransaction, userAddress: string): boolean {
    return this.matchesAddress(tx.from, userAddress) || this.matchesAddress(tx.to, userAddress);
  }

  private isNativeMovement(tx: EvmTransaction): boolean {
    const native = this.chainConfig.nativeCurrency.toLowerCase();
    return tx.currency.toLowerCase() === native || (tx.tokenSymbol ? tx.tokenSymbol.toLowerCase() === native : false);
  }

  private isZero(value: string): boolean {
    try {
      return parseDecimal(value || '0').isZero();
    } catch {
      return true;
    }
  }

  /**
   * Enrich token metadata for all transactions.
   * Only fetches metadata for symbols that look like contract addresses.
   */
  private async enrichTokenMetadata(transactions: EvmTransaction[]): Promise<Result<void, Error>> {
    // Collect all token transfers that need enrichment
    const transactionsToEnrich = transactions.filter((tx) => {
      if (tx.type !== 'token_transfer' || !tx.tokenAddress) {
        return false;
      }

      const symbol = tx.tokenSymbol || tx.currency;
      // Enrich if metadata is incomplete OR if symbol looks like a contract address (EVM = 40 chars)
      return needsEnrichment(symbol, tx.tokenDecimals) || (symbol ? looksLikeContractAddress(symbol, 40) : false);
    });

    if (transactionsToEnrich.length === 0) {
      return ok();
    }

    this.logger.debug(`Enriching token metadata for ${transactionsToEnrich.length} token transfers`);

    // Use the token metadata service to enrich with caching and provider fetching
    const enrichResult = await this.tokenMetadataService.enrichBatch(
      transactionsToEnrich,
      this.chainConfig.chainName,
      (tx) => tx.tokenAddress,
      (tx, metadata) => {
        if (metadata.symbol) {
          tx.currency = metadata.symbol;
          tx.tokenSymbol = metadata.symbol;
        }
        // Update decimals if available and not already set
        if (metadata.decimals !== undefined && tx.tokenDecimals === undefined) {
          this.logger.debug(
            `Updating decimals for ${tx.tokenAddress} from ${tx.tokenDecimals} to ${metadata.decimals}`
          );
          tx.tokenDecimals = metadata.decimals;
        }
      },
      (tx) => tx.tokenDecimals !== undefined // Enrichment failure OK if decimals already present
    );

    if (enrichResult.isErr()) {
      return err(enrichResult.error);
    }

    this.logger.debug('Successfully enriched token metadata from cache/provider');
    return ok();
  }
}
