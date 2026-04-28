import { type IBlockchainProviderRuntime, type TransactionWithRawData } from '@exitbook/blockchain-providers';
import { type SolanaTransaction } from '@exitbook/blockchain-providers/solana';
import type { CursorState } from '@exitbook/foundation';
import { err, ok, type Result } from '@exitbook/foundation';
import { getLogger, type Logger } from '@exitbook/logger';

import type { IImporter, StreamingImportParams, ImportBatchResult } from '../../../shared/types/importers.js';
import { mapToRawTransactions } from '../shared/importer-utils.js';

/**
 * Solana transaction importer that fetches raw transaction data from blockchain APIs.
 * Supports Solana addresses using multiple providers (Helius, Solscan, SolanaRPC).
 * Uses provider runtime for failover between multiple blockchain API providers.
 */
export class SolanaImporter implements IImporter {
  private readonly logger: Logger;
  private readonly preferredProvider?: string | undefined;
  private providerRuntime: IBlockchainProviderRuntime;

  constructor(
    blockchainProviderManager: IBlockchainProviderRuntime,
    options?: { preferredProvider?: string | undefined }
  ) {
    this.logger = getLogger('solanaImporter');

    this.providerRuntime = blockchainProviderManager;
    this.preferredProvider = options?.preferredProvider;

    this.logger.info(
      `Initialized Solana transaction importer - ProvidersCount: ${this.providerRuntime.getProviders('solana', { preferredProvider: this.preferredProvider }).length}`
    );
  }

  /**
   * Streaming import implementation
   * Streams transaction batches without accumulating everything in memory
   * Fetches both normal address transactions and token account transactions
   */
  async *importStreaming(params: StreamingImportParams): AsyncIterableIterator<Result<ImportBatchResult, Error>> {
    if (!params.address) {
      yield err(new Error('Address required for Solana transaction import'));
      return;
    }

    this.logger.info(`Starting Solana streaming import for address: ${params.address.substring(0, 20)}...`);

    const stakeAccountsResult = await this.getStakeAccountAddresses(params.address);
    if (stakeAccountsResult.isErr()) {
      yield err(stakeAccountsResult.error);
      return;
    }

    for (const stakeAccountAddress of stakeAccountsResult.value) {
      const stakeCursor = params.cursor?.[`stake:${stakeAccountAddress}`];
      for await (const batchResult of this.streamTransactionsForAddress(
        stakeAccountAddress,
        stakeCursor,
        `stake:${stakeAccountAddress}`,
        'stake'
      )) {
        yield batchResult;
      }
    }

    // Stream normal address transactions (where address signed)
    const normalCursor = params.cursor?.['normal'];
    for await (const batchResult of this.streamTransactionsForAddress(params.address, normalCursor, 'normal')) {
      yield batchResult;
    }

    // Stream token account transactions (where token accounts received transfers)
    const tokenCursor = params.cursor?.['token'];
    for await (const batchResult of this.streamTransactionsForAddress(params.address, tokenCursor, 'token')) {
      yield batchResult;
    }

    this.logger.info(`Solana streaming import completed`);
  }

  private async getStakeAccountAddresses(address: string): Promise<Result<string[], Error>> {
    const providers = this.providerRuntime.getProviders('solana', { preferredProvider: this.preferredProvider });
    const supportsStakingBalances = providers.some((provider) =>
      provider.capabilities.supportedOperations.includes('getAddressStakingBalances')
    );
    if (!supportsStakingBalances) {
      return ok([]);
    }

    const stakingBalancesResult = await this.providerRuntime.getAddressStakingBalances('solana', address, {
      preferredProvider: this.preferredProvider,
    });
    if (stakingBalancesResult.isErr()) {
      return err(stakingBalancesResult.error);
    }

    const stakeAccountAddresses = [
      ...new Set(
        stakingBalancesResult.value.data
          .map((balance) => balance.accountAddress)
          .filter((accountAddress): accountAddress is string => accountAddress !== undefined)
      ),
    ];

    this.logger.info({ stakeAccountCount: stakeAccountAddresses.length }, 'Discovered Solana stake accounts');

    return ok(stakeAccountAddresses);
  }

  /**
   * Stream transactions for a single address with resume support
   * Uses provider runtime's streaming failover to handle pagination and provider switching
   * Supports both normal address transactions and token account transactions
   */
  private async *streamTransactionsForAddress(
    address: string,
    resumeCursor: CursorState | undefined,
    streamType: string,
    providerStreamType: 'normal' | 'stake' | 'token' = streamType === 'token' ? 'token' : 'normal'
  ): AsyncIterableIterator<Result<ImportBatchResult, Error>> {
    const operationLabel =
      providerStreamType === 'normal' ? 'address' : providerStreamType === 'stake' ? 'stake account' : 'token account';

    this.logger.info(`Starting ${operationLabel} transaction stream for address: ${address.substring(0, 20)}...`);

    const iterator = this.providerRuntime.streamAddressTransactions<TransactionWithRawData<SolanaTransaction>>(
      'solana',
      address,
      { preferredProvider: this.preferredProvider, streamType: providerStreamType },
      resumeCursor
    );

    let totalFetched = 0;
    for await (const providerBatchResult of iterator) {
      if (providerBatchResult.isErr()) {
        yield err(providerBatchResult.error);
        return;
      }

      const providerBatch = providerBatchResult.value;
      const transactionsWithRaw = providerBatch.data;

      totalFetched += transactionsWithRaw.length;

      // Log batch stats including in-memory deduplication
      if (providerBatch.stats.deduplicated > 0) {
        this.logger.info(
          `${streamType} batch stats: ${providerBatch.stats.fetched} fetched, ${providerBatch.stats.deduplicated} deduplicated by provider, ${providerBatch.stats.yielded} yielded (total: ${totalFetched})`
        );
      }

      const rawTransactions = mapToRawTransactions(
        transactionsWithRaw.map((transactionWithRaw) => ({
          ...transactionWithRaw,
          normalized:
            providerStreamType === 'stake'
              ? {
                  ...transactionWithRaw.normalized,
                  importSourceAddress: address,
                  importSourceKind: 'stake_account' as const,
                }
              : transactionWithRaw.normalized,
        })),
        providerBatch.providerName,
        address,
        streamType
      );

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

    this.logger.info(
      `Completed ${operationLabel} transaction stream - Total: ${totalFetched} transactions for address: ${address.substring(0, 20)}...`
    );
  }
}
