import * as bitcoin from 'bitcoinjs-lib';

import type { IDependencyContainer } from '../../shared/common/interfaces.ts';
import { BaseImporter } from '../../shared/importers/base-importer.ts';
import type { ImportParams, ImportRunResult } from '../../shared/importers/interfaces.ts';
import type { ApiClientRawData } from '../../shared/processors/interfaces.ts';
// Ensure Bitcoin providers are registered
import '../registry/register-providers.ts';
import type { BlockchainProviderManager } from '../shared/blockchain-provider-manager.ts';
import type { BitcoinTransaction, BitcoinWalletAddress } from './types.ts';
import { BitcoinUtils } from './utils.ts';

/**
 * Bitcoin transaction importer that fetches raw transaction data from blockchain APIs.
 * Supports both regular Bitcoin addresses and extended public keys (xpub/ypub/zpub).
 * Uses provider manager for failover between multiple blockchain API providers.
 */
export class BitcoinTransactionImporter extends BaseImporter<BitcoinTransaction> {
  private addressGap: number;
  private addressInfoCache = new Map<string, { balance: string; txCount: number }>();
  private providerManager: BlockchainProviderManager;
  private walletAddresses: BitcoinWalletAddress[] = [];

  constructor(
    dependencies: IDependencyContainer,
    options?: { addressGap?: number; preferredProvider?: string | undefined }
  ) {
    super('bitcoin');

    if (!dependencies.providerManager) {
      throw new Error('Provider manager required for Bitcoin importer');
    }

    this.providerManager = dependencies.providerManager;
    this.addressGap = options?.addressGap || 20;

    // Auto-register providers for bitcoin mainnet
    this.providerManager.autoRegisterFromConfig('bitcoin', 'mainnet', options?.preferredProvider);

    this.logger.info(
      `Initialized Bitcoin transaction importer - AddressGap: ${this.addressGap}, ProvidersCount: ${this.providerManager.getProviders('bitcoin').length}`
    );
  }

  /**
   * Fetch raw transactions for a single address with provider provenance.
   */
  private async fetchRawTransactionsForAddress(
    address: string,
    since?: number
  ): Promise<ApiClientRawData<BitcoinTransaction>[]> {
    try {
      const result = await this.providerManager.executeWithFailover('bitcoin', {
        address: address,
        getCacheKey: params =>
          `bitcoin:raw-txs:${params.type === 'getRawAddressTransactions' ? params.address : 'unknown'}:${params.type === 'getRawAddressTransactions' ? params.since || 'all' : 'unknown'}`,
        since: since,
        type: 'getRawAddressTransactions',
      });

      const rawTransactions = result.data as BitcoinTransaction[];
      const providerId = result.providerName;

      // Wrap each transaction with provider provenance
      return rawTransactions.map(rawData => ({
        providerId,
        rawData,
      }));
    } catch (error) {
      this.logger.error(`Provider manager failed to fetch transactions for ${address}: ${error}`);
      throw error;
    }
  }

  /**
   * Fetch raw transactions for derived addresses from an xpub wallet.
   */
  private async fetchRawTransactionsForDerivedAddresses(
    derivedAddresses: string[],
    since?: number
  ): Promise<ApiClientRawData<BitcoinTransaction>[]> {
    const uniqueTransactions = new Map<string, ApiClientRawData<BitcoinTransaction>>();

    for (const address of derivedAddresses) {
      // Check cache first to see if this address has any transactions
      const cachedInfo = this.addressInfoCache.get(address);

      // Skip addresses that we know are empty from gap scanning
      if (cachedInfo && cachedInfo.txCount === 0) {
        this.logger.debug(`Skipping address ${address} - no transactions in cache`);
        continue;
      }

      try {
        const rawTransactions = await this.fetchRawTransactionsForAddress(address, since);

        // Add transactions to the unique set with address information
        for (const rawTx of rawTransactions) {
          const txId = this.getTransactionId(rawTx.rawData);

          uniqueTransactions.set(txId, {
            providerId: rawTx.providerId,
            rawData: rawTx.rawData,
            sourceAddress: address,
          });
        }

        this.logger.debug(`Found ${rawTransactions.length} transactions for address ${address}`);
      } catch (error) {
        this.logger.error(`Failed to fetch raw transactions for address ${address}: ${error}`);
      }
    }

    this.logger.info(`Found ${uniqueTransactions.size} unique raw transactions across all derived addresses`);
    return Array.from(uniqueTransactions.values());
  }

  /**
   * Initialize an xpub wallet using BitcoinUtils.
   */
  private async initializeXpubWallet(walletAddress: BitcoinWalletAddress): Promise<void> {
    await BitcoinUtils.initializeXpubWallet(
      walletAddress,
      bitcoin.networks.bitcoin, // Always use mainnet
      this.providerManager,
      this.addressGap
    );
  }

  /**
   * Validate Bitcoin address format (basic validation).
   */
  private isValidBitcoinAddress(address: string): boolean {
    try {
      // Check for xpub/ypub/zpub
      if (BitcoinUtils.isXpub(address)) {
        return true;
      }

      // Check for regular Bitcoin address format
      // This is a basic check - full validation would require more complex parsing
      if (
        (address.startsWith('1') && address.length >= 26 && address.length <= 35) || // Legacy
        (address.startsWith('3') && address.length >= 26 && address.length <= 35) || // SegWit
        (address.startsWith('bc1') && address.length >= 39) // Bech32
      ) {
        return true;
      }

      return false;
    } catch {
      return false;
    }
  }

