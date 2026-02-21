import type { CursorState, PaginationCursor } from '@exitbook/core';
import { getErrorMessage } from '@exitbook/core';
import { err, ok, type Result } from 'neverthrow';

import type {
  NormalizedTransactionBase,
  ProviderConfig,
  ProviderFactory,
  ProviderOperation,
} from '../../../../core/index.js';
import { BaseApiClient } from '../../../../core/index.js';
import {
  createStreamingIterator,
  type StreamingPage,
  type StreamingPageContext,
} from '../../../../core/streaming/streaming-adapter.js';
import type {
  OneShotOperation,
  OneShotOperationResult,
  RawBalanceData,
  StreamingBatchResult,
  StreamingOperation,
} from '../../../../core/types/index.js';
import { maskAddress } from '../../../../core/utils/address-utils.js';
import { convertBalance, createZeroBalance, findNativeBalance } from '../../balance-utils.js';
import type { CosmosChainConfig } from '../../chain-config.interface.js';
import { COSMOS_CHAINS } from '../../chain-registry.js';
import type { CosmosTransaction } from '../../types.js';

import type { CosmosRestApiResponse, CosmosBalanceResponse, CosmosTxResponse } from './cosmos-rest.schemas.js';
import { CosmosRestApiResponseSchema, CosmosBalanceResponseSchema } from './cosmos-rest.schemas.js';
import { mapCosmosRestTransaction } from './mapper-utils.js';

/**
 * Extended provider config that includes chainName
 */
export interface CosmosRestProviderConfig extends ProviderConfig {
  chainName?: string;
}

// This class is instantiated via per-chain factories exported at the bottom of this file.
export class CosmosRestApiClient extends BaseApiClient {
  private chainConfig: CosmosChainConfig;
  private chainName: string;

  constructor(config: CosmosRestProviderConfig) {
    // Get chain config to determine base URL
    const chainName = config.chainName || 'fetch';
    const chainConfig = COSMOS_CHAINS[chainName];

    if (!chainConfig) {
      throw new Error(`Unknown Cosmos chain: ${chainName}. Available chains: ${Object.keys(COSMOS_CHAINS).join(', ')}`);
    }

    if (!chainConfig.restEndpoints || chainConfig.restEndpoints.length === 0) {
      throw new Error(`No REST endpoints configured for chain: ${chainName}`);
    }

    // Override baseUrl with chain-specific REST endpoint
    const restEndpoint = chainConfig.restEndpoints[0];
    if (!restEndpoint) {
      throw new Error(`No REST endpoints available for chain: ${chainName}`);
    }

    const configWithBaseUrl = {
      ...config,
      baseUrl: restEndpoint,
    };

    super(configWithBaseUrl);

    this.chainConfig = chainConfig;
    this.chainName = chainName;

    this.logger.debug(
      `Initialized CosmosRestApiClient for chain: ${this.chainConfig.chainName} (${this.chainConfig.displayName}) - BaseUrl: ${this.baseUrl}`
    );
  }

  extractCursors(transaction: CosmosTransaction): PaginationCursor[] {
    const cursors: PaginationCursor[] = [];

    // Primary cursor: block number
    if (transaction.blockHeight !== undefined) {
      cursors.push({ type: 'blockNumber', value: transaction.blockHeight });
    }

    // Alternative cursor: transaction hash
    cursors.push({ type: 'txHash', value: transaction.id });

    // Alternative cursor: timestamp
    if (transaction.timestamp) {
      cursors.push({
        type: 'timestamp',
        value: transaction.timestamp,
      });
    }

    return cursors;
  }

  applyReplayWindow(cursor: PaginationCursor): PaginationCursor {
    // No replay window needed for Cosmos REST API
    return cursor;
  }

  async execute<TOperation extends OneShotOperation>(
    operation: TOperation
  ): Promise<Result<OneShotOperationResult<TOperation>, Error>> {
    this.logger.debug(
      `Executing operation - Type: ${operation.type}, Address: ${'address' in operation ? maskAddress(operation.address) : 'N/A'}`
    );

    switch (operation.type) {
      case 'getAddressBalances':
        return (await this.getAddressBalances({
          address: operation.address,
        })) as Result<OneShotOperationResult<TOperation>, Error>;
      default:
        return err(new Error(`Unsupported operation: ${operation.type}`));
    }
  }

