import type { SourceType } from '@exitbook/core';
import {
  getEvmChainConfig,
  getSubstrateChainConfig,
  getCosmosChainConfig,
  ProviderRegistry,
} from '@exitbook/providers';
import { getLogger } from '@exitbook/shared-logger';

import type { ITokenMetadataService } from '../../../services/token-metadata/token-metadata-service.interface.ts';
import type { IProcessorFactory } from '../../../types/factories.ts';
import type { ITransactionProcessor } from '../../../types/processors.ts';

/**
 * Factory for creating processor instances.
 * Handles dependency injection and source-specific instantiation.
 *
 * Architecture:
 * - Static methods (getSupportedSources, isSupported): Query available processors without dependencies
 * - Instance methods (create): Create processors with injected dependencies (TokenMetadataService)
 *
 * This hybrid pattern allows:
 * 1. Lightweight querying of capabilities (e.g., listing blockchains) without service initialization
 * 2. Proper dependency injection when creating actual processor instances
 */
export class ProcessorFactory implements IProcessorFactory {
  /**
   * Get all supported sources for a given type.
   * For blockchains, returns chains that have at least one registered provider.
   * Static method - does not require instance dependencies.
   */
  static async getSupportedSources(sourceType: SourceType): Promise<string[]> {
    if (sourceType === 'exchange') {
      return ['kraken', 'kucoin', 'ledgerlive', 'coinbase'];
    }

    if (sourceType === 'blockchain') {
      // Get actual supported chains from registered providers
      const allProviders = ProviderRegistry.getAllProviders();
      const uniqueBlockchains = new Set<string>();

      for (const provider of allProviders) {
        const metadata = ProviderRegistry.getMetadata(provider.blockchain, provider.name);
        if (!metadata) {
          continue;
        }

        // Add primary blockchain
        uniqueBlockchains.add(provider.blockchain);

        // Add supported chains for multi-chain providers
        if (metadata.supportedChains) {
          const chains = Array.isArray(metadata.supportedChains)
            ? metadata.supportedChains
            : Object.keys(metadata.supportedChains);
          chains.forEach((chain) => uniqueBlockchains.add(chain));
        }
      }

      return Array.from(uniqueBlockchains).sort();
    }

    return Promise.resolve([]);
  }

  /**
   * Check if a processor is available for the given source.
   * Static method - does not require instance dependencies.
   */
  static async isSupported(sourceId: string, sourceType: SourceType): Promise<boolean> {
    try {
      if (sourceType === 'exchange') {
        return ['coinbase', 'kraken', 'kucoin', 'ledgerlive'].includes(sourceId.toLowerCase());
      }

      if (sourceType === 'blockchain') {
        const supportedChains = await ProcessorFactory.getSupportedSources('blockchain');
        return supportedChains.includes(sourceId.toLowerCase());
      }

      return false;
    } catch {
      return false;
    }
  }
  private readonly logger = getLogger('ProcessorFactory');

  constructor(private readonly tokenMetadataService: ITokenMetadataService) {}
  /**
   * Create a processor for the specified source.
   */
  async create(
    sourceId: string,
    sourceType: SourceType,
    metadata?: Record<string, unknown>
  ): Promise<ITransactionProcessor> {
    this.logger.info(`Creating processor for ${sourceId} (type: ${sourceType})`);

    if (sourceType === 'exchange') {
      return await this.createExchangeProcessor(sourceId, metadata);
    }

    if (sourceType === 'blockchain') {
      return await this.createBlockchainProcessor(sourceId);
    }

    throw new Error(`Unsupported source type: ${String(sourceType)}`);
  }

  /**
   * Create EVM-compatible chain processor (Ethereum, Avalanche, Polygon, etc.).
   * Looks up chain config from evm-chains.json registry.
   */
  private async createEvmProcessor(chainName: string): Promise<ITransactionProcessor> {
    // Dynamic import to avoid circular dependencies
    const { EvmTransactionProcessor } = await import('../../blockchains/evm/processor.ts');
    const config = getEvmChainConfig(chainName);
    if (!config) {
      throw new Error(`EVM chain config not found: ${chainName}`);
    }
    return new EvmTransactionProcessor(config, this.tokenMetadataService);
  }

  /**
   * Create Bitcoin processor.
   */
  private async createBitcoinProcessor(): Promise<ITransactionProcessor> {
    // Dynamic import to avoid circular dependencies
    const { BitcoinTransactionProcessor } = await import('../../blockchains/bitcoin/processor.ts');
    return new BitcoinTransactionProcessor();
  }

  /**
   * Create a blockchain processor.
   */
  private async createBlockchainProcessor(sourceId: string): Promise<ITransactionProcessor> {
    const chainName = sourceId.toLowerCase();

    // Try EVM chains first (dynamically loaded from evm-chains.json)
    if (getEvmChainConfig(chainName)) {
      return await this.createEvmProcessor(chainName);
    }

    // Try Substrate chains (dynamically loaded from substrate-chains.json)
    if (getSubstrateChainConfig(chainName)) {
      return await this.createSubstrateProcessor(chainName);
    }

    // Try Cosmos SDK chains (dynamically loaded from cosmos-chains.json)
    if (getCosmosChainConfig(chainName)) {
      return await this.createCosmosProcessor(chainName);
    }

    // Non-EVM, non-Substrate, non-Cosmos chains
    switch (chainName) {
      case 'bitcoin':
        return await this.createBitcoinProcessor();

      case 'solana':
        return await this.createSolanaProcessor();

      default:
        throw new Error(`Unsupported blockchain processor: ${sourceId}`);
    }
  }