  /**
   * Remove duplicate transactions based on txid.
   */
  private removeDuplicateTransactions(
    rawTransactions: ApiClientRawData<BitcoinTransaction>[]
  ): ApiClientRawData<BitcoinTransaction>[] {
    const uniqueTransactions = new Map<string, ApiClientRawData<BitcoinTransaction>>();

    for (const rawTx of rawTransactions) {
      const txId = this.getTransactionId(rawTx.rawData);
      if (!uniqueTransactions.has(txId)) {
        uniqueTransactions.set(txId, rawTx);
      }
    }

    return Array.from(uniqueTransactions.values());
  }

  /**
   * Validate source parameters and connectivity.
   */
  protected async canImportSpecific(params: ImportParams): Promise<boolean> {
    if (!params.addresses?.length) {
      this.logger.error('No addresses provided for Bitcoin import');
      return false;
    }

    // Validate address formats
    for (const address of params.addresses) {
      if (!this.isValidBitcoinAddress(address)) {
        this.logger.error(`Invalid Bitcoin address format: ${address}`);
        return false;
      }
    }

    // Test provider connectivity
    const healthStatus = this.providerManager.getProviderHealth('bitcoin');
    const hasHealthyProvider = Array.from(healthStatus.values()).some(
      health => health.isHealthy && health.circuitState !== 'OPEN'
    );

    if (!hasHealthyProvider) {
      this.logger.error('No healthy Bitcoin providers available');
      return false;
    }

    this.logger.info('Bitcoin source validation passed');
    return true;
  }

  /**
   * Get derived addresses metadata for session storage.
   * This allows the processor to access the expensive address derivation results.
   */
  getDerivedAddressesMetadata(): Record<string, unknown> {
    const metadata: Record<string, unknown> = {};

    for (const wallet of this.walletAddresses) {
      if (wallet.derivedAddresses) {
        metadata[wallet.address] = {
          addressType: wallet.addressType,
          bipStandard: wallet.bipStandard,
          derivationPath: wallet.derivationPath,
          derivedAddresses: wallet.derivedAddresses,
        };
      }
    }

    return metadata;
  }

  /**
   * Get transaction ID from any Bitcoin transaction type
   */
  public getTransactionId(tx: BitcoinTransaction): string {
    // Handle different transaction formats
    if ('txid' in tx) {
      return tx.txid; // MempoolTransaction, BlockstreamTransaction
    } else if ('hash' in tx) {
      return tx.hash; // BlockCypherTransaction
    }
    return 'unknown';
  }

  /**
   * Import raw transaction data from Bitcoin blockchain APIs with provider provenance.
   */
  async import(params: ImportParams): Promise<ImportRunResult<BitcoinTransaction>> {
    if (!params.addresses?.length) {
      throw new Error('Addresses required for Bitcoin transaction import');
    }

    this.logger.info(`Starting Bitcoin transaction import for ${params.addresses.length} addresses`);

    const allSourcedTransactions: ApiClientRawData<BitcoinTransaction>[] = [];

    for (const userAddress of params.addresses) {
      this.logger.info(`Importing transactions for address: ${userAddress.substring(0, 20)}...`);

      let wallet: BitcoinWalletAddress;

      // Check if we've already processed this address
      const existingWallet = this.walletAddresses.find(w => w.address === userAddress);
      if (existingWallet) {
        wallet = existingWallet;
      } else {
        // Initialize this specific address (handles both xpub and regular addresses)
        wallet = {
          address: userAddress,
          type: BitcoinUtils.getAddressType(userAddress),
        };

        if (BitcoinUtils.isXpub(userAddress)) {
          this.logger.info(`Processing xpub: ${userAddress.substring(0, 20)}...`);
          await this.initializeXpubWallet(wallet);
        } else {
          this.logger.info(`Processing regular address: ${userAddress}`);
        }

        this.walletAddresses.push(wallet);
      }

      if (wallet.derivedAddresses) {
        // Xpub wallet - fetch from all derived addresses
        this.logger.info(`Fetching from ${wallet.derivedAddresses.length} derived addresses`);
        const walletSourcedTransactions = await this.fetchRawTransactionsForDerivedAddresses(
          wallet.derivedAddresses,
          params.since
        );
        allSourcedTransactions.push(...walletSourcedTransactions);
      } else {
        // Regular address - fetch directly
        try {
          const rawTransactions = await this.fetchRawTransactionsForAddress(userAddress, params.since);

          // Add the source address context to each transaction
          const enhancedSourcedTransactions: ApiClientRawData<BitcoinTransaction>[] = rawTransactions.map(rawTx => ({
            providerId: rawTx.providerId,
            rawData: rawTx.rawData,
            sourceAddress: userAddress,
          }));

          allSourcedTransactions.push(...enhancedSourcedTransactions);
        } catch (error) {
          this.handleImportError(error, `fetching transactions for ${userAddress}`);
        }
      }
    }

    // Remove duplicates based on txid
    const uniqueTransactions = this.removeDuplicateTransactions(allSourcedTransactions);

    // Get session metadata with derived addresses
    const derivedAddressesMetadata = this.getDerivedAddressesMetadata();
    const sessionMetadata: Record<string, unknown> = {};
    if (Object.keys(derivedAddressesMetadata).length > 0) {
      sessionMetadata.bitcoinDerivedAddresses = derivedAddressesMetadata;
      this.logger.info(
        `Captured derived addresses metadata for ${Object.keys(derivedAddressesMetadata).length} xpub wallets`
      );
    }

    this.logger.info(`Bitcoin import completed: ${uniqueTransactions.length} unique transactions`);
    return {
      metadata: Object.keys(sessionMetadata).length > 0 ? sessionMetadata : undefined,
      rawData: uniqueTransactions,
    };
  }
}
