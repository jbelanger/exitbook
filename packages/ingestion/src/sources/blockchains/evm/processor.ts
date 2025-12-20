import {
  maskAddress,
  ProviderError,
  type BlockchainProviderManager,
  type EvmChainConfig,
  type EvmTransaction,
} from '@exitbook/blockchain-providers';
import { parseDecimal } from '@exitbook/core';
import { err, okAsync, ok, type Result } from 'neverthrow';

import { BaseTransactionProcessor } from '../../../features/process/base-transaction-processor.js';
import type { ITokenMetadataService } from '../../../features/token-metadata/token-metadata-service.interface.js';
import { looksLikeContractAddress, isMissingMetadata } from '../../../features/token-metadata/token-metadata-utils.js';
import type { ProcessedTransaction, ProcessingContext } from '../../../shared/types/processors.js';

import {
  determineEvmOperationFromFundFlow,
  groupEvmTransactionsByHash,
  analyzeEvmFundFlow,
  selectPrimaryEvmTransaction,
} from './processor-utils.js';

/**
 * Unified EVM transaction processor that applies Avalanche-style transaction correlation
 * to every EVM-compatible chain.
 */
export class EvmTransactionProcessor extends BaseTransactionProcessor {
  // Override to make tokenMetadataService required (guaranteed by factory)
  declare protected readonly tokenMetadataService: ITokenMetadataService;
  private readonly addressInfoCache = new Map<string, boolean>();

  constructor(
    private readonly chainConfig: EvmChainConfig,
    private readonly providerManager: BlockchainProviderManager,
    tokenMetadataService: ITokenMetadataService
  ) {
    super(chainConfig.chainName, tokenMetadataService);
  }

  protected async processInternal(
    normalizedData: unknown[],
    context: ProcessingContext
  ): Promise<Result<ProcessedTransaction[], string>> {
    // Enrich token metadata before processing (required for proper decimal normalization)
    const enrichResult = await this.enrichTokenMetadata(normalizedData as EvmTransaction[]);
    if (enrichResult.isErr()) {
      return err(`Token metadata enrichment failed: ${enrichResult.error.message}`);
    }

    const transactionGroups = groupEvmTransactionsByHash(normalizedData as EvmTransaction[]);

    const accountIsContract = context.primaryAddress ? await this.resolveIsContract(context.primaryAddress) : undefined;

    this.logger.debug(
      `Created ${transactionGroups.size} transaction groups for correlation on ${this.chainConfig.chainName}`
    );

    const transactions: ProcessedTransaction[] = [];
    const processingErrors: { error: string; hash: string; txCount: number }[] = [];

    for (const [hash, txGroup] of transactionGroups) {
      const fundFlowResult = analyzeEvmFundFlow(txGroup, context, this.chainConfig);

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

      const primaryTx = selectPrimaryEvmTransaction(txGroup, fundFlow);
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
      // Record fee entry if:
      // 1. They have ANY outflows (sent funds, swapped, etc.) OR
      // 2. They initiated a contract interaction with no outflows (approval, state change, etc.)
      // Addresses already normalized to lowercase via EvmAddressSchema
      const userInitiatedTransaction = (fundFlow.fromAddress || '') === context.primaryAddress;
      const feePayerMatches = (fundFlow.feePayerAddress || '') === context.primaryAddress;
      let shouldRecordFeeEntry = fundFlow.outflows.length > 0 || userInitiatedTransaction;
      if (accountIsContract === true) {
        shouldRecordFeeEntry = feePayerMatches;
      }

      const universalTransaction: ProcessedTransaction = {
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
          shouldRecordFeeEntry && !parseDecimal(fundFlow.feeAmount).isZero()
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

        notes: classification.notes,

        blockchain: {
          name: this.chainConfig.chainName,
          block_height: primaryTx.blockHeight,
          transaction_hash: primaryTx.id,
          is_confirmed: primaryTx.status === 'success',
        },
      };

      // Scam detection: Check inflows only (scam tokens arrive as airdrops)
      for (const inflow of fundFlow.inflows) {
        // EVM-specific airdrop detection: inflows without outflows and not user-initiated
        const context = {
          amount: parseDecimal(inflow.amount).toNumber(),
          contractAddress: inflow.tokenAddress,
          isAirdrop: fundFlow.outflows.length === 0 && !userInitiatedTransaction,
        };

        const scamNote = await this.detectScamForAsset(inflow.asset, context.contractAddress, {
          amount: context.amount,
          isAirdrop: context.isAirdrop,
        });
        if (scamNote) {
          // Apply scam detection results based on severity
          if (scamNote.severity === 'error') {
            universalTransaction.isSpam = true;
          }
          universalTransaction.notes = [...(universalTransaction.notes || []), scamNote];
          break;
        }
      }

      transactions.push(universalTransaction);
      this.logger.debug(
        `Successfully processed correlated transaction group ${universalTransaction.externalId} (${fundFlow.transactionCount} items)`
      );
    }

    // Log processing summary
    const failedGroups = processingErrors.length;
    const lostTransactionCount = processingErrors.reduce((sum, e) => sum + e.txCount, 0);

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

  private async resolveIsContract(address: string): Promise<boolean | undefined> {
    const cached = this.addressInfoCache.get(address);
    if (cached !== undefined) {
      return cached;
    }

    const result = await this.providerManager.executeWithFailoverOnce<{ code: string; isContract: boolean }>(
      this.chainConfig.chainName,
      {
        type: 'getAddressInfo',
        address,
        getCacheKey: (params) =>
          `getAddressInfo:${this.chainConfig.chainName}:${(params as { address: string }).address}`,
      }
    );

    if (result.isErr()) {
      const error = result.error;
      if (error instanceof ProviderError) {
        this.logger.warn(
          { address: maskAddress(address), code: error.code, error: error.message },
          'Failed to resolve address type for fee attribution'
        );
      } else {
        this.logger.warn(
          { address: maskAddress(address), error },
          'Failed to resolve address type for fee attribution'
        );
      }
      return undefined;
    }

    const isContract = result.value.data.isContract;
    this.addressInfoCache.set(address, isContract);
    return isContract;
  }
}
