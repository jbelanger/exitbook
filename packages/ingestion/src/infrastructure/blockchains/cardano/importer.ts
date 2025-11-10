import type {
  BlockchainProviderManager,
  CardanoTransaction,
  CardanoWalletAddress,
  ProviderError,
  TransactionWithRawData,
} from '@exitbook/blockchain-providers';
import { CardanoUtils, generateUniqueTransactionId } from '@exitbook/blockchain-providers';
import type { ExternalTransaction } from '@exitbook/core';
import { getLogger, type Logger } from '@exitbook/shared-logger';
import { err, ok, type Result } from 'neverthrow';

import type { ImportParams, IImporter, ImportRunResult } from '../../../types/importers.js';

/**
 * Cardano transaction importer that fetches raw transaction data from blockchain APIs.
 * Supports both regular Cardano addresses and extended public keys (xpub).
 * Uses provider manager for failover between multiple blockchain API providers.
 */
export class CardanoTransactionImporter implements IImporter {
  private readonly logger: Logger;
  private addressGap: number;
  private providerManager: BlockchainProviderManager;
  private walletAddresses: CardanoWalletAddress[] = [];

  constructor(
    blockchainProviderManager: BlockchainProviderManager,
    options?: { addressGap?: number; preferredProvider?: string | undefined }
  ) {
    this.logger = getLogger('cardanoImporter');

    if (!blockchainProviderManager) {
      throw new Error('Provider manager required for Cardano importer');
    }

    this.providerManager = blockchainProviderManager;
    this.addressGap = options?.addressGap || 10;

    this.providerManager.autoRegisterFromConfig('cardano', options?.preferredProvider);

    this.logger.info(
      `Initialized Cardano transaction importer - AddressGap: ${this.addressGap}, ProvidersCount: ${this.providerManager.getProviders('cardano').length}`
    );
  }

  /**
   * Import raw transaction data from Cardano blockchain APIs with provider provenance.
   */
  async import(params: ImportParams): Promise<Result<ImportRunResult, Error>> {
    if (!params.address) {
      return err(new Error('Address required for Cardano transaction import'));
    }

    this.logger.info(`Starting Cardano transaction import for address: ${params.address.substring(0, 20)}...`);

    const wallet: CardanoWalletAddress = {
      address: params.address,
      type: CardanoUtils.isExtendedPublicKey(params.address) ? 'xpub' : 'address',
    };

    if (CardanoUtils.isExtendedPublicKey(params.address)) {
      this.logger.info(`Processing xpub: ${params.address.substring(0, 20)}...`);
      const initResult = await this.initializeXpubWallet(wallet);
      if (initResult.isErr()) {
        return err(initResult.error);
      }
    } else {
      this.logger.info(`Processing regular address: ${params.address}`);
      const era = CardanoUtils.getAddressEra(params.address);
      wallet.era = era !== 'unknown' ? era : undefined;
    }

    this.walletAddresses.push(wallet);

    const result = wallet.derivedAddresses
      ? await this.fetchFromXpubWallet(wallet.derivedAddresses)
      : await this.fetchRawTransactionsForAddress(params.address);

    return result
      .map((allSourcedTransactions) => {
        this.logger.info(`Cardano import completed: ${allSourcedTransactions.length} transactions`);
        const metadata = wallet.derivedAddresses ? { derivedAddresses: wallet.derivedAddresses } : undefined;
        return { metadata, rawTransactions: allSourcedTransactions };
      })
      .mapErr((error) => {
        this.logger.error(`Failed to import transactions for address ${params.address} - Error: ${error.message}`);
        return error;
      });
  }

  /**
   * Fetch raw transactions for a single address with provider provenance.
   */
  private async fetchRawTransactionsForAddress(address: string): Promise<Result<ExternalTransaction[], ProviderError>> {
    const result = await this.providerManager.executeWithFailover('cardano', {
      address: address,
      getCacheKey: (params) =>
        `cardano:raw-txs:${params.type === 'getAddressTransactions' ? params.address : 'unknown'}:${params.type === 'getAddressTransactions' ? 'all' : 'unknown'}`,
      type: 'getAddressTransactions',
    });

    return result.map((response) => {
      const transactionsWithRaw = response.data as TransactionWithRawData<CardanoTransaction>[];
      const providerName = response.providerName;

      return transactionsWithRaw.map((txWithRaw) => ({
        externalId: generateUniqueTransactionId({
          amount: txWithRaw.normalized.outputs[0]?.amounts[0]?.quantity || '0',
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
   * Fetch transactions from xpub wallet's derived addresses.
   */
  private async fetchFromXpubWallet(derivedAddresses: string[]): Promise<Result<ExternalTransaction[], Error>> {
    this.logger.info(`Fetching from ${derivedAddresses.length} derived addresses`);
    const allSourcedTransactions = await this.fetchRawTransactionsForDerivedAddresses(derivedAddresses);
    return ok(allSourcedTransactions);
  }

  /**
   * Fetch raw transactions for derived addresses from an xpub wallet.
   */
  private async fetchRawTransactionsForDerivedAddresses(derivedAddresses: string[]): Promise<ExternalTransaction[]> {
    const uniqueTransactions = new Map<string, ExternalTransaction>();

    for (const address of derivedAddresses) {
      const result = await this.fetchRawTransactionsForAddress(address);

      if (result.isErr()) {
        this.logger.error(`Failed to fetch raw transactions for address ${address}: ${result.error.message}`);
        continue;
      }

      const rawTransactions = result.value;

      for (const rawTx of rawTransactions) {
        const normalizedTx = rawTx.normalizedData as CardanoTransaction;
        uniqueTransactions.set(normalizedTx.id, rawTx);
      }

      this.logger.debug(`Found ${rawTransactions.length} transactions for address ${address}`);
    }

    this.logger.info(`Found ${uniqueTransactions.size} unique raw transactions across all derived addresses`);
    return Array.from(uniqueTransactions.values());
  }

  /**
   * Initialize an xpub wallet using CardanoUtils.
   */
  private async initializeXpubWallet(walletAddress: CardanoWalletAddress): Promise<Result<void, Error>> {
    return CardanoUtils.initializeXpubWallet(walletAddress, this.providerManager, this.addressGap);
  }
}
