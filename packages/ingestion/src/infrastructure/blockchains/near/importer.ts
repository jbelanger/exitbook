import type { ExternalTransaction } from '@exitbook/core';
import { getErrorMessage } from '@exitbook/core';
import type {
  BlockchainProviderManager,
  NearAccountChange,
  NearBlocksActivity,
  NearBlocksFtTransaction,
  NearBlocksReceipt,
  NearTokenTransfer,
  NearTransaction,
  ProviderError,
  TransactionWithRawData,
} from '@exitbook/providers';
import {
  generateUniqueTransactionId,
  mapNearBlocksActivityToAccountChange,
  mapNearBlocksFtTransactionToTokenTransfer,
} from '@exitbook/providers';
import { getLogger, type Logger } from '@exitbook/shared-logger';
import { err, ok, type Result } from 'neverthrow';

import type { IImporter, ImportParams, ImportRunResult } from '../../../types/importers.js';

/**
 * Bundle of all NearBlocks account data indexed for efficient lookup
 */
interface AccountDataIndexes {
  /** Map of transaction hash to array of receipts */
  receiptsByTxHash: Map<string, NearBlocksReceipt[]>;
  /** Map of receipt ID to array of activities */
  activitiesByReceiptId: Map<string, NearBlocksActivity[]>;
  /** Map of transaction hash to array of FT transfers */
  ftTransfersByTxHash: Map<string, NearBlocksFtTransaction[]>;
}

/**
 * NEAR transaction importer that fetches raw transaction data from blockchain APIs.
 * Supports NEAR account IDs using multiple providers (NearBlocks).
 * Uses provider manager for failover between multiple blockchain API providers.
 *
 * Phase 2 Enhancement: Enriches base transactions with:
 * - Account changes (native NEAR balance deltas) from /activity endpoint
 * - Token transfers (NEP-141) from /ft-txns endpoint
 * Correlates data via /receipts endpoint to link activities to transactions.
 */
export class NearTransactionImporter implements IImporter {
  private readonly logger: Logger;
  private providerManager: BlockchainProviderManager;

  constructor(
    blockchainProviderManager: BlockchainProviderManager,
    options?: { preferredProvider?: string | undefined }
  ) {
    this.logger = getLogger('nearImporter');

    this.providerManager = blockchainProviderManager;

    if (!this.providerManager) {
      throw new Error('Provider manager required for NEAR importer');
    }

    this.providerManager.autoRegisterFromConfig('near', options?.preferredProvider);

    this.logger.info(
      `Initialized NEAR transaction importer - ProvidersCount: ${this.providerManager.getProviders('near').length}`
    );
  }

  /**
   * Import raw transaction data from NEAR blockchain APIs with provider provenance.
   */
  async import(params: ImportParams): Promise<Result<ImportRunResult, Error>> {
    if (!params.address) {
      return err(new Error('Address required for NEAR transaction import'));
    }

    this.logger.info(`Starting NEAR transaction import for account: ${params.address.substring(0, 20)}...`);

    const result = await this.fetchRawTransactionsForAddress(params.address);

    return result
      .map((rawTransactions) => {
        this.logger.info(`NEAR import completed: ${rawTransactions.length} transactions`);
        return { rawTransactions: rawTransactions };
      })
      .mapErr((error) => {
        this.logger.error(`Failed to import transactions for address ${params.address} - Error: ${error.message}`);
        return error;
      });
  }

  /**
   * Fetch raw transactions for a single address with provider provenance.
   * Enriches base transactions with account changes and token transfers.
   */
  private async fetchRawTransactionsForAddress(address: string): Promise<Result<ExternalTransaction[], ProviderError>> {
    // Step 1: Fetch base transactions
    const baseResult = await this.providerManager.executeWithFailover('near', {
      address: address,
      getCacheKey: (params) =>
        `near:raw-txs:${params.type === 'getAddressTransactions' ? params.address : 'unknown'}:${params.type === 'getAddressTransactions' ? 'all' : 'unknown'}`,
      type: 'getAddressTransactions',
    });

    if (baseResult.isErr()) {
      return err(baseResult.error);
    }

    const transactionsWithRaw = baseResult.value.data as TransactionWithRawData<NearTransaction>[];
    const providerName = baseResult.value.providerName;

    this.logger.info(
      `Fetched ${transactionsWithRaw.length} base transactions - Provider: ${providerName}, Address: ${address.substring(0, 20)}...`
    );

    // Step 2: Fetch enrichment data (receipts, activities, ft-txns)
    const enrichmentResult = await this.fetchEnrichmentData(address, providerName);

    // Step 3: Build indexes for efficient lookup
    const indexes = enrichmentResult.isOk() ? this.buildDataIndexes(enrichmentResult.value) : this.createEmptyIndexes();

    if (enrichmentResult.isErr()) {
      this.logger.warn(
        `Failed to fetch enrichment data, proceeding in degraded mode - Error: ${enrichmentResult.error.message}`
      );
    } else {
      this.logger.info(
        `Built enrichment indexes - Receipts: ${indexes.receiptsByTxHash.size}, Activities: ${indexes.activitiesByReceiptId.size}, FT Transfers: ${indexes.ftTransfersByTxHash.size}`
      );
    }

    // Step 4: Enrich transactions with account changes and token transfers
    const enrichedTransactions = transactionsWithRaw.map((txWithRaw) =>
      this.enrichTransaction(txWithRaw, indexes, address)
    );

    // Step 5: Convert to ExternalTransaction format
    return ok(
      enrichedTransactions.map((txWithRaw) => ({
        externalId: generateUniqueTransactionId({
          amount: txWithRaw.normalized.amount,
          currency: txWithRaw.normalized.currency,
          from: txWithRaw.normalized.from,
          id: txWithRaw.normalized.id,
          timestamp: txWithRaw.normalized.timestamp,
          to: txWithRaw.normalized.to,
          traceId: txWithRaw.normalized.id,
          type: 'transfer',
        }),
        normalizedData: txWithRaw.normalized,
        providerName,
        rawData: txWithRaw.raw,
        sourceAddress: address,
      }))
    );
  }

