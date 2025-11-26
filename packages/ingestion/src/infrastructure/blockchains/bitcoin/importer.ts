import type {
  BitcoinChainConfig,
  BitcoinTransaction,
  BitcoinWalletAddress,
  BlockchainProviderManager,
  TransactionWithRawData,
} from '@exitbook/blockchain-providers';
import { BitcoinUtils, generateUniqueTransactionId } from '@exitbook/blockchain-providers';
import type { CursorState } from '@exitbook/core';
import { getLogger, type Logger } from '@exitbook/logger';
import { err, ok, type Result } from 'neverthrow';

import type { ImportParams, IImporter, ImportBatchResult } from '../../../types/importers.js';

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
   * Streaming import implementation
   * Streams transaction batches without accumulating everything in memory
   */
  async *importStreaming(params: ImportParams): AsyncIterableIterator<Result<ImportBatchResult, Error>> {
    if (!params.address) {
      yield err(new Error('Address required for Bitcoin transaction import'));
      return;
    }

    this.logger.info(`Starting Bitcoin streaming import for address: ${params.address.substring(0, 20)}...`);

    const wallet: BitcoinWalletAddress = {
      address: params.address,
      type: BitcoinUtils.getAddressType(params.address),
    };

    if (BitcoinUtils.isXpub(params.address)) {
      this.logger.info(`Processing xpub: ${params.address.substring(0, 20)}...`);
      const initResult = await this.initializeXpubWallet(wallet);
      if (initResult.isErr()) {
        yield err(initResult.error);
        return;
      }
    } else {
      this.logger.info(`Processing regular address: ${params.address}`);
    }

    this.walletAddresses.push(wallet);

    // Stream transactions
    const normalCursor = params.cursor?.['normal'];
    if (wallet.derivedAddresses) {
      // For xpub wallets, stream from all derived addresses
      for await (const batchResult of this.streamFromXpubWallet(wallet.derivedAddresses, normalCursor)) {
        yield batchResult;
      }
    } else {
      // For regular addresses, stream directly
      for await (const batchResult of this.streamTransactionsForAddress(params.address, normalCursor)) {
        yield batchResult;
      }
    }

    this.logger.info(`Bitcoin streaming import completed`);
  }

  /**
   * Stream transactions for a single address with resume support
   * Uses provider manager's streaming failover to handle pagination and provider switching
   */
  private async *streamTransactionsForAddress(
    address: string,
    resumeCursor?: CursorState
  ): AsyncIterableIterator<Result<ImportBatchResult, Error>> {
    const iterator = this.providerManager.executeWithFailover<TransactionWithRawData<BitcoinTransaction>>(
      this.chainConfig.chainName,
      {
        type: 'getAddressTransactions',
        address,
        getCacheKey: (params) =>
          `${this.chainConfig.chainName}:raw-txs:${params.type === 'getAddressTransactions' ? params.address : 'unknown'}:all`,
      },
      resumeCursor
    );

    for await (const providerBatchResult of iterator) {
      if (providerBatchResult.isErr()) {
        yield err(providerBatchResult.error);
        return;
      }

      const providerBatch = providerBatchResult.value;
      const transactionsWithRaw = providerBatch.data;

      // Map to external transactions
      const externalTransactions = transactionsWithRaw.map((txWithRaw) => ({
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
        providerName: providerBatch.providerName,
        rawData: txWithRaw.raw,
        sourceAddress: address,
      }));

      yield ok({
        rawTransactions: externalTransactions,
        operationType: 'normal',
        cursor: providerBatch.cursor,
        isComplete: providerBatch.cursor.metadata?.isComplete ?? false,
      });
    }
  }

  /**
   * Stream transactions from xpub wallet's derived addresses
   * Deduplicates transactions across addresses
   */
  private async *streamFromXpubWallet(
    derivedAddresses: string[],
    resumeCursor?: CursorState
  ): AsyncIterableIterator<Result<ImportBatchResult, Error>> {
    this.logger.info(`Streaming from ${derivedAddresses.length} derived addresses`);

    // Track unique transactions across all addresses
    const seenTransactionIds = new Set<string>();

    for (const address of derivedAddresses) {
      const cachedInfo = this.addressInfoCache.get(address);

      if (cachedInfo && cachedInfo.txCount === 0) {
        this.logger.debug(`Skipping address ${address} - no transactions in cache`);
        continue;
      }

      for await (const batchResult of this.streamTransactionsForAddress(address, resumeCursor)) {
        if (batchResult.isErr()) {
          this.logger.error(`Failed to stream transactions for address ${address}: ${batchResult.error.message}`);
          continue;
        }

        const batch = batchResult.value;

        // Deduplicate transactions (same tx can appear in multiple derived addresses)
        const uniqueTransactions = batch.rawTransactions.filter((tx) => {
          const normalizedTx = tx.normalizedData as BitcoinTransaction;
          if (seenTransactionIds.has(normalizedTx.id)) {
            return false;
          }
          seenTransactionIds.add(normalizedTx.id);
          return true;
        });

        // Only yield if we have unique transactions
        if (uniqueTransactions.length > 0) {
          yield ok({
            ...batch,
            rawTransactions: uniqueTransactions,
          });
        }

        this.logger.debug(`Found ${uniqueTransactions.length} unique transactions for address ${address}`);
      }
    }

    this.logger.info(`Found ${seenTransactionIds.size} unique transactions across all derived addresses`);
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
