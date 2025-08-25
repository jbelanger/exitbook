import type { Logger } from '@crypto/shared-logger';
import { getLogger } from '@crypto/shared-logger';
import * as bitcoin from 'bitcoinjs-lib';

import type { IDependencyContainer } from '../../shared/common/interfaces.ts';
import type { IImporter, ImportParams, ValidationResult } from '../../shared/importers/interfaces.ts';
import type { SourcedRawData } from '../../shared/processors/interfaces.ts';
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
export class BitcoinTransactionImporter implements IImporter<SourcedRawData<BitcoinTransaction>> {
  private addressGap: number;
  private addressInfoCache = new Map<string, { balance: string; txCount: number }>();
  private logger: Logger;
  private providerManager: BlockchainProviderManager;
  private walletAddresses: BitcoinWalletAddress[] = [];

  constructor(dependencies: IDependencyContainer, options?: { addressGap?: number }) {
    this.logger = getLogger('BitcoinTransactionImporter');

    if (!dependencies.providerManager || !dependencies.explorerConfig) {
      throw new Error('Provider manager and explorer config required for Bitcoin importer');
    }

    this.providerManager = dependencies.providerManager;
    this.addressGap = options?.addressGap || 20;

    // Auto-register providers for bitcoin mainnet
    this.providerManager.autoRegisterFromConfig('bitcoin', 'mainnet');

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
  ): Promise<SourcedRawData<BitcoinTransaction>[]> {
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
  ): Promise<SourcedRawData<BitcoinTransaction>[]> {
    const uniqueSourcedTransactions = new Map<string, SourcedRawData<BitcoinTransaction>>();

    for (const address of derivedAddresses) {
      // Check cache first to see if this address has any transactions
      const cachedInfo = this.addressInfoCache.get(address);

      // Skip addresses that we know are empty from gap scanning
      if (cachedInfo && cachedInfo.txCount === 0) {
        this.logger.debug(`Skipping address ${address} - no transactions in cache`);
        continue;
      }

      try {
        const sourcedTransactions = await this.fetchRawTransactionsForAddress(address, since);

        // Add sourced transactions to the unique set with address information
        for (const sourcedTx of sourcedTransactions) {
          // Add the fetching address to the raw transaction data
          const enhancedRawData: BitcoinTransaction = { ...sourcedTx.rawData, fetchedByAddress: address };
          const txId = this.getTransactionId(enhancedRawData);

          uniqueSourcedTransactions.set(txId, {
            providerId: sourcedTx.providerId,
            rawData: enhancedRawData,
          });
        }

        this.logger.debug(`Found ${sourcedTransactions.length} transactions for address ${address}`);
      } catch (error) {
        this.logger.error(`Failed to fetch raw transactions for address ${address}: ${error}`);
      }
    }

    this.logger.info(`Found ${uniqueSourcedTransactions.size} unique raw transactions across all derived addresses`);
    return Array.from(uniqueSourcedTransactions.values());
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
    sourcedTransactions: SourcedRawData<BitcoinTransaction>[]
  ): SourcedRawData<BitcoinTransaction>[] {
    const uniqueTransactions = new Map<string, SourcedRawData<BitcoinTransaction>>();

    for (const sourcedTx of sourcedTransactions) {
      const txId = this.getTransactionId(sourcedTx.rawData);
      if (!uniqueTransactions.has(txId)) {
        uniqueTransactions.set(txId, sourcedTx);
      }
    }

    return Array.from(uniqueTransactions.values());
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
  async importFromSource(params: ImportParams): Promise<SourcedRawData<BitcoinTransaction>[]> {
    if (!params.addresses?.length) {
      throw new Error('Addresses required for Bitcoin transaction import');
    }

    this.logger.info(`Starting Bitcoin transaction import for ${params.addresses.length} addresses`);

    const allSourcedTransactions: SourcedRawData<BitcoinTransaction>[] = [];

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
          const sourcedTransactions = await this.fetchRawTransactionsForAddress(userAddress, params.since);

          // Add the fetching address to each raw transaction
          const enhancedSourcedTransactions: SourcedRawData<BitcoinTransaction>[] = sourcedTransactions.map(
            sourcedTx => ({
              providerId: sourcedTx.providerId,
              rawData: { ...sourcedTx.rawData, fetchedByAddress: userAddress },
            })
          );

          allSourcedTransactions.push(...enhancedSourcedTransactions);
        } catch (error) {
          this.logger.error(`Failed to fetch Bitcoin transactions for ${userAddress}: ${error}`);
          throw error;
        }
      }
    }

    // Remove duplicates based on txid
    const uniqueTransactions = this.removeDuplicateTransactions(allSourcedTransactions);

    this.logger.info(`Bitcoin import completed: ${uniqueTransactions.length} unique sourced transactions`);
    return uniqueTransactions;
  }

  /**
   * Validate sourced raw transaction data format using basic checks.
   * Detailed validation is delegated to provider-specific processors.
   */
  validateRawData(data: SourcedRawData<BitcoinTransaction>[]): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!Array.isArray(data)) {
      errors.push('Raw data must be an array');
      return { errors, isValid: false, warnings };
    }

    if (data.length === 0) {
      warnings.push('No transactions found in raw data');
    }

    // Basic validation - detailed validation delegated to providers
    for (let i = 0; i < data.length; i++) {
      const sourcedTx = data[i];
      if (!sourcedTx) {
        errors.push(`Sourced transaction at index ${i} is null or undefined`);
        continue;
      }

      if (!sourcedTx.rawData) {
        errors.push(`Sourced transaction at index ${i} missing raw data`);
        continue;
      }

      if (!sourcedTx.providerId) {
        errors.push(`Sourced transaction at index ${i} missing provider ID`);
        continue;
      }

      const txId = this.getTransactionId(sourcedTx.rawData);
      if (!txId || txId === 'unknown') {
        errors.push(`Transaction at index ${i} missing valid transaction ID`);
      }
    }

    return {
      errors,
      isValid: errors.length === 0,
      warnings,
    };
  }

  /**
   * Validate source parameters and connectivity.
   */
  async validateSource(params: ImportParams): Promise<boolean> {
    try {
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
    } catch (error) {
      this.logger.error(`Bitcoin source validation failed: ${error}`);
      return false;
    }
  }
}
