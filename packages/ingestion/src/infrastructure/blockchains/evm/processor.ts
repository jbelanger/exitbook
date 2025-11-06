import type { UniversalTransaction } from '@exitbook/core';
import { parseDecimal } from '@exitbook/core';
import type { ITransactionRepository } from '@exitbook/data';
import type { EvmChainConfig, EvmTransaction } from '@exitbook/providers';
import { normalizeNativeAmount, normalizeTokenAmount } from '@exitbook/providers';
import { err, okAsync, ok, type Result } from 'neverthrow';

import type { ITokenMetadataService } from '../../../services/token-metadata/token-metadata-service.interface.ts';
import { looksLikeContractAddress, isMissingMetadata } from '../../../services/token-metadata/token-metadata-utils.ts';
import { BaseTransactionProcessor } from '../../shared/processors/base-transaction-processor.ts';

import {
  consolidateEvmMovementsByAsset,
  selectPrimaryEvmMovement,
  determineEvmOperationFromFundFlow,
} from './processor-utils.ts';
import type { EvmFundFlow, EvmMovement } from './types.ts';

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

    // Normalize address to lowercase for consistency with transaction addresses
    const normalizedUserAddress = userAddress.toLowerCase();

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
      // Pass normalized address in metadata for consistent comparison
      const normalizedMetadata = { ...sessionMetadata, address: normalizedUserAddress };
      const fundFlowResult = this.analyzeFundFlowFromNormalized(txGroup, normalizedMetadata);

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
      const classification = determineEvmOperationFromFundFlow(fundFlow);

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
      const userInitiatedTransaction = (fundFlow.fromAddress || '') === normalizedUserAddress;
      const userPaidFee = fundFlow.outflows.length > 0 || userInitiatedTransaction;

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
          userPaidFee && !parseDecimal(fundFlow.feeAmount).isZero()
            ? [
                {
                  asset: fundFlow.feeCurrency,
                  amount: parseDecimal(fundFlow.feeAmount),
                  scope: 'network',
                  settlement: 'balance',
                },
              ]
            : [],

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

    return okAsync(transactions);
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

    // Address should already be normalized by caller
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
    const inflows: EvmMovement[] = [];
    const outflows: EvmMovement[] = [];

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
          const movement: EvmMovement = {
            amount,
            asset: tokenSymbol,
            tokenAddress: tx.tokenAddress,
            tokenDecimals: tx.tokenDecimals,
          };
          inflows.push(movement);
          outflows.push({ ...movement });
        } else {
          if (toMatches) {
            // User received this token
            const inflow: EvmMovement = {
              amount,
              asset: tokenSymbol,
              tokenAddress: tx.tokenAddress,
              tokenDecimals: tx.tokenDecimals,
            };
            inflows.push(inflow);
          }

          if (fromMatches) {
            // User sent this token
            const outflow: EvmMovement = {
              amount,
              asset: tokenSymbol,
              tokenAddress: tx.tokenAddress,
              tokenDecimals: tx.tokenDecimals,
            };
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
    const consolidatedInflows = consolidateEvmMovementsByAsset(inflows);
    const consolidatedOutflows = consolidateEvmMovementsByAsset(outflows);

    // Select primary asset for simplified consumption and single-asset display
    // Prioritizes largest movement to provide a meaningful summary of complex multi-asset transactions
    const primaryFromInflows = selectPrimaryEvmMovement(consolidatedInflows, {
      nativeCurrency: this.chainConfig.nativeCurrency,
    });

    const primary: EvmMovement =
      primaryFromInflows && !this.isZero(primaryFromInflows.amount)
        ? primaryFromInflows
        : selectPrimaryEvmMovement(consolidatedOutflows, {
            nativeCurrency: this.chainConfig.nativeCurrency,
          }) || {
            asset: this.chainConfig.nativeCurrency,
            amount: '0',
          };

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
      return isMissingMetadata(symbol, tx.tokenDecimals) || (symbol ? looksLikeContractAddress(symbol, 40) : false);
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
