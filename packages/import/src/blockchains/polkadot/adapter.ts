

import type { Balance, BlockchainInfo, BlockchainTransaction } from '@crypto/core';
import { BaseBlockchainAdapter } from '../shared/base-blockchain-adapter.ts';
import { BlockchainProviderManager } from '../shared/blockchain-provider-manager.ts';
import type { BlockchainExplorersConfig } from '../shared/explorer-config.ts';
import { SUBSTRATE_CHAINS, type SubstrateChainConfig } from './types.ts';

export class SubstrateAdapter extends BaseBlockchainAdapter {
  private chainConfig: SubstrateChainConfig;
  private providerManager: BlockchainProviderManager;

  constructor(explorerConfig: BlockchainExplorersConfig) {
    super('polkadot', 'SubstrateAdapter');

    // Always use Polkadot mainnet as default
    this.chainConfig = SUBSTRATE_CHAINS.polkadot!;

    // Create and initialize provider manager with registry
    this.providerManager = new BlockchainProviderManager(explorerConfig);
    this.providerManager.autoRegisterFromConfig('polkadot', 'mainnet');

    this.logger.info(`Initialized Substrate adapter with registry-based provider manager - Chain: ${this.chainConfig.name}, DisplayName: ${this.chainConfig.displayName}, TokenSymbol: ${this.chainConfig.tokenSymbol}, SS58Format: ${this.chainConfig.ss58Format}, ProvidersCount: ${this.providerManager.getProviders('polkadot').length}`);
  }


  async getAddressTransactions(address: string, since?: number): Promise<BlockchainTransaction[]> {
    this.logger.info(`SubstrateAdapter: Fetching transactions for address: ${address.substring(0, 20)}...`);
    this.logger.debug(`SubstrateAdapter.getAddressTransactions called - Address: ${address}, Since: ${since}, Chain: ${this.chainConfig.name}`);

    try {
      // Use provider manager to fetch transactions with failover
      const transactions = await this.providerManager.executeWithFailover('polkadot', {
        type: 'getAddressTransactions',
        params: { address, since },
        getCacheKey: (params: any) => `${this.chainConfig.name}_tx_${params.address}_${params.since || 'all'}`
      }) as BlockchainTransaction[];

      this.logger.info(`SubstrateAdapter: Found ${transactions.length} transactions for ${this.chainConfig.name} address`);
      return transactions;

    } catch (error) {
      this.logger.error(`Failed to fetch address transactions via provider manager - Address: ${address}, Chain: ${this.chainConfig.name}, Error: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  async getAddressBalance(address: string): Promise<Balance[]> {
    this.logger.debug(`SubstrateAdapter.getAddressBalance called - Address: ${address}, Chain: ${this.chainConfig.name}`);

    try {
      // Use provider manager to fetch balance with failover
      const balances = await this.providerManager.executeWithFailover('polkadot', {
        type: 'getAddressBalance',
        params: { address },
        getCacheKey: (params: any) => `${this.chainConfig.name}_balance_${params.address}`
      }) as Balance[];

      this.logger.info(`SubstrateAdapter: Found ${balances.length} balances for ${this.chainConfig.name} address`);
      return balances;

    } catch (error) {
      this.logger.error(`Failed to fetch address balance via provider manager - Address: ${address}, Chain: ${this.chainConfig.name}, Error: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  validateAddress(address: string): boolean {
    // Basic SS58 address validation - could be enhanced with proper SS58 library
    const ss58Regex = /^[1-9A-HJ-NP-Za-km-z]{47,48}$/;
    const isValid = ss58Regex.test(address);

    this.logger.debug(`Address validation - Address: ${address}, IsValid: ${isValid}, Chain: ${this.chainConfig.name}, SS58Format: ${this.chainConfig.ss58Format}`);
    return isValid;
  }

  async testConnection(): Promise<boolean> {
    this.logger.debug(`SubstrateAdapter.testConnection called - Chain: ${this.chainConfig.name}`);

    try {
      // Test connection using provider manager
      const providers = this.providerManager.getProviders('polkadot');
      if (providers.length === 0) {
        this.logger.warn(`No polkadot providers available for connection test`);
        return false;
      }

      // Test the first healthy provider
      for (const provider of providers) {
        try {
          const isHealthy = await provider.isHealthy();
          if (isHealthy) {
            this.logger.info(`Connection test successful with provider: ${provider.name}`);
            return true;
          }
        } catch (error) {
          this.logger.debug(`Provider ${provider.name} failed health check - Error: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      this.logger.warn(`All polkadot providers failed connection test`);
      return false;

    } catch (error) {
      this.logger.error(`Connection test failed - Chain: ${this.chainConfig.name}, Error: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  async getBlockchainInfo(): Promise<BlockchainInfo> {
    return {
      id: this.chainConfig.name,
      name: this.chainConfig.displayName,
      network: this.chainConfig.name,
      capabilities: {
        supportsAddressTransactions: true,
        supportsTokenTransactions: false, // Substrate native tokens only for now
        supportsBalanceQueries: true,
        supportsHistoricalData: true,
        supportsPagination: true,
        maxLookbackDays: undefined
      }
    };
  }

  // Substrate chains don't typically have separate token transactions like EVM chains
  // They use native token transfers within extrinsics
  async getTokenTransactions(address: string, tokenContract?: string): Promise<BlockchainTransaction[]> {
    this.logger.debug(`SubstrateAdapter.getTokenTransactions called - Address: ${address}, TokenContract: ${tokenContract}, Chain: ${this.chainConfig.name}`);

    // For now, return regular transactions as Substrate chains primarily use native tokens
    // In the future, this could be extended to support parachains with custom tokens
    this.logger.info('Token transactions not implemented for Substrate chains - returning regular transactions');
    return this.getAddressTransactions(address);
  }

  async getTokenBalances(address: string): Promise<Balance[]> {
    this.logger.debug(`SubstrateAdapter.getTokenBalances called - Address: ${address}, Chain: ${this.chainConfig.name}`);

    // For now, return regular balance as Substrate chains primarily use native tokens
    this.logger.info('Token balances not implemented for Substrate chains - returning regular balance');
    return this.getAddressBalance(address);
  }

  /**
   * Close adapter and cleanup resources (required by IBlockchainAdapter)
   */
  async close(): Promise<void> {
    try {
      this.providerManager.destroy();
      this.logger.info(`${this.chainConfig.displayName} adapter closed successfully`);
    } catch (error) {
      this.logger.warn(`Error during ${this.chainConfig.displayName} adapter close - Error: ${error}`);
    }
  }
}