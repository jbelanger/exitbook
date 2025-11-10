import type {
  BitcoinChainConfig,
  BitcoinTransaction,
  BitcoinWalletAddress,
  BlockchainProviderManager,
  ProviderError,
  TransactionWithRawData,
} from '@exitbook/blockchain-providers';
import { BitcoinUtils, generateUniqueTransactionId } from '@exitbook/blockchain-providers';
import type { ExternalTransaction } from '@exitbook/core';
import { getLogger, type Logger } from '@exitbook/logger';
import { err, ok, type Result } from 'neverthrow';

import type { ImportParams, IImporter, ImportRunResult } from '../../../types/importers.js';

/**
 * Bitcoin transaction importer that fetches raw transaction data from blockchain APIs.
 * Supports both regular Bitcoin addresses and extended public keys (xpub/ypub/zpub).
 * Uses provider manager for failover between multiple blockchain API providers.
 */
export class BitcoinTransactionImporter implements IImporter {
  private readonly chainConfig: BitcoinChainConfig;
  private readonly logger: Logger;
  private addressGap: number;
  private addressInfoCache = new Map<string, { balance: string; txCount: number }>();
  private providerManager: BlockchainProviderManager;
  private walletAddresses: BitcoinWalletAddress[] = [];

  constructor(
    chainConfig: BitcoinChainConfig,
    blockchainProviderManager: BlockchainProviderManager,
    options?: { addressGap?: number; preferredProvider?: string | undefined }
  ) {
    this.chainConfig = chainConfig;
    this.logger = getLogger(`${this.chainConfig.chainName}Importer`);

    if (!blockchainProviderManager) {
      throw new Error(`Provider manager required for ${this.chainConfig.chainName} importer`);
    }

    this.providerManager = blockchainProviderManager;
    this.addressGap = options?.addressGap || 20;

    this.providerManager.autoRegisterFromConfig(this.chainConfig.chainName, options?.preferredProvider);

    this.logger.info(
      `Initialized Bitcoin transaction importer - AddressGap: ${this.addressGap}, ProvidersCount: ${this.providerManager.getProviders(this.chainConfig.chainName).length}`
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

    const wallet: BitcoinWalletAddress = {
      address: params.address,
      type: BitcoinUtils.getAddressType(params.address),
    };

    if (BitcoinUtils.isXpub(params.address)) {
      this.logger.info(`Processing xpub: ${params.address.substring(0, 20)}...`);
      const initResult = await this.initializeXpubWallet(wallet);
      if (initResult.isErr()) {
        return err(initResult.error);
      }
    } else {
      this.logger.info(`Processing regular address: ${params.address}`);
    }

    this.walletAddresses.push(wallet);

    const result = wallet.derivedAddresses
      ? await this.fetchFromXpubWallet(wallet.derivedAddresses)
      : await this.fetchRawTransactionsForAddress(params.address);

    return result
      .map((allSourcedTransactions) => {
        this.logger.info(`Bitcoin import completed: ${allSourcedTransactions.length} transactions`);
        const metadata = wallet.derivedAddresses ? { derivedAddresses: wallet.derivedAddresses } : undefined;
        return { metadata, rawTransactions: allSourcedTransactions };
      })
      .mapErr((error) => {
        this.logger.error(`Failed to import transactions for address ${params.address} - Error: ${error.message}`);
        return error;
      });
  }

  /**
   * Fetch transactions from xpub wallet's derived addresses.
   */
  private async fetchFromXpubWallet(derivedAddresses: string[]): Promise<Result<ExternalTransaction[], Error>> {
    this.logger.info(`Fetching from ${derivedAddresses.length} derived addresses`);
    const allSourcedTransactions = await this.fetchRawTransactionsForDerivedAddresses(derivedAddresses);
    return ok(allSourcedTransactions);
  }

  /**
   * Fetch raw transactions for a single address with provider provenance.
   */
  private async fetchRawTransactionsForAddress(address: string): Promise<Result<ExternalTransaction[], ProviderError>> {
    const result = await this.providerManager.executeWithFailover(this.chainConfig.chainName, {
      address: address,
      getCacheKey: (params) =>
        `${this.chainConfig.chainName}:raw-txs:${params.type === 'getAddressTransactions' ? params.address : 'unknown'}:${params.type === 'getAddressTransactions' ? 'all' : 'unknown'}`,
      type: 'getAddressTransactions',
    });

    return result.map((response) => {
      const transactionsWithRaw = response.data as TransactionWithRawData<BitcoinTransaction>[];
      const providerName = response.providerName;

      return transactionsWithRaw.map((txWithRaw) => ({
        externalId: generateUniqueTransactionId({
          amount: txWithRaw.normalized.outputs[0]?.value || '0',
          currency: txWithRaw.normalized.currency,
          from: txWithRaw.normalized.inputs[0]?.address || '',
          id: txWithRaw.normalized.id,
          timestamp: txWithRaw.normalized.timestamp,
          to: txWithRaw.normalized.outputs[0]?.address,
          type: 'transfer',
        }),
        normalizedData: txWithRaw.normalized,
        providerName,
        rawData: txWithRaw.raw,
        sourceAddress: address,
      }));
    });
  }

  /**
   * Fetch raw transactions for derived addresses from an xpub wallet.
   */
  private async fetchRawTransactionsForDerivedAddresses(derivedAddresses: string[]): Promise<ExternalTransaction[]> {
    const uniqueTransactions = new Map<string, ExternalTransaction>();

    for (const address of derivedAddresses) {
      const cachedInfo = this.addressInfoCache.get(address);

      if (cachedInfo && cachedInfo.txCount === 0) {
        this.logger.debug(`Skipping address ${address} - no transactions in cache`);
        continue;
      }

      const result = await this.fetchRawTransactionsForAddress(address);

      if (result.isErr()) {
        this.logger.error(`Failed to fetch raw transactions for address ${address}: ${result.error.message}`);
        continue;
      }

      const rawTransactions = result.value;

      for (const rawTx of rawTransactions) {
        const normalizedTx = rawTx.normalizedData as BitcoinTransaction;
        uniqueTransactions.set(normalizedTx.id, rawTx);
      }

      this.logger.debug(`Found ${rawTransactions.length} transactions for address ${address}`);
    }

    this.logger.info(`Found ${uniqueTransactions.size} unique raw transactions across all derived addresses`);
    return Array.from(uniqueTransactions.values());
  }

  /**
   * Initialize an xpub wallet using BitcoinUtils.
   */
  private async initializeXpubWallet(walletAddress: BitcoinWalletAddress): Promise<Result<void, Error>> {
    return BitcoinUtils.initializeXpubWallet(
      walletAddress,
      this.chainConfig.chainName,
      this.providerManager,
      this.addressGap
    );
  }
}