  async *executeStreaming<T extends NormalizedTransactionBase = NormalizedTransactionBase>(
    operation: StreamingOperation,
    resumeCursor?: CursorState
  ): AsyncIterableIterator<Result<StreamingBatchResult<T>, Error>> {
    // Route to appropriate streaming implementation
    switch (operation.type) {
      case 'getAddressTransactions': {
        const streamType = operation.streamType || 'normal';
        if (streamType !== 'normal') {
          yield err(new Error(`Unsupported transaction type: ${streamType} for operation: ${operation.type}`));
          return;
        }
        yield* this.streamAddressTransactions(operation.address, resumeCursor) as AsyncIterableIterator<
          Result<StreamingBatchResult<T>, Error>
        >;
        break;
      }
      default:
        yield err(new Error(`Streaming not yet implemented for operation: ${(operation as ProviderOperation).type}`));
    }
  }

  getHealthCheckConfig() {
    return {
      endpoint: '/cosmos/base/tendermint/v1beta1/node_info',
      validate: (response: unknown) => {
        return Boolean(response && typeof response === 'object');
      },
    };
  }

  private async getAddressBalances(params: { address: string }): Promise<Result<RawBalanceData, Error>> {
    const { address } = params;

    if (!this.validateAddress(address)) {
      return err(new Error(`Invalid ${this.chainConfig.displayName} address: ${address}`));
    }

    this.logger.debug(`Fetching raw address balance - Address: ${maskAddress(address)}`);

    const endpoint = `/cosmos/bank/v1beta1/balances/${address}`;
    const result = await this.httpClient.get<CosmosBalanceResponse>(endpoint, {
      schema: CosmosBalanceResponseSchema,
    });

    if (result.isErr()) {
      this.logger.error(
        `Failed to fetch raw address balance - Address: ${maskAddress(address)}, Error: ${getErrorMessage(result.error)}`
      );
      return err(result.error);
    }

    const response = result.value;

    if (!response.balances || response.balances.length === 0) {
      this.logger.debug(`No balance found for address - Address: ${maskAddress(address)}`);
      return ok(createZeroBalance(this.chainConfig.nativeCurrency, this.chainConfig.nativeDecimals) as RawBalanceData);
    }

    const nativeBalance = findNativeBalance(response.balances, this.chainConfig.nativeDenom);

    if (!nativeBalance) {
      this.logger.debug(
        `No native currency balance found for address - Address: ${maskAddress(address)}, Expected denom: ${this.chainConfig.nativeDenom}, Denoms found: ${response.balances.map((b) => b.denom).join(', ')}`
      );
      return ok(createZeroBalance(this.chainConfig.nativeCurrency, this.chainConfig.nativeDecimals) as RawBalanceData);
    }

    const balanceResult = convertBalance(
      nativeBalance.amount,
      this.chainConfig.nativeDecimals,
      this.chainConfig.nativeCurrency
    );

    this.logger.debug(
      `Found raw balance for ${maskAddress(address)}: ${balanceResult.decimalAmount} ${this.chainConfig.nativeCurrency}`
    );

    return ok(balanceResult as RawBalanceData);
  }

  private validateAddress(address: string): boolean {
    // Use bech32Prefix from chainConfig for validation
    const addressRegex = new RegExp(`^${this.chainConfig.bech32Prefix}1[a-z0-9]{38}$`);
    return addressRegex.test(address);
  }

