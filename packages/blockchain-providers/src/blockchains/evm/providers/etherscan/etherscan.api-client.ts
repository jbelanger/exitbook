import type { CursorState, PaginationCursor } from '@exitbook/core';
import { getErrorMessage } from '@exitbook/core';
import { err, errAsync, ok, type Result } from 'neverthrow';

import type { NormalizedTransactionBase, ProviderConfig, ProviderOperation } from '../../../../core/index.js';
import { BaseApiClient, RegisterApiClient } from '../../../../core/index.js';
import {
  createStreamingIterator,
  type StreamingPage,
  type StreamingPageContext,
} from '../../../../core/streaming/streaming-adapter.js';
import type {
  OneShotOperation,
  StreamingBatchResult,
  StreamingOperation,
  TransactionWithRawData,
} from '../../../../core/types/index.js';
import { maskAddress } from '../../../../core/utils/address-utils.js';
import type { EvmChainConfig } from '../../chain-config.interface.js';
import { getEvmChainConfig } from '../../chain-registry.js';
import type { EvmTransaction } from '../../types.js';

import { mapEtherscanWithdrawalToEvmTransaction, parseEtherscanWithdrawalResponse } from './etherscan.mapper-utils.js';
import type { EtherscanBeaconWithdrawal } from './etherscan.schemas.js';

/**
 * Etherscan API client for Ethereum blockchain data.
 *
 * Specialized provider for Ethereum mainnet that supports beacon chain withdrawals.
 * Uses Etherscan's txsBeaconWithdrawal endpoint with page/offset pagination.
 *
 * API Docs: https://docs.etherscan.io/api-endpoints/accounts#get-beacon-chain-withdrawals-by-address-and-block-range
 *
 * Note: This provider only supports streaming operations. Use executeStreaming() for all operations.
 */
@RegisterApiClient({
  apiKeyEnvVar: 'ETHERSCAN_API_KEY',
  baseUrl: 'https://api.etherscan.io/v2/api',
  blockchain: 'ethereum',
  capabilities: {
    supportedOperations: ['getAddressTransactions'],
    supportedTransactionTypes: ['beacon_withdrawal'],
    supportedCursorTypes: ['pageToken', 'blockNumber'],
    preferredCursorType: 'pageToken',
    replayWindow: { blocks: 2 },
  },
  defaultConfig: {
    rateLimit: {
      requestsPerSecond: 3,
      requestsPerMinute: 180,
      requestsPerHour: 4000,
    },
    retries: 3,
    timeout: 10000,
  },
  description: 'Etherscan API for Ethereum with beacon chain withdrawal support',
  displayName: 'Etherscan',
  name: 'etherscan',
  requiresApiKey: true,
  supportedChains: ['ethereum'],
})
export class EtherscanApiClient extends BaseApiClient {
  // Etherscan V2 API constraint: PageNo × Offset ≤ 10,000
  // Using 1000 allows up to 10 pages (10 × 1000 = 10,000)
  private static readonly PAGE_SIZE = 1000;
  private readonly chainConfig: EvmChainConfig;

  constructor(config: ProviderConfig) {
    super(config);

    // Get EVM chain config for Ethereum
    const evmChainConfig = getEvmChainConfig(config.blockchain);
    if (!evmChainConfig) {
      throw new Error(`Unsupported blockchain: ${config.blockchain}`);
    }
    this.chainConfig = evmChainConfig;

    this.logger.debug(`Initialized EtherscanApiClient for ${config.blockchain} - BaseUrl: ${this.baseUrl}`);
  }

  extractCursors(transaction: EvmTransaction): PaginationCursor[] {
    const cursors: PaginationCursor[] = [];

    if (transaction.blockHeight !== undefined) {
      cursors.push({ type: 'blockNumber', value: transaction.blockHeight });
    }

    if (transaction.timestamp) {
      cursors.push({
        type: 'timestamp',
        value: transaction.timestamp,
      });
    }

    return cursors;
  }

  applyReplayWindow(cursor: PaginationCursor): PaginationCursor {
    const replayWindow = this.capabilities.replayWindow;
    if (!replayWindow || cursor.type !== 'blockNumber') return cursor;

    return {
      type: 'blockNumber',
      value: Math.max(0, cursor.value - (replayWindow.blocks || 0)),
    };
  }

  async execute<T>(_operation: OneShotOperation): Promise<Result<T, Error>> {
    return errAsync(
      new Error('Etherscan provider only supports streaming operations. Use executeStreaming() instead of execute().')
    );
  }

  async *executeStreaming<T extends NormalizedTransactionBase = NormalizedTransactionBase>(
    operation: StreamingOperation,
    resumeCursor?: CursorState
  ): AsyncIterableIterator<Result<StreamingBatchResult<T>, Error>> {
    if (operation.type !== 'getAddressTransactions') {
      yield err(new Error(`Streaming not supported for operation: ${(operation as ProviderOperation).type}`));
      return;
    }

    const streamType = operation.streamType || 'normal';
    switch (streamType) {
      case 'beacon_withdrawal':
        yield* this.streamAddressBeaconWithdrawals(operation.address, resumeCursor) as AsyncIterableIterator<
          Result<StreamingBatchResult<T>, Error>
        >;
        break;
      default:
        yield err(new Error(`Unsupported transaction type: ${streamType}`));
    }
  }

