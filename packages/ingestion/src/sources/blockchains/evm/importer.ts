import type {
  BlockchainProviderManager,
  EvmChainConfig,
  EvmTransaction,
  TransactionWithRawData,
} from '@exitbook/blockchain-providers';
import type { CursorState } from '@exitbook/core';
import { getErrorMessage } from '@exitbook/core';
import { getLogger, type Logger } from '@exitbook/logger';
import { err, ok, type Result } from 'neverthrow';

import type { IImporter, ImportBatchResult, ImportParams } from '../../../shared/types/importers.js';

import { mapToRawTransactions } from './evm-importer-utils.js';

/**
 * Generic EVM transaction importer that fetches raw transaction data from blockchain APIs.
 * Works with any EVM-compatible chain (Ethereum, Avalanche, Polygon, BSC, etc.).
 *
 * Fetches multiple types of transactions:
 * - Normal (external) transactions
 * - Internal transactions (contract calls)
 * - Token transfers (ERC-20/721/1155)
 * - Beacon withdrawals (Ethereum mainnet only, if supported by provider)
 *
 * Uses provider manager for failover between multiple API providers.
 */
export class EvmImporter implements IImporter {
  private readonly logger: Logger;
  private providerManager: BlockchainProviderManager;
  private chainConfig: EvmChainConfig;

  constructor(
    chainConfig: EvmChainConfig,
    blockchainProviderManager: BlockchainProviderManager,
    options?: { preferredProvider?: string | undefined }
  ) {
    this.chainConfig = chainConfig;
    this.logger = getLogger(`evmImporter:${chainConfig.chainName}`);

    if (!blockchainProviderManager) {
      throw new Error(`Provider manager required for ${chainConfig.chainName} importer`);
    }

    this.providerManager = blockchainProviderManager;

    this.providerManager.autoRegisterFromConfig(chainConfig.chainName, options?.preferredProvider);

    this.logger.info(
      `Initialized ${chainConfig.chainName} transaction importer - ProvidersCount: ${this.providerManager.getProviders(chainConfig.chainName).length}`
    );
  }