  private streamAddressTransactions(
    address: string,
    resumeCursor?: CursorState
  ): AsyncIterableIterator<Result<StreamingBatchResult<CosmosTransaction>, Error>> {
    const BATCH_SIZE = 50;

    // Local state - persists across fetchPage calls in same run
    let senderPageToken: string | undefined;
    let recipientPageToken: string | undefined;
    let senderComplete = false;
    let recipientComplete = false;
    let isInitialized = false;

    const fetchPage = async (ctx: StreamingPageContext): Promise<Result<StreamingPage<CosmosTxResponse>, Error>> => {
      // Initialize: restore pagination tokens from resume cursor (FIRST CALL ONLY)
      if (!isInitialized) {
        const customMeta = ctx.resumeCursor?.metadata?.['custom'] as
          | {
              recipientComplete?: boolean;
              recipientPageToken?: string;
              senderComplete?: boolean;
              senderPageToken?: string;
            }
          | undefined;

        if (customMeta) {
          senderPageToken = customMeta.senderPageToken;
          recipientPageToken = customMeta.recipientPageToken;
          senderComplete = customMeta.senderComplete ?? false;
          recipientComplete = customMeta.recipientComplete ?? false;
        } else if (ctx.pageToken) {
          // Fallback to primary cursor if customMeta is missing
          senderPageToken = ctx.pageToken;
        }

        isInitialized = true;
      }

      // === FETCH SENDER TRANSACTIONS ===
      let pairedSenderTxs: CosmosTxResponse[] = [];
      let senderResponse: CosmosRestApiResponse = { tx_responses: [], txs: [], pagination: undefined };

      if (!senderComplete) {
        const senderParams = new URLSearchParams({
          'pagination.limit': BATCH_SIZE.toString(),
          'pagination.count_total': 'false',
          order_by: 'ORDER_BY_DESC',
        });

        if (senderPageToken) {
          senderParams.append('pagination.key', senderPageToken);
        }

        const senderEvents = this.chainConfig.eventFilters?.sender ?? `coin_spent.spender='${address}'`;
        const formattedSenderEvents = senderEvents.includes('${address}')
          ? senderEvents.replace('${address}', address)
          : senderEvents;
        senderParams.append('events', formattedSenderEvents);

        const senderEndpoint = `/cosmos/tx/v1beta1/txs?${senderParams.toString()}`;
        const senderResult = await this.httpClient.get<CosmosRestApiResponse>(senderEndpoint, {
          schema: CosmosRestApiResponseSchema,
        });

        if (senderResult.isErr()) {
          this.logger.error(
            `Failed to fetch sender transactions for ${maskAddress(address)} - Error: ${getErrorMessage(senderResult.error)}`
          );
          return err(senderResult.error);
        }

        senderResponse = senderResult.value;
        const senderTxResponses = senderResponse.tx_responses || [];
        const senderTxs = senderResponse.txs || [];

        // Pair tx_responses with txs BEFORE merging
        pairedSenderTxs = senderTxResponses.map((txResponse, index) => {
          if (txResponse.tx) {
            return txResponse;
          }
          if (senderTxs[index]) {
            return { ...txResponse, tx: senderTxs[index] };
          }
          return txResponse;
        });
      }

      // === FETCH RECIPIENT TRANSACTIONS ===
      let pairedRecipientTxs: CosmosTxResponse[] = [];
      let recipientResponse: CosmosRestApiResponse = { tx_responses: [], txs: [], pagination: undefined };

      if (!recipientComplete) {
        const recipientParams = new URLSearchParams({
          'pagination.limit': BATCH_SIZE.toString(),
          'pagination.count_total': 'false',
          order_by: 'ORDER_BY_DESC',
        });

        if (recipientPageToken) {
          recipientParams.append('pagination.key', recipientPageToken);
        }

        const recipientEvents = this.chainConfig.eventFilters?.receiver ?? `coin_received.receiver='${address}'`;
        const formattedRecipientEvents = recipientEvents.includes('${address}')
          ? recipientEvents.replace('${address}', address)
          : recipientEvents;
        recipientParams.append('events', formattedRecipientEvents);

        const recipientEndpoint = `/cosmos/tx/v1beta1/txs?${recipientParams.toString()}`;
        const recipientResult = await this.httpClient.get<CosmosRestApiResponse>(recipientEndpoint, {
          schema: CosmosRestApiResponseSchema,
        });

        if (recipientResult.isErr()) {
          this.logger.error(
            `Failed to fetch recipient transactions for ${maskAddress(address)} - Error: ${getErrorMessage(recipientResult.error)}`
          );
          return err(recipientResult.error);
        }

        recipientResponse = recipientResult.value;
        const recipientTxResponses = recipientResponse.tx_responses || [];
        const recipientTxs = recipientResponse.txs || [];

        // Pair tx_responses with txs BEFORE merging
        pairedRecipientTxs = recipientTxResponses.map((txResponse, index) => {
          if (txResponse.tx) {
            return txResponse;
          }
          if (recipientTxs[index]) {
            return { ...txResponse, tx: recipientTxs[index] };
          }
          return txResponse;
        });
      }

      // === MERGE AND DEDUPLICATE ===
      const allTxResponses = [...pairedSenderTxs, ...pairedRecipientTxs];

      // Deduplicate by txhash, preferring versions with tx body
      const uniqueTxs = new Map<string, CosmosTxResponse>();
      for (const tx of allTxResponses) {
        const existing = uniqueTxs.get(tx.txhash);
        if (!existing) {
          uniqueTxs.set(tx.txhash, tx);
        } else if (!existing.tx && tx.tx) {
          // Replace with version that has tx body (critical for mapper)
          uniqueTxs.set(tx.txhash, tx);
          this.logger.debug(
            `Merged tx body for txhash ${tx.txhash} - replaced incomplete version with complete version`
          );
        }
      }

      const items = Array.from(uniqueTxs.values());

      // Sort by block height descending
      items.sort((a, b) => {
        const heightA = parseInt(a.height, 10);
        const heightB = parseInt(b.height, 10);
        return heightB - heightA;
      });

      // === UPDATE LOCAL STATE FOR NEXT ITERATION ===
      const senderNextKey = senderResponse.pagination?.next_key;
      const recipientNextKey = recipientResponse.pagination?.next_key;

      const senderHasMore = Boolean(senderNextKey && senderNextKey !== '');
      const recipientHasMore = Boolean(recipientNextKey && recipientNextKey !== '');

      // Update local state (convert null to undefined)
      senderPageToken = senderHasMore && senderNextKey ? senderNextKey : undefined;
      recipientPageToken = recipientHasMore && recipientNextKey ? recipientNextKey : undefined;

      // Mark as complete when no more pages
      if (!senderHasMore && !senderComplete) {
        senderComplete = true;
        this.logger.debug(`Sender pagination complete for ${maskAddress(address)}`);
      }
      if (!recipientHasMore && !recipientComplete) {
        recipientComplete = true;
        this.logger.debug(`Recipient pagination complete for ${maskAddress(address)}`);
      }

      const hasMore = senderHasMore || recipientHasMore;

      return ok({
        items,
        nextPageToken: senderPageToken, // Use sender as primary for ctx.pageToken
        isComplete: !hasMore,
        // Persist both tokens and completion flags for resume
        customMetadata: {
          senderPageToken,
          recipientPageToken,
          senderComplete,
          recipientComplete,
        },
      });
    };

    return createStreamingIterator<CosmosTxResponse, CosmosTransaction>({
      providerName: this.name,
      operation: { type: 'getAddressTransactions', address },
      resumeCursor,
      fetchPage,
      mapItem: (raw) => {
        const mapped = mapCosmosRestTransaction(raw, address, this.name, this.chainConfig);
        if (mapped.isErr()) {
          const errorMessage = mapped.error.type === 'error' ? mapped.error.message : mapped.error.reason;

          // Skip transactions that are not relevant or not supported (e.g., Akash escrow messages)
          if (mapped.error.type === 'skip') {
            this.logger.debug(`Skipping transaction - Address: ${maskAddress(address)}, Reason: ${errorMessage}`);
            return ok([]); // Return empty array to skip this transaction
          }

          // Fatal error - stop processing
          this.logger.error(
            `Provider data validation failed - Address: ${maskAddress(address)}, Error: ${errorMessage}`
          );
          return err(new Error(`Provider data validation failed: ${errorMessage}`));
        }

        return ok([
          {
            raw,
            normalized: mapped.value,
          },
        ]);
      },
      extractCursors: (tx) => this.extractCursors(tx),
      applyReplayWindow: (cursor) => this.applyReplayWindow(cursor),
      dedupWindowSize: 500,
      logger: this.logger,
    });
  }
}