  getHealthCheckConfig() {
    return {
      endpoint: `?module=block&action=eth_block_number&chainid=${this.chainConfig.chainId}`,
      validate: (response: unknown) => {
        const data = response as { result: string; status: string };
        return data && data.status === '1' && typeof data.result === 'string';
      },
    };
  }

  /**
   * Streams beacon chain withdrawals for an address using intelligent hybrid pagination.
   *
   * Etherscan API constraints:
   * - page * offset ≤ 10,000 hard limit (V2 API)
   * - Supports startblock/endblock for block range filtering
   *
   * Strategy:
   * - Fetch pages 1-10 using offset pagination (10k items)
   * - At page 10 with more data, reset to page 1 with startblock set to last withdrawal's block + 1
   * - Repeat cycles automatically until all data fetched
   * - PageToken format: "page:startblock" (e.g., "5:19500000" = page 5 starting from block 19500000)
   */
  private streamAddressBeaconWithdrawals(
    address: string,
    resumeCursor?: CursorState
  ): AsyncIterableIterator<Result<StreamingBatchResult<EvmTransaction>, Error>> {
    const fetchPage = async (
      ctx: StreamingPageContext
    ): Promise<Result<StreamingPage<EtherscanBeaconWithdrawal>, Error>> => {
      const params = new URLSearchParams({
        module: 'account',
        action: 'txsBeaconWithdrawal',
        address,
        apikey: this.apiKey,
        chainid: String(this.chainConfig.chainId),
        sort: 'asc',
        offset: String(EtherscanApiClient.PAGE_SIZE),
      });

      // Parse pageToken as "page:startblock" or just "page"
      let currentPage = 1;
      let startBlock: number | undefined;

      if (ctx.pageToken) {
        const parts = ctx.pageToken.split(':');
        const pageStr = parts[0];
        if (pageStr !== undefined) {
          currentPage = parseInt(pageStr, 10);
        }
        const blockStr = parts[1];
        if (blockStr !== undefined) {
          startBlock = parseInt(blockStr, 10);
        }
      } else if (ctx.replayedCursor?.type === 'blockNumber') {
        // Resuming from a blockNumber cursor (from previous run)
        startBlock = ctx.replayedCursor.value;
      }

      params.append('page', String(currentPage));
      if (startBlock !== undefined) {
        params.append('startblock', String(startBlock));
        this.logger.debug(`Fetching page ${currentPage} from block ${startBlock}`);
      }

      const endpoint = `?${params.toString()}`;
      const result = await this.httpClient.get(endpoint);

      if (result.isErr()) {
        this.logger.error(
          `Failed to fetch beacon withdrawals for ${maskAddress(address)} - Error: ${getErrorMessage(result.error)}`
        );
        return err(result.error);
      }

      const parseResult = parseEtherscanWithdrawalResponse(result.value);
      if (parseResult.isErr()) {
        this.logger.error(`Failed to parse Etherscan response: ${parseResult.error.message}`);
        return err(parseResult.error);
      }

      const items = parseResult.value;
      const isComplete = items.length < EtherscanApiClient.PAGE_SIZE;

      let nextPageToken: string | undefined;

      if (!isComplete) {
        if (currentPage >= 10) {
          // Hit the 10k limit - reset to page 1 with new startblock
          const lastWithdrawal = items[items.length - 1];
          if (!lastWithdrawal) {
            this.logger.error('Cannot advance pagination: no withdrawals in page');
            return err(new Error('Cannot advance pagination: no withdrawals in page'));
          }
          // Do NOT increment the block here: the 10k boundary can cut mid-block.
          // Advancing by +1 would skip remaining withdrawals from the same block.
          const nextStartBlockInclusive = parseInt(lastWithdrawal.blockNumber, 10);
          nextPageToken = `1:${nextStartBlockInclusive}`;
          this.logger.debug(
            `Completed page ${currentPage} cycle, resetting to page 1 from block ${nextStartBlockInclusive} (dedup will drop duplicates)`
          );
        } else {
          // Continue within current cycle
          nextPageToken = startBlock !== undefined ? `${currentPage + 1}:${startBlock}` : String(currentPage + 1);
        }
      }

      this.logger.debug(
        `Fetched ${items.length} beacon withdrawals (page ${currentPage}${startBlock !== undefined ? ` from block ${startBlock}` : ''})${!isComplete ? ' (more available)' : ' (complete)'}`
      );

      return ok({
        items,
        nextPageToken,
        isComplete,
      });
    };

    return createStreamingIterator<EtherscanBeaconWithdrawal, EvmTransaction>({
      providerName: this.name,
      operation: { type: 'getAddressTransactions', streamType: 'beacon_withdrawal', address },
      resumeCursor,
      fetchPage,
      mapItem: (raw) => {
        const mapped = mapEtherscanWithdrawalToEvmTransaction(raw, this.chainConfig.nativeCurrency);
        if (mapped.isErr()) {
          const errorMessage = mapped.error.type === 'error' ? mapped.error.message : mapped.error.reason;
          this.logger.error(`Failed to map beacon withdrawal ${raw.withdrawalIndex} - Error: ${errorMessage}`);
          return err(new Error(`Failed to map beacon withdrawal: ${errorMessage}`));
        }

        return ok([
          {
            raw,
            normalized: mapped.value,
          } as TransactionWithRawData<EvmTransaction>,
        ]);
      },
      extractCursors: (tx) => this.extractCursors(tx),
      applyReplayWindow: (cursor) => this.applyReplayWindow(cursor),
      dedupWindowSize: 500,
      logger: this.logger,
    });
  }
}
