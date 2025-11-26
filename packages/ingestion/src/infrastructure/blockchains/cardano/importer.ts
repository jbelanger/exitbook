import type {
  BlockchainProviderManager,
  CardanoTransaction,
  CardanoWalletAddress,
  TransactionWithRawData,
} from '@exitbook/blockchain-providers';
import { CardanoUtils, generateUniqueTransactionId } from '@exitbook/blockchain-providers';
import type { CursorState } from '@exitbook/core';
import { getLogger, type Logger } from '@exitbook/logger';
import { err, ok, type Result } from 'neverthrow';

import type { ImportParams, IImporter, ImportBatchResult } from '../../../types/importers.js';

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
   * Streaming import implementation
   * Streams transaction batches without accumulating everything in memory
   */
  async *importStreaming(params: ImportParams): AsyncIterableIterator<Result<ImportBatchResult, Error>> {
    if (!params.address) {
      yield err(new Error('Address required for Cardano transaction import'));
      return;
    }

    this.logger.info(`Starting Cardano streaming import for address: ${params.address.substring(0, 20)}...`);

    const wallet: CardanoWalletAddress = {
      address: params.address,
      type: CardanoUtils.isExtendedPublicKey(params.address) ? 'xpub' : 'address',
    };

    if (CardanoUtils.isExtendedPublicKey(params.address)) {
      this.logger.info(`Processing xpub: ${params.address.substring(0, 20)}...`);
      const initResult = await this.initializeXpubWallet(wallet);
      if (initResult.isErr()) {
        yield err(initResult.error);
        return;
      }
    } else {
      this.logger.info(`Processing regular address: ${params.address}`);
      const era = CardanoUtils.getAddressEra(params.address);
      wallet.era = era !== 'unknown' ? era : undefined;
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

    this.logger.info(`Cardano streaming import completed`);
  }

  /**
   * Stream transactions for a single address with resume support
   * Uses provider manager's streaming failover to handle pagination and provider switching
   */
  private async *streamTransactionsForAddress(
    address: string,
    resumeCursor?: CursorState
  ): AsyncIterableIterator<Result<ImportBatchResult, Error>> {
    const iterator = this.providerManager.executeWithFailover<TransactionWithRawData<CardanoTransaction>>(
      'cardano',
      {
        type: 'getAddressTransactions',
        address,
        getCacheKey: (params) =>
          `cardano:raw-txs:${params.type === 'getAddressTransactions' ? params.address : 'unknown'}:all`,
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
          amount: txWithRaw.normalized.outputs[0]?.amounts[0]?.quantity || '0',
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
      for await (const batchResult of this.streamTransactionsForAddress(address, resumeCursor)) {
        if (batchResult.isErr()) {
          this.logger.error(`Failed to stream transactions for address ${address}: ${batchResult.error.message}`);
          continue;
        }

        const batch = batchResult.value;

        // Deduplicate transactions (same tx can appear in multiple derived addresses)
        const uniqueTransactions = batch.rawTransactions.filter((tx) => {
          const normalizedTx = tx.normalizedData as CardanoTransaction;
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
   * Initialize an xpub wallet using CardanoUtils.
   */
  private async initializeXpubWallet(walletAddress: CardanoWalletAddress): Promise<Result<void, Error>> {
    return CardanoUtils.initializeXpubWallet(walletAddress, this.providerManager, this.addressGap);
  }
}
