import type { IDependencyContainer } from '../../shared/common/interfaces.ts';
import { BaseImporter } from '../../shared/importers/base-importer.ts';
import type { ImportParams } from '../../shared/importers/interfaces.ts';
import type { ApiClientRawData } from '../../shared/processors/interfaces.ts';
import type { BlockchainProviderManager } from '../shared/blockchain-provider-manager.ts';
import type { SolanaRawTransactionData } from './clients/HeliusApiClient.ts';
// Ensure Solana providers are registered
import './clients/index.ts';
import { isValidSolanaAddress } from './utils.ts';

/**
 * Solana transaction importer that fetches raw transaction data from blockchain APIs.
 * Supports Solana addresses using multiple providers (Helius, Solscan, SolanaRPC).
 * Uses provider manager for failover between multiple blockchain API providers.
 */
export class SolanaTransactionImporter extends BaseImporter<SolanaRawTransactionData> {
  private providerManager: BlockchainProviderManager;

  constructor(dependencies: IDependencyContainer) {
    super('solana');

    if (!dependencies.providerManager || !dependencies.explorerConfig) {
      throw new Error('Provider manager and explorer config required for Solana importer');
    }

    this.providerManager = dependencies.providerManager;

    // Auto-register providers for solana mainnet
    this.providerManager.autoRegisterFromConfig('solana', 'mainnet');

    this.logger.info(
      `Initialized Solana transaction importer - ProvidersCount: ${this.providerManager.getProviders('solana').length}`
    );
  }

  /**
   * Fetch raw transactions for a single address with provider provenance.
   */
  private async fetchRawTransactionsForAddress(
    address: string,
    since?: number
  ): Promise<ApiClientRawData<SolanaRawTransactionData>[]> {
    try {
      const result = await this.providerManager.executeWithFailover('solana', {
        address: address,
        getCacheKey: params =>
          `solana:raw-txs:${params.type === 'getRawAddressTransactions' ? params.address : 'unknown'}:${params.type === 'getRawAddressTransactions' ? params.since || 'all' : 'unknown'}`,
        since: since,
        type: 'getRawAddressTransactions',
      });

      const rawTransactionData = result.data as SolanaRawTransactionData;
      const providerId = result.providerName;

      // Return as array with single element containing all transactions
      return [
        {
          providerId,
          rawData: rawTransactionData,
        },
      ];
    } catch (error) {
      this.logger.error(`Provider manager failed to fetch transactions for ${address}: ${error}`);
      throw error;
    }
  }

  /**
   * Validate Solana address format.
   */
  private isValidAddress(address: string): boolean {
    return isValidSolanaAddress(address);
  }

  /**
   * Remove duplicate transactions based on signature.
   */
  private removeDuplicateTransactions(
    sourcedTransactions: ApiClientRawData<SolanaRawTransactionData>[]
  ): ApiClientRawData<SolanaRawTransactionData>[] {
    const uniqueTransactions = new Map<string, ApiClientRawData<SolanaRawTransactionData>>();
    const allSignatures = new Set<string>();

    for (const sourcedTx of sourcedTransactions) {
      const combinedKey = `${sourcedTx.providerId}`;

      // Collect all signatures from this batch
      const signatures = new Set<string>();
      for (const tx of sourcedTx.rawData.normal) {
        const signature = tx.transaction.signatures?.[0] || tx.signature;
        if (signature && !allSignatures.has(signature)) {
          signatures.add(signature);
          allSignatures.add(signature);
        }
      }

      // Only include transactions with unique signatures
      if (signatures.size > 0) {
        const filteredTransactions = sourcedTx.rawData.normal.filter(tx => {
          const signature = tx.transaction.signatures?.[0] || tx.signature;
          return signature && signatures.has(signature);
        });

        if (filteredTransactions.length > 0) {
          uniqueTransactions.set(combinedKey, {
            providerId: sourcedTx.providerId,
            rawData: {
              normal: filteredTransactions,
            },
          });
        }
      }
    }

    return Array.from(uniqueTransactions.values());
  }

  /**
   * Validate source parameters and connectivity.
   */
  protected async canImportSpecific(params: ImportParams): Promise<boolean> {
    if (!params.addresses?.length) {
      this.logger.error('No addresses provided for Solana import');
      return false;
    }

    // Validate address formats
    for (const address of params.addresses) {
      if (!this.isValidAddress(address)) {
        this.logger.error(`Invalid Solana address format: ${address}`);
        return false;
      }
    }

    // Test provider connectivity
    const healthStatus = this.providerManager.getProviderHealth('solana');
    const hasHealthyProvider = Array.from(healthStatus.values()).some(
      health => health.isHealthy && health.circuitState !== 'OPEN'
    );

    if (!hasHealthyProvider) {
      this.logger.error('No healthy Solana providers available');
      return false;
    }

    this.logger.info('Solana source validation passed');
    return true;
  }

  /**
   * Get transaction ID from Solana transaction data
   */
  public getTransactionId(tx: SolanaRawTransactionData): string {
    if (tx.normal && tx.normal.length > 0) {
      const firstTx = tx.normal[0];
      return firstTx.transaction.signatures?.[0] || firstTx.signature || 'unknown';
    }
    return 'unknown';
  }

  /**
   * Import raw transaction data from Solana blockchain APIs with provider provenance.
   */
  async import(params: ImportParams): Promise<ApiClientRawData<SolanaRawTransactionData>[]> {
    if (!params.addresses?.length) {
      throw new Error('Addresses required for Solana transaction import');
    }

    this.logger.info(`Starting Solana transaction import for ${params.addresses.length} addresses`);

    const allSourcedTransactions: ApiClientRawData<SolanaRawTransactionData>[] = [];

    for (const address of params.addresses) {
      this.logger.info(`Importing transactions for address: ${address.substring(0, 20)}...`);

      try {
        const sourcedTransactions = await this.fetchRawTransactionsForAddress(address, params.since);

        // Add the fetching address to each raw transaction batch
        const enhancedSourcedTransactions: ApiClientRawData<SolanaRawTransactionData>[] = sourcedTransactions.map(
          sourcedTx => ({
            providerId: sourcedTx.providerId,
            rawData: sourcedTx.rawData,
            sourceAddress: address,
          })
        );

        allSourcedTransactions.push(...enhancedSourcedTransactions);

        this.logger.info(
          `Found ${sourcedTransactions.reduce((acc, tx) => acc + tx.rawData.normal.length, 0)} transactions for address ${address.substring(0, 20)}...`
        );
      } catch (error) {
        this.handleImportError(error, `fetching transactions for ${address}`);
      }
    }

    // Remove duplicates based on transaction signature
    const uniqueTransactions = this.removeDuplicateTransactions(allSourcedTransactions);

    const totalTransactionCount = uniqueTransactions.reduce((acc, tx) => acc + tx.rawData.normal.length, 0);
    this.logger.info(`Solana import completed: ${totalTransactionCount} unique sourced transactions`);

    return uniqueTransactions;
  }
}