  /**
   * Fetch enrichment data from multiple NearBlocks endpoints
   */
  private async fetchEnrichmentData(
    address: string,
    providerName: string
  ): Promise<
    Result<
      {
        activities: NearBlocksActivity[];
        ftTransactions: NearBlocksFtTransaction[];
        receipts: NearBlocksReceipt[];
      },
      Error
    >
  > {
    try {
      // Get the provider instance to call the new methods directly
      const provider = this.providerManager.getProviders('near').find((p) => p.name === providerName);

      if (!provider) {
        return err(new Error(`Provider ${providerName} not found`));
      }

      // Type assertion to access NearBlocks-specific methods
      const nearBlocksProvider = provider as unknown as {
        getAccountActivities: (
          address: string,
          page: number,
          perPage: number
        ) => Promise<Result<NearBlocksActivity[], Error>>;
        getAccountFtTransactions: (
          address: string,
          page: number,
          perPage: number
        ) => Promise<Result<NearBlocksFtTransaction[], Error>>;
        getAccountReceipts: (
          address: string,
          page: number,
          perPage: number
        ) => Promise<Result<NearBlocksReceipt[], Error>>;
      };

      // Fetch all enrichment data with pagination
      const [receiptsResult, activitiesResult, ftTransactionsResult] = await Promise.all([
        this.fetchAllPages(
          (page, perPage) => nearBlocksProvider.getAccountReceipts(address, page, perPage),
          'receipts'
        ),
        this.fetchAllPages(
          (page, perPage) => nearBlocksProvider.getAccountActivities(address, page, perPage),
          'activities'
        ),
        this.fetchAllPages(
          (page, perPage) => nearBlocksProvider.getAccountFtTransactions(address, page, perPage),
          'ft-transactions'
        ),
      ]);

      // Check for errors but don't fail the entire import
      const receipts = receiptsResult.isOk() ? receiptsResult.value : [];
      const activities = activitiesResult.isOk() ? activitiesResult.value : [];
      const ftTransactions = ftTransactionsResult.isOk() ? ftTransactionsResult.value : [];

      if (receiptsResult.isErr()) {
        this.logger.warn(`Failed to fetch receipts - Error: ${receiptsResult.error.message}`);
      }
      if (activitiesResult.isErr()) {
        this.logger.warn(`Failed to fetch activities - Error: ${activitiesResult.error.message}`);
      }
      if (ftTransactionsResult.isErr()) {
        this.logger.warn(`Failed to fetch FT transactions - Error: ${ftTransactionsResult.error.message}`);
      }

      return ok({
        activities,
        ftTransactions,
        receipts,
      });
    } catch (error) {
      return err(new Error(`Failed to fetch enrichment data: ${getErrorMessage(error)}`));
    }
  }

  /**
   * Fetch all pages for a given endpoint
   * Handles pagination automatically until no more data is available
   */
  private async fetchAllPages<T>(
    fetchPage: (page: number, perPage: number) => Promise<Result<T[], Error>>,
    dataType: string
  ): Promise<Result<T[], Error>> {
    const allItems: T[] = [];
    let page = 1;
    const perPage = 50; // Max allowed by NearBlocks
    const maxPages = 20; // Limit to 1000 items (20 * 50)

    this.logger.debug(`Fetching ${dataType} - Starting pagination`);

    while (page <= maxPages) {
      const result = await fetchPage(page, perPage);

      if (result.isErr()) {
        // If first page fails, return error
        if (page === 1) {
          this.logger.error(`Failed to fetch ${dataType} page ${page} - Error: ${result.error.message}`);
          return err(result.error);
        }
        // If subsequent pages fail, break and return what we have
        this.logger.warn(`Failed to fetch ${dataType} page ${page} - Error: ${result.error.message}`);
        break;
      }

      const items = result.value;

      if (items.length === 0) {
        // No more items
        break;
      }

      allItems.push(...items);

      this.logger.debug(`Fetched ${dataType} page ${page} - Items: ${items.length}`);

      // If we got fewer items than requested, we've reached the end
      if (items.length < perPage) {
        break;
      }

      page++;
    }

    this.logger.debug(`Total ${dataType} fetched - Count: ${allItems.length}`);

    return ok(allItems);
  }