  /**
   * Create an exchange processor.
   */
  private async createExchangeProcessor(
    sourceId: string,
    metadata?: Record<string, unknown>
  ): Promise<ITransactionProcessor> {
    switch (sourceId.toLowerCase()) {
      case 'kraken':
        return await this.createDefaultExchangeProcessor(sourceId);

      case 'coinbase':
        return await this.createCoinbaseProcessor();

      case 'kucoin':
        return await this.createKuCoinProcessor(metadata);

      default:
        throw new Error(`Unsupported exchange processor: ${sourceId}`);
    }
  }

  /**
   * Create Cosmos SDK chain processor (Injective, Osmosis, Cosmos Hub, etc.).
   * Looks up chain config from cosmos-chains.json registry.
   */
  private async createCosmosProcessor(chainName: string): Promise<ITransactionProcessor> {
    // Dynamic import to avoid circular dependencies
    const { CosmosProcessor } = await import('../../blockchains/cosmos/processor.ts');
    const config = getCosmosChainConfig(chainName);
    if (!config) {
      throw new Error(`Cosmos chain config not found: ${chainName}`);
    }
    return new CosmosProcessor(config);
  }

  /**
   * Create default exchange processor for exchanges where all normalization
   * is handled in the client layer.
   */
  private async createDefaultExchangeProcessor(sourceId: string): Promise<ITransactionProcessor> {
    // Dynamic import to avoid circular dependencies
    const { DefaultExchangeProcessor } = await import('../../exchanges/shared/default-exchange-processor.ts');
    return new DefaultExchangeProcessor(sourceId);
  }

  /**
   * Create Coinbase processor.
   *
   * Coinbase requires a specialized processor because their ledger semantics differ from
   * other exchanges:
   *
   * - For WITHDRAWALS: The fee is INCLUDED in the amount field, not separate.
   *   Example: Withdraw 17.42 UNI with 0.164 fee
   *     - Coinbase reports: amount=17.58425517, fee=0.16425517
   *     - The 17.584 is the TOTAL deducted from balance
   *     - The 0.164 fee is already part of the 17.584
   *     - Only 17.42 actually left to external address
   *
   * - For TRADES: The fee is separate (like other exchanges)
   *
   * The CoinbaseProcessor handles this by:
   * - Processing individual ledger entries (no correlation needed)
   * - For withdrawals: recording outflow as (amount - fee), fee separately
   * - For trades: recording full amount as inflow/outflow, fee separately
   *
   * DefaultExchangeProcessor assumes fees are ALWAYS separate deductions, which causes
   * double-counting of withdrawal fees for Coinbase.
   */
  private async createCoinbaseProcessor(): Promise<ITransactionProcessor> {
    const { CoinbaseProcessor } = await import('../../exchanges/coinbase/processor.ts');
    return new CoinbaseProcessor();
  }

  /**
   * Create KuCoin processor (CSV or API based on metadata).
   *
   * KuCoin CSV requires a specialized processor because CSV data has a fundamentally
   * different structure than API ledger data:
   *
   * - API ledger format: Each row is a SINGLE balance change (double-entry bookkeeping).
   *   For a trade, you get TWO separate ledger entries (one per asset). The API has already
   *   decomposed transactions into atomic balance changes with correlation IDs.
   *   Example: Buy BTC with USDT creates two entries:
   *     1. {asset: "BTC", amount: "+0.1", correlationId: "abc"}
   *     2. {asset: "USDT", amount: "-5000", correlationId: "abc"}
   *
   * - KuCoin CSV format: Each row is a COMPLETE transaction with BOTH sides included.
   *   A trade CSV row contains BOTH "Filled Amount" (base) AND "Filled Volume" (quote).
   *   Example: Buy BTC with USDT is ONE row:
   *     {Symbol: "BTC-USDT", FilledAmount: "0.1", FilledVolume: "5000", Side: "buy"}
   *
   * The CSV processor does additional work:
   * - Extracts BOTH sides of trades from composite CSV rows
   * - Handles special grouping (e.g., Convert Market pairs)
   * - Maps KuCoin-specific statuses and transaction types
   * - Creates complete UniversalTransaction objects directly from rich CSV data
   *
   * The API processor (DefaultExchangeProcessor) expects pre-normalized ExchangeLedgerEntry
   * objects and performs correlation-based grouping and fund flow analysis.
   */
  private async createKuCoinProcessor(metadata?: Record<string, unknown>): Promise<ITransactionProcessor> {
    // Check if this is a CSV import by looking at import metadata
    const importMethod = metadata?.importMethod as string | undefined;

    if (importMethod === 'csv') {
      // Use CSV processor - handles composite transaction rows
      const { KucoinProcessor } = await import('../../exchanges/kucoin/processor-csv.ts');
      return new KucoinProcessor();
    }

    // Use default processor - handles pre-normalized ledger entries
    const { DefaultExchangeProcessor } = await import('../../exchanges/shared/default-exchange-processor.ts');
    return new DefaultExchangeProcessor('kucoin');
  }

  /**
   * Create Substrate-based chain processor (Polkadot, Bittensor, Kusama, etc.).
   * Looks up chain config from substrate-chains.json registry.
   */
  private async createSubstrateProcessor(chainName: string): Promise<ITransactionProcessor> {
    // Dynamic import to avoid circular dependencies
    const { SubstrateProcessor } = await import('../../blockchains/substrate/processor.ts');
    const config = getSubstrateChainConfig(chainName);
    if (!config) {
      throw new Error(`Substrate chain config not found: ${chainName}`);
    }
    return new SubstrateProcessor(config);
  }

  /**
   * Create Solana processor.
   */
  private async createSolanaProcessor(): Promise<ITransactionProcessor> {
    // Dynamic import to avoid circular dependencies
    const { SolanaTransactionProcessor } = await import('../../blockchains/solana/processor.ts');
    return new SolanaTransactionProcessor(this.tokenMetadataService);
  }
}
