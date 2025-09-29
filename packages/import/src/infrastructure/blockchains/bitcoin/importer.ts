import type { ApiClientRawData, ImportParams, ImportRunResult } from '@exitbook/import/app/ports/importers.js';
import * as bitcoin from 'bitcoinjs-lib';
import { err, ok, type Result } from 'neverthrow';

import { BaseImporter } from '../../shared/importers/base-importer.js';
import type { BlockchainProviderManager, ProviderError } from '../shared/blockchain-provider-manager.js';

import type { BitcoinWalletAddress } from './types.js';
import { BitcoinUtils } from './utils.js';

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
  async import(params: ImportParams): Promise<Result<ImportRunResult, Error>> {
    if (!params.address) {
      return err(new Error('Address required for Bitcoin transaction import'));
    }

    this.logger.info(`Starting Bitcoin transaction import for address: ${params.address.substring(0, 20)}...`);

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

    // Fetch transactions based on wallet type
    const result = wallet.derivedAddresses
      ? await this.fetchFromXpubWallet(wallet.derivedAddresses, params.since)
      : await this.fetchRawTransactionsForAddress(params.address, params.since);

    return result
      .map((allSourcedTransactions) => {
        this.logger.info(`Bitcoin import completed: ${allSourcedTransactions.length} transactions`);
        const metadata = wallet.derivedAddresses ? { derivedAddresses: wallet.derivedAddresses } : undefined;
        return { metadata, rawData: allSourcedTransactions };
      })
      .mapErr((error) => {
        this.logger.error(`Failed to import transactions for address ${params.address} - Error: ${error.message}`);
        return error;
      });
  }

  /**
   * Fetch transactions from xpub wallet's derived addresses.
   */
  private async fetchFromXpubWallet(
    derivedAddresses: string[],
    since?: number
  ): Promise<Result<ApiClientRawData[], Error>> {
    this.logger.info(`Fetching from ${derivedAddresses.length} derived addresses`);
    const allSourcedTransactions = await this.fetchRawTransactionsForDerivedAddresses(derivedAddresses, since);
    return ok(allSourcedTransactions);
  }

  /**
   * Fetch raw transactions for a single address with provider provenance.
   */
  private async fetchRawTransactionsForAddress(
    address: string,
    since?: number
  ): Promise<Result<ApiClientRawData[], ProviderError>> {
    const result = await this.providerManager.executeWithFailover('bitcoin', {
      address: address,
      getCacheKey: (params) =>
        `bitcoin:raw-txs:${params.type === 'getRawAddressTransactions' ? params.address : 'unknown'}:${params.type === 'getRawAddressTransactions' ? params.since || 'all' : 'unknown'}`,
      since: since,
      type: 'getRawAddressTransactions',
    });

    return result.map((response) => {
      const rawTransactions = response.data as unknown[];
      const providerId = response.providerName;

      // Wrap each transaction with provider provenance
      return rawTransactions.map((rawData) => ({
        metadata: {
          providerId,
          sourceAddress: address,
        },
        rawData,
      }));
    });
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

      const result = await this.fetchRawTransactionsForAddress(address, since);

      if (result.isErr()) {
        this.logger.error(`Failed to fetch raw transactions for address ${address}: ${result.error.message}`);
        continue;
      }

      const rawTransactions = result.value;

      // Add transactions to the unique set with address information
      for (const rawTx of rawTransactions) {
        const txId = this.getTransactionId(rawTx.rawData);
        uniqueTransactions.set(txId, rawTx);
      }

      this.logger.debug(`Found ${rawTransactions.length} transactions for address ${address}`);
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
