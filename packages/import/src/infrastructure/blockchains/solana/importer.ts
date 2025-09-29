import type { ApiClientRawData, ImportParams, ImportRunResult } from '@exitbook/import/app/ports/importers.js';
import { err, ok, type Result } from 'neverthrow';

import { BaseImporter } from '../../shared/importers/base-importer.js';
import type { BlockchainProviderManager, ProviderError } from '../shared/blockchain-provider-manager.js';

import type { SolanaRawTransactionData } from './helius/helius.api-client.js';
// Ensure Solana providers are registered
import './register-apis.js';
import { isValidSolanaAddress } from './utils.js';

/**
 * Solana transaction importer that fetches raw transaction data from blockchain APIs.
 * Supports Solana addresses using multiple providers (Helius, Solscan, SolanaRPC).
 * Uses provider manager for failover between multiple blockchain API providers.
 */
export class SolanaTransactionImporter extends BaseImporter {
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
   * Get transaction ID from Solana transaction data
   */
  public getTransactionId(tx: SolanaRawTransactionData): string {
    if (tx.normal && tx.normal.length > 0) {
      const firstTx = tx.normal[0];
      if (firstTx) {
        return firstTx.transaction?.signatures?.[0] || firstTx.signature || 'unknown';
      }
    }
    return 'unknown';
  }

  /**
   * Import raw transaction data from Solana blockchain APIs with provider provenance.
   */
  async import(params: ImportParams): Promise<Result<ImportRunResult, Error>> {
    if (!params.address) {
      return err(new Error('Address required for Solana transaction import'));
    }

    this.logger.info(`Starting Solana transaction import for address: ${params.address.substring(0, 20)}...`);

    const allSourcedTransactions: ApiClientRawData[] = [];

    this.logger.info(`Importing transactions for address: ${params.address.substring(0, 20)}...`);

    const result = await this.fetchRawTransactionsForAddress(params.address, params.since);

    if (result.isErr()) {
      this.logger.error(`Failed to import transactions for address ${params.address} - Error: ${result.error.message}`);
      return err(result.error);
    }

    const rawTransactions = result.value;

    allSourcedTransactions.push(...rawTransactions);

    this.logger.info(`Found ${rawTransactions.length} transactions for address ${params.address.substring(0, 20)}...`);

    this.logger.info(`Solana import completed: ${rawTransactions.length} transactions`);

    return ok({
      rawData: allSourcedTransactions,
    });
  }

  /**
   * Validate source parameters and connectivity.
   */
  protected canImportSpecific(params: ImportParams): Promise<boolean> {
    if (!params.address?.length) {
      this.logger.error('No address provided for Solana import');
      return Promise.resolve(false);
    }

    // Validate address formats
    if (!isValidSolanaAddress(params.address)) {
      this.logger.error(`Invalid Solana address format: ${params.address}`);
      return Promise.resolve(false);
    }

    // Test provider connectivity
    const healthStatus = this.providerManager.getProviderHealth('solana');
    const hasHealthyProvider = Array.from(healthStatus.values()).some(
      (health) => health.isHealthy && health.circuitState !== 'OPEN'
    );

    if (!hasHealthyProvider) {
      this.logger.error('No healthy Solana providers available');
      return Promise.resolve(false);
    }

    this.logger.info('Solana source validation passed');
    return Promise.resolve(true);
  }

  /**
   * Fetch raw transactions for a single address with provider provenance.
   */
  private async fetchRawTransactionsForAddress(
    address: string,
    since?: number
  ): Promise<Result<ApiClientRawData[], ProviderError>> {
    const result = await this.providerManager.executeWithFailover('solana', {
      address: address,
      getCacheKey: (params) =>
        `solana:raw-txs:${params.type === 'getRawAddressTransactions' ? params.address : 'unknown'}:${params.type === 'getRawAddressTransactions' ? params.since || 'all' : 'unknown'}`,
      since: since,
      type: 'getRawAddressTransactions',
    });

    if (result.isErr()) {
      this.logger.error(`Provider manager failed to fetch transactions for ${address}: ${result.error.message}`);
      return err(result.error);
    }

    const rawTransactionData = result.value.data as SolanaRawTransactionData;
    const providerId = result.value.providerName;

    // Return as array with single element containing all transactions
    return ok([
      {
        metadata: { providerId, sourceAddress: address },
        rawData: rawTransactionData,
      },
    ]);
  }
}