  /**
   * Streaming import implementation
   * Streams NORMAL + INTERNAL + TOKEN + BEACON_WITHDRAWALS batches without accumulating everything in memory
   */
  async *importStreaming(params: ImportParams): AsyncIterableIterator<Result<ImportBatchResult, Error>> {
    if (!params.address) {
      yield err(new Error(`Address required for ${this.chainConfig.chainName} transaction import`));
      return;
    }

    const address = params.address;

    if (params.cursor) {
      this.logger.info(
        `Starting ${this.chainConfig.chainName} streaming import for ${address.substring(0, 20)}... (resuming from cursor)`
      );
    } else {
      this.logger.info(`Starting ${this.chainConfig.chainName} streaming import for ${address.substring(0, 20)}...`);
    }

    try {
      // Stream normal transactions (with resume support)
      const normalCursor = params.cursor?.['normal'];
      for await (const batchResult of this.streamTransactionType(
        address,
        'normal',
        'getAddressTransactions',
        normalCursor
      )) {
        yield batchResult;
      }

      // Stream internal transactions (with resume support)
      const internalCursor = params.cursor?.['internal'];
      for await (const batchResult of this.streamTransactionType(
        address,
        'internal',
        'getAddressInternalTransactions',
        internalCursor
      )) {
        yield batchResult;
      }

      // Stream token transactions (with resume support)
      const tokenCursor = params.cursor?.['token'];
      for await (const batchResult of this.streamTransactionType(
        address,
        'token',
        'getAddressTokenTransactions',
        tokenCursor
      )) {
        yield batchResult;
      }

      // Stream beacon withdrawals (Ethereum mainnet only, if supported)
      // Per Product Decision #3: Warn on errors instead of failing the entire import
      if (this.shouldFetchBeaconWithdrawals()) {
        this.logger.info('Fetching beacon chain withdrawals...');
        const withdrawalCursor = params.cursor?.['beacon_withdrawal'];
        let hasWithdrawalError = false;

        for await (const batchResult of this.streamTransactionType(
          address,
          'beacon_withdrawal',
          'getAddressBeaconWithdrawals',
          withdrawalCursor
        )) {
          if (batchResult.isErr()) {
            // Don't fail the import - log warning and continue
            // This handles missing/invalid API keys gracefully
            const errorMsg = batchResult.error.message;
            this.logger.warn(
              `⚠️  Failed to fetch beacon withdrawals: ${errorMsg}\n` +
                `Your ETH balance may be incorrect if this address receives validator withdrawals.\n` +
                `If using Etherscan, ensure ETHERSCAN_API_KEY is set in .env (free at https://etherscan.io/apis)`
            );
            hasWithdrawalError = true;
            // Don't yield the error - skip beacon withdrawals and continue with other transaction types
            break;
          }

          yield batchResult;
        }

        if (!hasWithdrawalError) {
          this.logger.info('Beacon withdrawal fetch completed successfully');
        }
      }

      this.logger.info(`${this.chainConfig.chainName} streaming import completed`);
    } catch (error) {
      this.logger.error(`Failed to stream transactions for address ${address}: ${getErrorMessage(error)}`);
      yield err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Stream a specific transaction type with resume support
   * Uses provider manager's streaming failover to handle pagination and provider switching
   */
  private async *streamTransactionType(
    address: string,
    operationType: 'normal' | 'internal' | 'token' | 'beacon_withdrawal',
    providerOperationType:
      | 'getAddressTransactions'
      | 'getAddressInternalTransactions'
      | 'getAddressTokenTransactions'
      | 'getAddressBeaconWithdrawals',
    resumeCursor?: CursorState
  ): AsyncIterableIterator<Result<ImportBatchResult, Error>> {
    const cacheKeyPrefix =
      operationType === 'normal'
        ? 'normal-txs'
        : operationType === 'internal'
          ? 'internal-txs'
          : operationType === 'token'
            ? 'token-txs'
            : 'beacon-withdrawals';

    const iterator = this.providerManager.executeWithFailover<TransactionWithRawData<EvmTransaction>>(
      this.chainConfig.chainName,
      {
        type: providerOperationType,
        address,
        getCacheKey: (params) =>
          `${this.chainConfig.chainName}:${cacheKeyPrefix}:${params.type === providerOperationType ? params.address : 'unknown'}:all`,
      },
      resumeCursor
    );

    for await (const providerBatchResult of iterator) {
      if (providerBatchResult.isErr()) {
        yield err(providerBatchResult.error);
        return;
      }

      const providerBatch = providerBatchResult.value;
      // Provider batch data is TransactionWithRawData[] from executeWithFailover
      const transactionsWithRaw = providerBatch.data;

      // Log batch stats including in-memory deduplication
      if (providerBatch.stats.deduplicated > 0) {
        this.logger.info(
          `Provider batch stats: ${providerBatch.stats.fetched} fetched, ${providerBatch.stats.deduplicated} deduplicated by provider, ${providerBatch.stats.yielded} yielded`
        );
      } else {
        this.logger.debug(`EVM importer received ${transactionsWithRaw.length} transactions from provider batch`);
      }

      // Use pure function for mapping
      const rawTransactions = mapToRawTransactions(
        transactionsWithRaw,
        providerBatch.providerName,
        address,
        operationType
      );

      yield ok({
        rawTransactions: rawTransactions,
        operationType,
        cursor: providerBatch.cursor,
        isComplete: providerBatch.isComplete,
      });
    }
  }

  /**
   * Determines if beacon withdrawals should be fetched.
   *
   * Withdrawals are skipped if:
   * - Chain is not Ethereum mainnet
   * - No provider supports getAddressBeaconWithdrawals operation
   *
   * @param params - Import parameters
   * @returns true if withdrawals should be fetched
   */
  private shouldFetchBeaconWithdrawals(): boolean {
    // Only Ethereum mainnet has beacon withdrawals
    if (this.chainConfig.chainName !== 'ethereum') {
      return false;
    }

    // Check if any provider supports beacon withdrawals
    const providers = this.providerManager.getProviders(this.chainConfig.chainName);
    const hasWithdrawalSupport = providers.some((provider) =>
      provider.capabilities.supportedOperations.includes('getAddressBeaconWithdrawals')
    );

    if (!hasWithdrawalSupport) {
      this.logger.debug('No provider supports beacon withdrawals for this chain');
      return false;
    }

    return true;
  }
}
