import {
  type BlockchainProviderManager,
  type EvmChainConfig,
  type EvmTransaction,
  EvmTransactionSchema,
} from '@exitbook/blockchain-providers';
import { buildBlockchainNativeAssetId, buildBlockchainTokenAssetId } from '@exitbook/core';
import { err, type Result } from '@exitbook/core';

import { BaseTransactionProcessor } from '../../../features/process/base-transaction-processor.js';
import type { IScamDetectionService } from '../../../features/scam-detection/scam-detection-service.interface.js';
import { looksLikeContractAddress } from '../../../features/token-metadata/token-metadata-utils.js';
import type { ProcessedTransaction, AddressContext } from '../../../shared/types/processors.js';
import { processCorrelatedTransactions } from '../shared/correlated-transaction-processor.js';

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
export class EvmProcessor extends BaseTransactionProcessor<EvmTransaction> {
  // Narrows base class optional to required — EvmProcessor always requires a provider manager
  declare protected readonly providerManager: BlockchainProviderManager;
  private readonly contractAddressCache = new Map<string, boolean>();

  constructor(
    private readonly chainConfig: EvmChainConfig,
    providerManager: BlockchainProviderManager,
    scamDetectionService?: IScamDetectionService
  ) {
    super(chainConfig.chainName, providerManager, scamDetectionService);
  }

  protected get inputSchema() {
    return EvmTransactionSchema;
  }

  protected async transformNormalizedData(
    normalizedData: EvmTransaction[],
    context: AddressContext
  ): Promise<Result<ProcessedTransaction[], Error>> {
    return processCorrelatedTransactions({
      chainName: this.chainConfig.chainName,
      normalizedData,
      context,
      logger: this.logger,
      providerManager: this.providerManager,
      contractAddressCache: this.contractAddressCache,
      runScamDetection: (transactions, movements, chainName) =>
        this.runScamDetection(transactions, movements, chainName),
      buildProcessingFailureError: (failed, total, errors) => this.buildProcessingFailureError(failed, total, errors),
      groupTransactions: groupEvmTransactionsByHash,
      analyzeFundFlow: (txGroup, addressContext) => analyzeEvmFundFlow(txGroup, addressContext, this.chainConfig),
      determineOperation: determineEvmOperationFromFundFlow,
      selectPrimaryTransaction: selectPrimaryEvmTransaction,
      buildAssetId: (movement, transactionHash) => this.buildEvmAssetId(movement, transactionHash),
    });
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
