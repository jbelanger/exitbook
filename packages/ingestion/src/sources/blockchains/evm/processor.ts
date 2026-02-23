import {
  maskAddress,
  ProviderError,
  type BlockchainProviderManager,
  type EvmChainConfig,
  type EvmTransaction,
  EvmTransactionSchema,
} from '@exitbook/blockchain-providers';
import {
  buildBlockchainNativeAssetId,
  buildBlockchainTokenAssetId,
  parseDecimal,
  type Currency,
  type TokenMetadataRecord,
} from '@exitbook/core';
import { err, okAsync, ok, type Result } from 'neverthrow';

import { BaseTransactionProcessor } from '../../../features/process/base-transaction-processor.js';
import type {
  IScamDetectionService,
  MovementWithContext,
} from '../../../features/scam-detection/scam-detection-service.interface.js';
import type { ITokenMetadataService } from '../../../features/token-metadata/token-metadata-service.interface.js';
import { looksLikeContractAddress } from '../../../features/token-metadata/token-metadata-utils.js';
import type { ProcessedTransaction, AddressContext } from '../../../shared/types/processors.js';

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
export class EvmTransactionProcessor extends BaseTransactionProcessor<EvmTransaction> {
  // Override to make tokenMetadataService required (guaranteed by factory)
  declare protected readonly tokenMetadataService: ITokenMetadataService;
  private readonly contractAddressCache = new Map<string, boolean>();

  constructor(
    private readonly chainConfig: EvmChainConfig,
    private readonly providerManager: BlockchainProviderManager,
    tokenMetadataService: ITokenMetadataService,
    scamDetectionService?: IScamDetectionService
  ) {
    super(chainConfig.chainName, tokenMetadataService, scamDetectionService);
  }

  protected get inputSchema() {
    return EvmTransactionSchema;
  }

