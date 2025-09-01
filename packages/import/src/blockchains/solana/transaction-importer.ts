import { BaseImporter } from '../../shared/importers/base-importer.ts';
import type { ImportParams, ImportRunResult } from '../../shared/importers/interfaces.ts';
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

  constructor(
    blockchainProviderManager: BlockchainProviderManager,
    options?: { preferredProvider?: string | undefined }
  ) {
    super('solana');

    this.providerManager = blockchainProviderManager;

    if (!this.providerManager) {
      throw new Error('Provider manager required for Solana importer');
    }

    // Auto-register providers for solana mainnet
    this.providerManager.autoRegisterFromConfig('solana', 'mainnet', options?.preferredProvider);

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
   * Validate source parameters and connectivity.
   */
  protected async canImportSpecific(params: ImportParams): Promise<boolean> {
    if (!params.address?.length) {
      this.logger.error('No address provided for Solana import');
      return false;
    }

    // Validate address formats
    if (!isValidSolanaAddress(params.address)) {
      this.logger.error(`Invalid Solana address format: ${params.address}`);
      return false;
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
  async import(params: ImportParams): Promise<ImportRunResult<SolanaRawTransactionData>> {
    if (!params.address) {
      throw new Error('Address required for Solana transaction import');
    }

    this.logger.info(`Starting Solana transaction import for address: ${params.address.substring(0, 20)}...`);

    const allSourcedTransactions: ApiClientRawData<SolanaRawTransactionData>[] = [];

    this.logger.info(`Importing transactions for address: ${params.address.substring(0, 20)}...`);

    try {
      const rawTransactions = await this.fetchRawTransactionsForAddress(params.address, params.since);

      // Add the fetching address to each raw transaction batch
      const enhancedSourcedTransactions: ApiClientRawData<SolanaRawTransactionData>[] = rawTransactions.map(rawTx => ({
        providerId: rawTx.providerId,
        rawData: rawTx.rawData,
        sourceAddress: params.address,
      }));

      allSourcedTransactions.push(...enhancedSourcedTransactions);

      this.logger.info(
        `Found ${rawTransactions.reduce((acc, tx) => acc + tx.rawData.normal.length, 0)} transactions for address ${params.address.substring(0, 20)}...`
      );
    } catch (error) {
      this.handleImportError(error, `fetching transactions for ${params.address}`);
    }

    const totalTransactionCount = allSourcedTransactions.reduce((acc, tx) => acc + tx.rawData.normal.length, 0);
    this.logger.info(`Solana import completed: ${totalTransactionCount} transactions`);

    return {
      rawData: allSourcedTransactions,
    };
  }
}