  /**
   * Build indexes for efficient data lookup
   */
  private buildDataIndexes(data: {
    activities: NearBlocksActivity[];
    ftTransactions: NearBlocksFtTransaction[];
    receipts: NearBlocksReceipt[];
  }): AccountDataIndexes {
    const receiptsByTxHash = new Map<string, NearBlocksReceipt[]>();
    const activitiesByReceiptId = new Map<string, NearBlocksActivity[]>();
    const ftTransfersByTxHash = new Map<string, NearBlocksFtTransaction[]>();

    // Index receipts by transaction hash
    for (const receipt of data.receipts) {
      const txHash = receipt.originated_from_transaction_hash;
      if (!receiptsByTxHash.has(txHash)) {
        receiptsByTxHash.set(txHash, []);
      }
      receiptsByTxHash.get(txHash)!.push(receipt);
    }

    // Index activities by receipt ID
    for (const activity of data.activities) {
      const receiptId = activity.receipt_id;
      if (!activitiesByReceiptId.has(receiptId)) {
        activitiesByReceiptId.set(receiptId, []);
      }
      activitiesByReceiptId.get(receiptId)!.push(activity);
    }

    // Index FT transfers by transaction hash
    for (const ftTx of data.ftTransactions) {
      if (ftTx.transaction_hash) {
        if (!ftTransfersByTxHash.has(ftTx.transaction_hash)) {
          ftTransfersByTxHash.set(ftTx.transaction_hash, []);
        }
        ftTransfersByTxHash.get(ftTx.transaction_hash)!.push(ftTx);
      }
    }

    return {
      activitiesByReceiptId,
      ftTransfersByTxHash,
      receiptsByTxHash,
    };
  }

  /**
   * Create empty indexes for degraded mode
   */
  private createEmptyIndexes(): AccountDataIndexes {
    return {
      activitiesByReceiptId: new Map(),
      ftTransfersByTxHash: new Map(),
      receiptsByTxHash: new Map(),
    };
  }

  /**
   * Enrich a transaction with account changes and token transfers
   */
  private enrichTransaction(
    txWithRaw: TransactionWithRawData<NearTransaction>,
    indexes: AccountDataIndexes,
    accountId: string
  ): TransactionWithRawData<NearTransaction> {
    const txHash = txWithRaw.normalized.id;

    // Step 1: Get receipts for this transaction
    const receipts = indexes.receiptsByTxHash.get(txHash) || [];

    // Step 2: Collect all activities linked via receipts
    const accountChanges: NearAccountChange[] = [];
    for (const receipt of receipts) {
      const activities = indexes.activitiesByReceiptId.get(receipt.receipt_id) || [];
      for (const activity of activities) {
        const changeResult = mapNearBlocksActivityToAccountChange(activity, accountId);
        if (changeResult.isOk()) {
          accountChanges.push(changeResult.value);
        } else {
          const errorMessage =
            changeResult.error.type === 'error' ? changeResult.error.message : changeResult.error.reason;
          this.logger.warn(
            `Failed to map activity to account change - TxHash: ${txHash}, ReceiptId: ${receipt.receipt_id}, Error: ${errorMessage}`
          );
        }
      }
    }

    // Step 3: Get FT transfers for this transaction
    const ftTxs = indexes.ftTransfersByTxHash.get(txHash) || [];
    const tokenTransfers: NearTokenTransfer[] = [];
    for (const ftTx of ftTxs) {
      const transferResult = mapNearBlocksFtTransactionToTokenTransfer(ftTx, accountId);
      if (transferResult.isOk()) {
        tokenTransfers.push(transferResult.value);
      } else {
        const errorMessage =
          transferResult.error.type === 'error' ? transferResult.error.message : transferResult.error.reason;
        this.logger.warn(`Failed to map FT transaction to token transfer - TxHash: ${txHash}, Error: ${errorMessage}`);
      }
    }

    // Step 4: Attach enriched data to the normalized transaction
    const enrichedNormalized: NearTransaction = {
      ...txWithRaw.normalized,
    };

    if (accountChanges.length > 0) {
      enrichedNormalized.accountChanges = accountChanges;
    }

    if (tokenTransfers.length > 0) {
      enrichedNormalized.tokenTransfers = tokenTransfers;
    }

    if (accountChanges.length > 0 || tokenTransfers.length > 0) {
      this.logger.debug(
        `Enriched transaction - TxHash: ${txHash}, AccountChanges: ${accountChanges.length}, TokenTransfers: ${tokenTransfers.length}`
      );
    }

    return {
      ...txWithRaw,
      normalized: enrichedNormalized,
    };
  }
}