export const cosmosRestFactories: ProviderFactory[] = Object.entries(COSMOS_CHAINS)
  .filter(([, chainConfig]) => chainConfig.restTxSearchEnabled !== false)
  .map(([chainName, chainConfig]) => ({
    create: (config: ProviderConfig) =>
      new CosmosRestApiClient({
        ...config,
        chainName,
      }),
    metadata: {
      baseUrl: chainConfig.restEndpoints?.[0] ?? '',
      blockchain: chainName,
      capabilities: {
        supportedOperations: ['getAddressTransactions', 'getAddressBalances'],
        supportedTransactionTypes: ['normal'],
        supportedCursorTypes: ['blockNumber', 'txHash', 'timestamp', 'pageToken'],
        preferredCursorType: 'pageToken',
        replayWindow: { blocks: 0 },
      },
      defaultConfig: {
        rateLimit: {
          burstLimit: 5,
          requestsPerHour: 1000,
          requestsPerMinute: 100,
          requestsPerSecond: 5,
        },
        retries: 3,
        timeout: 30000,
      },
      description: `Cosmos SDK REST API client for ${chainConfig.displayName} using standard /cosmos/tx/v1beta1/txs endpoints`,
      displayName: `${chainConfig.displayName} REST API`,
      name: 'cosmos-rest',
      requiresApiKey: false,
      supportedChains: [chainName],
    },
  }));