  protected async transformNormalizedData(
    normalizedData: EvmTransaction[],
    context: AddressContext
  ): Promise<Result<ProcessedTransaction[], string>> {
    // Enrich token metadata before processing (required for proper decimal normalization)
    const enrichResult = await this.enrichTokenMetadata(normalizedData);
    if (enrichResult.isErr()) {
      return err(`Token metadata enrichment failed: ${enrichResult.error.message}`);
    }

    const transactionGroups = groupEvmTransactionsByHash(normalizedData);

    const accountIsContract = context.primaryAddress ? await this.resolveIsContract(context.primaryAddress) : undefined;

    this.logger.debug(
      `Created ${transactionGroups.size} transaction groups for correlation on ${this.chainConfig.chainName}`
    );

    const transactions: ProcessedTransaction[] = [];
    const processingErrors: { error: string; hash: string; txCount: number }[] = [];
    const tokenMovementsForScamDetection: MovementWithContext[] = [];

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
      const classification = determineEvmOperationFromFundFlow(fundFlow, txGroup);

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

      // Build movements with assetId
      const inflowsResult = this.buildMovements(fundFlow.inflows, hash, 'inflow');
      if (inflowsResult.isErr()) {
        processingErrors.push({ error: inflowsResult.error, hash, txCount: txGroup.length });
        this.logger.error(
          `${inflowsResult.error} for ${this.chainConfig.chainName} transaction ${hash} - THIS TRANSACTION GROUP WILL BE LOST`
        );
        continue;
      }

      const outflowsResult = this.buildMovements(fundFlow.outflows, hash, 'outflow');
      if (outflowsResult.isErr()) {
        processingErrors.push({ error: outflowsResult.error, hash, txCount: txGroup.length });
        this.logger.error(
          `${outflowsResult.error} for ${this.chainConfig.chainName} transaction ${hash} - THIS TRANSACTION GROUP WILL BE LOST`
        );
        continue;
      }

      const inflows = inflowsResult.value;
      const outflows = outflowsResult.value;

      // Build fee assetId (always native asset for EVM)
      const feeAssetIdResult = buildBlockchainNativeAssetId(this.chainConfig.chainName);
      if (feeAssetIdResult.isErr()) {
        const errorMsg = `Failed to build fee assetId: ${feeAssetIdResult.error.message}`;
        processingErrors.push({ error: errorMsg, hash, txCount: txGroup.length });
        this.logger.error(
          `${errorMsg} for ${this.chainConfig.chainName} transaction ${hash} - THIS TRANSACTION GROUP WILL BE LOST`
        );
        continue;
      }
      const feeAssetId = feeAssetIdResult.value;

      const processedTransaction: ProcessedTransaction = {
        externalId: primaryTx.id,
        datetime: new Date(primaryTx.timestamp).toISOString(),
        timestamp: primaryTx.timestamp,
        source: this.chainConfig.chainName,
        sourceType: 'blockchain',
        status: primaryTx.status,
        from: fundFlow.fromAddress || primaryTx.from,
        to: fundFlow.toAddress || primaryTx.to,

        // Structured movements from fund flow analysis
        movements: {
          inflows,
          outflows,
        },

        fees:
          shouldRecordFeeEntry && !parseDecimal(fundFlow.feeAmount).isZero()
            ? [
                {
                  assetId: feeAssetId,
                  assetSymbol: fundFlow.feeCurrency,
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

      // Drop zero-impact transactions: no movements and no fees means nothing to record.
      // Common case: zero-value incoming ETH transfers (spam/dust) where user didn't initiate.
      const hasMovements = inflows.length > 0 || outflows.length > 0;
      if (!hasMovements && processedTransaction.fees.length === 0) {
        this.logger.debug(
          `Dropping zero-impact transaction ${hash} on ${this.chainConfig.chainName} (no movements, no fees)`
        );
        continue;
      }

      // Collect token movements for batch scam detection later
      const allMovements = [...fundFlow.inflows, ...fundFlow.outflows];
      const isAirdrop = fundFlow.outflows.length === 0 && !userInitiatedTransaction;

      for (const movement of allMovements) {
        if (!movement.tokenAddress) {
          continue;
        }
        tokenMovementsForScamDetection.push({
          contractAddress: movement.tokenAddress,
          asset: movement.asset,
          amount: parseDecimal(movement.amount),
          isAirdrop,
          transactionIndex: transactions.length, // Index of transaction we're about to push
        });
      }

      transactions.push(processedTransaction);
      this.logger.debug(
        `Successfully processed correlated transaction group ${processedTransaction.externalId} (${fundFlow.transactionCount} items)`
      );
    }

    // Batch scam detection: token movements only (skip native)
    if (tokenMovementsForScamDetection.length > 0) {
      const uniqueContracts = Array.from(new Set(tokenMovementsForScamDetection.map((m) => m.contractAddress)));
      let metadataMap = new Map<string, TokenMetadataRecord | undefined>();
      let detectionMode: 'metadata' | 'symbol-only' = 'symbol-only';

      if (this.tokenMetadataService && uniqueContracts.length > 0) {
        const metadataResult = await this.tokenMetadataService.getOrFetchBatch(
          this.chainConfig.chainName,
          uniqueContracts
        );

        if (metadataResult.isOk()) {
          metadataMap = metadataResult.value;
          detectionMode = 'metadata';
        } else {
          this.logger.warn(
            { error: metadataResult.error.message },
            'Metadata fetch failed for scam detection (falling back to symbol-only)'
          );
        }
      }

      this.markScamTransactions(transactions, tokenMovementsForScamDetection, metadataMap);
      this.logger.debug(
        `Applied ${detectionMode} scam detection to ${transactions.length} transactions (${uniqueContracts.length} tokens)`
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
   * Enrich token metadata for all token transfers.
   * Fetches metadata upfront in batch to populate cache for later use (asset ID building, scam detection).
   */
  private async enrichTokenMetadata(transactions: EvmTransaction[]): Promise<Result<void, Error>> {
    // Collect all token transfers with contract addresses
    // We enrich ALL of them upfront (not just those with missing/incomplete metadata) because:
    // 1. Scam detection needs metadata for all tokens with contract addresses
    // 2. Batching all fetches upfront is more efficient than separate calls later
    const transactionsToEnrich = transactions.filter((tx) => {
      return tx.type === 'token_transfer' && !!tx.tokenAddress;
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
    const cached = this.contractAddressCache.get(address);
    if (cached !== undefined) {
      return cached;
    }

    const result = await this.providerManager.executeWithFailoverOnce(this.chainConfig.chainName, {
      type: 'getAddressInfo',
      address,
      getCacheKey: (params) =>
        `getAddressInfo:${this.chainConfig.chainName}:${(params as { address: string }).address}`,
    });

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
    this.contractAddressCache.set(address, isContract);
    return isContract;
  }

  /**
   * Build a list of asset movements from fund flow movements, resolving each assetId.
   * Returns an error string if any movement fails assetId resolution.
   */
  private buildMovements(
    movements: { amount: string; asset: Currency; tokenAddress?: string | undefined }[],
    hash: string,
    direction: 'inflow' | 'outflow'
  ): Result<
    {
      assetId: string;
      assetSymbol: Currency;
      grossAmount: ReturnType<typeof parseDecimal>;
      netAmount: ReturnType<typeof parseDecimal>;
    }[],
    string
  > {
    const built: {
      assetId: string;
      assetSymbol: Currency;
      grossAmount: ReturnType<typeof parseDecimal>;
      netAmount: ReturnType<typeof parseDecimal>;
    }[] = [];
    for (const movement of movements) {
      const assetIdResult = this.buildEvmAssetId(movement, hash);
      if (assetIdResult.isErr()) {
        return err(`Failed to build assetId for ${direction}: ${assetIdResult.error.message}`);
      }
      const amount = parseDecimal(movement.amount);
      built.push({ assetId: assetIdResult.value, assetSymbol: movement.asset, grossAmount: amount, netAmount: amount });
    }
    return ok(built);
  }

  /**
   * Build assetId for an EVM movement
   * - Primary native asset (no tokenAddress): blockchain:<chain>:native
   * - Additional native asset (no tokenAddress): blockchain:<chain>:<symbol> (e.g., THETA)
   * - Token with tokenAddress: blockchain:<chain>:<tokenAddress>
   * - Token without tokenAddress (edge case): fail-fast with an error
   *
   * Per Asset Identity Specification, tokenAddress should usually be available for ERC-20 transfers.
   * If missing for a non-native asset, we fail-fast to prevent silent data corruption.
   *
   * Special handling for blockchains with multiple native currencies (e.g., Theta with THETA + TFUEL):
   * - Primary native currency gets blockchain:<chain>:native
   * - Additional native currencies get blockchain:<chain>:<symbol> for unique identification
   */
  private buildEvmAssetId(
    movement: {
      asset: string;
      tokenAddress?: string | undefined;
    },
    transactionHash: string
  ): Result<string, Error> {
    // Native asset (ETH, MATIC, etc.) - no token address
    if (!movement.tokenAddress) {
      const assetSymbol = movement.asset;
      const nativeSymbol = this.chainConfig.nativeCurrency;
      const additionalNativeSymbols = this.chainConfig.additionalNativeCurrencies || [];

      // Check if this asset matches the primary native currency
      const isNativeSymbol = assetSymbol.trim().toLowerCase() === nativeSymbol.trim().toLowerCase();

      // Check if this asset matches any additional native currencies (e.g., THETA on Theta blockchain)
      const isAdditionalNative = additionalNativeSymbols.some(
        (symbol) => assetSymbol.trim().toLowerCase() === symbol.trim().toLowerCase()
      );

      if (isNativeSymbol) {
        // Primary native currency: blockchain:theta:native
        return buildBlockchainNativeAssetId(this.chainConfig.chainName);
      }

      if (isAdditionalNative) {
        // Additional native currency: blockchain:theta:theta (use symbol as reference for uniqueness)
        return buildBlockchainTokenAssetId(this.chainConfig.chainName, assetSymbol.toLowerCase());
      }

      if (looksLikeContractAddress(assetSymbol, 40)) {
        return err(
          new Error(`Missing tokenAddress for token-like asset symbol ${assetSymbol} in transaction ${transactionHash}`)
        );
      }

      return err(
        new Error(`Missing tokenAddress for non-native asset ${assetSymbol} in transaction ${transactionHash}`)
      );
    }

    // Token with contract address
    return buildBlockchainTokenAssetId(this.chainConfig.chainName, movement.tokenAddress);
  }
}
