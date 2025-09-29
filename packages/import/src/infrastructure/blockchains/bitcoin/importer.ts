import * as bitcoin from 'bitcoinjs-lib';

import type { ApiClientRawData, ImportParams, ImportRunResult } from '../../../app/ports/importers.ts';
import { BaseImporter } from '../../shared/importers/base-importer.ts';

import './api/index.ts';
import type { BlockchainProviderManager } from '../shared/blockchain-provider-manager.ts';

import type { BitcoinWalletAddress } from './types.ts';
import { BitcoinUtils } from './utils.ts';

/**
 * Bitcoin transaction importer that fetches raw transaction data from blockchain APIs.
 * Supports both regular Bitcoin addresses and extended public keys (xpub/ypub/zpub).
 * Uses provider manager for failover between multiple blockchain API providers.
 */
export class BitcoinTransactionImporter extends BaseImporter {
  private addressGap: number;
  private addressInfoCache = new Map<string, { balance: string; txCount: number }>();
  private providerManager: BlockchainProviderManager;
  private walletAddresses: BitcoinWalletAddress[] = [];

  constructor(
    blockchainProviderManager: BlockchainProviderManager,
    options?: { addressGap?: number; preferredProvider?: string | undefined }
  ) {
    super('bitcoin');

    if (!blockchainProviderManager) {
      throw new Error('Provider manager required for Bitcoin importer');
    }

    this.providerManager = blockchainProviderManager;
    this.addressGap = options?.addressGap || 20;

    // Auto-register providers for bitcoin mainnet
    this.providerManager.autoRegisterFromConfig('bitcoin', 'mainnet', options?.preferredProvider);

    this.logger.info(
      `Initialized Bitcoin transaction importer - AddressGap: ${this.addressGap}, ProvidersCount: ${this.providerManager.getProviders('bitcoin').length}`
    );
  }

  /**
   * Import raw transaction data from Bitcoin blockchain APIs with provider provenance.
   */
  async import(params: ImportParams): Promise<ImportRunResult> {
    if (!params.address) {
      throw new Error('Address required for Bitcoin transaction import');
    }

    this.logger.info(`Starting Bitcoin transaction import for address: ${params.address.substring(0, 20)}...`);

    const allSourcedTransactions: ApiClientRawData[] = [];

    this.logger.info(`Importing transactions for address: ${params.address.substring(0, 20)}...`);

    // Initialize wallet for this address (handles both xpub and regular addresses)
    const wallet: BitcoinWalletAddress = {
      address: params.address,
      type: BitcoinUtils.getAddressType(params.address),
    };

    if (BitcoinUtils.isXpub(params.address)) {
      this.logger.info(`Processing xpub: ${params.address.substring(0, 20)}...`);
      await this.initializeXpubWallet(wallet);
    } else {
      this.logger.info(`Processing regular address: ${params.address}`);
    }

    this.walletAddresses.push(wallet);

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
        const rawTransactions = await this.fetchRawTransactionsForAddress(params.address, params.since);
        allSourcedTransactions.push(...rawTransactions);
      } catch (error) {
        this.handleImportError(error, `fetching transactions for ${params.address}`);
      }
    }

    this.logger.info(`Bitcoin import completed: ${allSourcedTransactions.length} transactions`);

    // Include derived addresses in metadata if this is an xpub wallet
    const metadata = wallet.derivedAddresses ? { derivedAddresses: wallet.derivedAddresses } : undefined;

    return {
      metadata,
      rawData: allSourcedTransactions,
    };
  }

  /**
   * Validate source parameters and connectivity.
   */
  protected canImportSpecific(params: ImportParams): Promise<boolean> {
    if (!params.address) {
      this.logger.error('No address provided for Bitcoin import');
      return Promise.resolve(false);
    }

    // Validate address formats
    if (!this.isValidBitcoinAddress(params.address)) {
      this.logger.error(`Invalid Bitcoin address format: ${params.address}`);
      return Promise.resolve(false);
    }

    // Test provider connectivity
    const healthStatus = this.providerManager.getProviderHealth('bitcoin');
    const hasHealthyProvider = Array.from(healthStatus.values()).some(
      (health) => health.isHealthy && health.circuitState !== 'OPEN'
    );

    if (!hasHealthyProvider) {
      this.logger.error('No healthy Bitcoin providers available');
      return Promise.resolve(false);
    }

    this.logger.info('Bitcoin source validation passed');
    return Promise.resolve(true);
  }

  /**
   * Fetch raw transactions for a single address with provider provenance.
   */
  private async fetchRawTransactionsForAddress(address: string, since?: number): Promise<ApiClientRawData[]> {
    try {
      const result = await this.providerManager.executeWithFailover('bitcoin', {
        address: address,
        getCacheKey: (params) =>
          `bitcoin:raw-txs:${params.type === 'getRawAddressTransactions' ? params.address : 'unknown'}:${params.type === 'getRawAddressTransactions' ? params.since || 'all' : 'unknown'}`,
        since: since,
        type: 'getRawAddressTransactions',
      });

      const rawTransactions = result.data as unknown[];
      const providerId = result.providerName;

      // Wrap each transaction with provider provenance
      return rawTransactions.map((rawData) => ({
        metadata: {
          providerId,
          sourceAddress: address,
        },
        rawData,
      }));
    } catch (error) {
      this.logger.error(`Provider manager failed to fetch transactions for ${address}: ${String(error)}`);
      throw error;
    }
  }

  /**
   * Fetch raw transactions for derived addresses from an xpub wallet.
   */
  private async fetchRawTransactionsForDerivedAddresses(
    derivedAddresses: string[],
    since?: number
  ): Promise<ApiClientRawData[]> {
    const uniqueTransactions = new Map<string, ApiClientRawData>();

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
          uniqueTransactions.set(txId, rawTx);
        }

        this.logger.debug(`Found ${rawTransactions.length} transactions for address ${address}`);
      } catch (error) {
        this.logger.error(`Failed to fetch raw transactions for address ${address}: ${String(error)}`);
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
   * Get transaction ID from any Bitcoin transaction type
   */
  private getTransactionId(tx: unknown): string {
    // Handle different transaction formats
    if (typeof tx === 'object' && tx !== null) {
      if ('txid' in tx && typeof (tx as { txid?: unknown }).txid === 'string') {
        return (tx as { txid: string }).txid; // MempoolTransaction, BlockstreamTransaction
      } else if ('hash' in tx && typeof (tx as { hash?: unknown }).hash === 'string') {
        return (tx as { hash: string }).hash; // BlockCypherTransaction
      }
    }
    return 'unknown';
  }
}
