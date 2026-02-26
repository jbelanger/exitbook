import type {
  BlockchainProviderManager,
  EvmChainConfig,
  EvmTransaction,
  TransactionWithRawData,
} from '@exitbook/blockchain-providers';
import type { CursorState } from '@exitbook/core';
import { getErrorMessage, wrapError } from '@exitbook/core';
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

  /**
   * Transaction types to fetch, in deterministic order for resumability
   * Read from chain config (evm-chains.json) which defines supported types per chain
   */
  private readonly transactionTypes: string[];

  constructor(
    chainConfig: EvmChainConfig,
    blockchainProviderManager: BlockchainProviderManager,
    options?: { preferredProvider?: string | undefined }
  ) {
    this.chainConfig = chainConfig;
    this.logger = getLogger(`evmImporter:${chainConfig.chainName}`);
    this.providerManager = blockchainProviderManager;

    this.providerManager.autoRegisterFromConfig(chainConfig.chainName, options?.preferredProvider);

    // Get transaction types from chain config (required field in evm-chains.json)
    this.transactionTypes = chainConfig.transactionTypes;

    this.logger.info(
      `Initialized ${chainConfig.chainName} transaction importer - ProvidersCount: ${this.providerManager.getProviders(chainConfig.chainName).length}`
    );
  }

  /**
   * Streaming import implementation
   * Streams all transaction types in deterministic order without accumulating everything in memory
   */
  async *importStreaming(params: ImportParams): AsyncIterableIterator<Result<ImportBatchResult, Error>> {
    if (!params.address) {
      yield err(new Error(`Address required for ${this.chainConfig.chainName} transaction import`));
      return;
    }

    const address = params.address;

    const resumeNote = params.cursor ? ' (resuming from cursor)' : '';
    this.logger.info(
      `Starting ${this.chainConfig.chainName} streaming import for ${address.substring(0, 20)}...${resumeNote}`
    );

    try {
      // Loop through all transaction types in deterministic order
      for (const streamType of this.transactionTypes) {
        const resumeCursor = params.cursor?.[streamType];

        // Special handling for beacon withdrawals to check provider support
        if (streamType === 'beacon_withdrawal') {
          yield* this.streamBeaconWithdrawals(address, resumeCursor);
        } else {
          if (!this.hasProviderSupport(streamType)) {
            this.logger.warn(`Skipping ${streamType} transactions (no provider support)`);
            continue;
          }
          // Standard transaction types (normal, internal, token)
          for await (const batchResult of this.streamTransactionType(address, streamType, resumeCursor)) {
            yield batchResult;
          }
        }
      }

      this.logger.info(`${this.chainConfig.chainName} streaming import completed`);
    } catch (error) {
      this.logger.error(`Failed to stream transactions for address ${address}: ${getErrorMessage(error)}`);
      yield wrapError(error, `Failed to stream ${this.chainConfig.chainName} transactions for ${address}`);
    }
  }

  /**
   * Stream a specific transaction type with resume support
   * Uses provider manager's streaming failover to handle pagination and provider switching
   */
  private async *streamTransactionType(
    address: string,
    streamType: string,
    resumeCursor?: CursorState
  ): AsyncIterableIterator<Result<ImportBatchResult, Error>> {
    const iterator = this.providerManager.executeWithFailover<TransactionWithRawData<EvmTransaction>>(
      this.chainConfig.chainName,
      {
        type: 'getAddressTransactions',
        address,
        streamType: streamType,
        getCacheKey: (params) => {
          if (params.type !== 'getAddressTransactions') return 'unknown';
          const txType = params.streamType || 'default';
          return `${this.chainConfig.chainName}:${txType}:${params.address}:all`;
        },
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
      const rawTransactions = mapToRawTransactions(transactionsWithRaw, providerBatch.providerName, address);

      yield ok({
        rawTransactions,
        streamType,
        cursor: providerBatch.cursor,
        isComplete: providerBatch.isComplete,
        providerStats: {
          fetched: providerBatch.stats.fetched,
          deduplicated: providerBatch.stats.deduplicated,
        },
      });
    }
  }

  /**
   * Stream beacon withdrawals for Ethereum addresses.
   * Handles three cases:
   * 1. No provider support - yields skipped marker
   * 2. Fetch error - yields failed marker with warning
   * 3. Success - yields batches or empty success marker if no withdrawals found
   */
  private async *streamBeaconWithdrawals(
    address: string,
    resumeCursor?: CursorState
  ): AsyncIterableIterator<Result<ImportBatchResult, Error>> {
    const providers = this.providerManager.getProviders(this.chainConfig.chainName);
    const hasSupport = providers.some(
      (p) =>
        p.capabilities.supportedOperations.includes('getAddressTransactions') &&
        p.capabilities.supportedTransactionTypes?.includes('beacon_withdrawal')
    );

    if (!hasSupport) {
      this.logger.debug('Skipping beacon withdrawals (no provider support)');
      yield ok(
        this.createBeaconStatusBatch('SKIPPED', 'skipped', {
          reason: 'no-provider-support',
          warning:
            'Skipping beacon withdrawals (no provider support or missing Etherscan API key). ' +
            'Your ETH balance may be incorrect if this address receives validator withdrawals. ' +
            'Set ETHERSCAN_API_KEY in .env to enable.',
        })
      );
      return;
    }

    this.logger.info('Fetching beacon chain withdrawals...');
    let batchCount = 0;

    for await (const batchResult of this.streamTransactionType(address, 'beacon_withdrawal', resumeCursor)) {
      if (batchResult.isErr()) {
        const errorMsg = batchResult.error.message;
        this.logger.warn(`Beacon withdrawal fetch failed: ${errorMsg}`);
        yield ok(
          this.createBeaconStatusBatch('FETCH_FAILED', 'failed', {
            errorMessage: errorMsg,
            warning:
              `Failed to fetch beacon withdrawals: ${errorMsg}. ` +
              `Your ETH balance may be incorrect if this address receives validator withdrawals. ` +
              `If using Etherscan, ensure ETHERSCAN_API_KEY is set in .env (free at https://etherscan.io/apis)`,
          })
        );
        return;
      }

      yield batchResult;
      batchCount++;
    }

    if (batchCount === 0) {
      this.logger.info('Beacon withdrawal fetch completed (0 withdrawals found)');
      const providerName = providers[0]?.name || this.chainConfig.chainName;
      yield ok(this.createBeaconStatusBatch('NO_WITHDRAWALS', undefined, { providerName }));
    } else {
      this.logger.info('Beacon withdrawal fetch completed successfully');
    }
  }

  /**
   * Create a beacon withdrawal status batch (for skipped/failed/empty cases)
   */
  private createBeaconStatusBatch(
    lastTransactionId: string,
    fetchStatus?: 'skipped' | 'failed',
    opts?: { errorMessage?: string; providerName?: string; reason?: string; warning?: string }
  ): ImportBatchResult {
    return {
      rawTransactions: [],
      streamType: 'beacon_withdrawal',
      cursor: {
        primary: { type: 'blockNumber', value: 0 },
        lastTransactionId,
        totalFetched: 0,
        metadata: {
          providerName: opts?.providerName || this.chainConfig.chainName,
          updatedAt: Date.now(),
          isComplete: true,
          ...(fetchStatus && { fetchStatus }),
          ...(opts?.reason && { reason: opts.reason }),
          ...(opts?.errorMessage && { errorMessage: opts.errorMessage }),
        },
      },
      isComplete: true,
      ...(opts?.warning && { warnings: [opts.warning] }),
    };
  }

  private hasProviderSupport(streamType: string): boolean {
    const providers = this.providerManager.getProviders(this.chainConfig.chainName);
    return providers.some((provider) => {
      if (!provider.capabilities.supportedOperations.includes('getAddressTransactions')) {
        return false;
      }

      const supportedTypes = provider.capabilities.supportedTransactionTypes;
      if (!supportedTypes) {
        return streamType === 'normal';
      }

      return supportedTypes.includes(streamType);
    });
  }
}
