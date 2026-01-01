import type { CursorState, PaginationCursor, TokenMetadata } from '@exitbook/core';
import { getErrorMessage } from '@exitbook/core';
import { err, ok, type Result } from 'neverthrow';
import { z } from 'zod';

import type { NormalizedTransactionBase, ProviderConfig, ProviderOperation } from '../../../../core/index.js';
import { BaseApiClient, RegisterApiClient } from '../../../../core/index.js';
import {
  createStreamingIterator,
  type StreamingPage,
  type StreamingPageContext,
} from '../../../../core/streaming/streaming-adapter.js';
import type { RawBalanceData, StreamingBatchResult, TransactionWithRawData } from '../../../../core/types/index.js';
import { maskAddress } from '../../../../core/utils/address-utils.js';
import { createEmptyCompletionCursor } from '../../../../core/utils/cursor-utils.js';
import { convertWeiToDecimal } from '../../balance-utils.js';
import type { EvmChainConfig } from '../../chain-config.interface.js';
import { getEvmChainConfig } from '../../chain-registry.js';
import type { EvmTransaction } from '../../types.js';

import {
  mapMoralisTransaction,
  mapMoralisTokenTransfer,
  mapMoralisInternalTransaction,
} from './moralis.mapper-utils.js';
import {
  MoralisNativeBalanceSchema,
  MoralisTokenBalanceSchema,
  MoralisTokenMetadataSchema,
  MoralisTokenTransferResponseSchema,
  MoralisTransactionResponseSchema,
  type MoralisTokenTransfer,
  type MoralisTransaction,
} from './moralis.schemas.js';

/**
 * Maps EVM chain names to Moralis-specific chain identifiers
 */
const CHAIN_ID_MAP: Record<string, string> = {
  avalanche: 'avalanche',
  ethereum: 'eth',
  polygon: 'polygon',
};

@RegisterApiClient({
  apiKeyEnvVar: 'MORALIS_API_KEY',
  baseUrl: 'https://deep-index.moralis.io/api/v2.2',
  blockchain: 'ethereum',
  capabilities: {
    supportedOperations: [
      'getAddressTransactions',
      'getAddressBalances',
      'getAddressTokenBalances',
      'getTokenMetadata',
    ],
    supportedTransactionTypes: ['normal', 'internal', 'token'],
    supportedCursorTypes: ['pageToken', 'blockNumber'],
    preferredCursorType: 'pageToken',
    replayWindow: { blocks: 2 },
  },
  defaultConfig: {
    rateLimit: {
      burstLimit: 5,
      requestsPerHour: 1000,
      requestsPerMinute: 120,
      requestsPerSecond: 2,
    },
    retries: 3,
    timeout: 10000,
  },
  description: 'Moralis API with comprehensive Web3 data and multi-chain EVM support',
  displayName: 'Moralis',
  name: 'moralis',
  requiresApiKey: true,
  supportedChains: ['ethereum', 'avalanche', 'polygon'],
})
export class MoralisApiClient extends BaseApiClient {
  private readonly chainConfig: EvmChainConfig;
  private readonly moralisChainId: string;

  constructor(config: ProviderConfig) {
    super(config);

    // Get EVM chain config
    const evmChainConfig = getEvmChainConfig(config.blockchain);
    if (!evmChainConfig) {
      throw new Error(`Unsupported blockchain: ${config.blockchain}`);
    }
    this.chainConfig = evmChainConfig;

    // Map to Moralis chain ID
    const mappedChainId = CHAIN_ID_MAP[config.blockchain];
    if (!mappedChainId) {
      throw new Error(`No Moralis chain ID mapping for blockchain: ${config.blockchain}`);
    }
    this.moralisChainId = mappedChainId;

    // Moralis requires API key in x-api-key header
    this.reinitializeHttpClient({
      defaultHeaders: {
        'x-api-key': this.apiKey,
      },
    });

    this.logger.debug(
      `Initialized MoralisApiClient for ${config.blockchain} - Moralis Chain ID: ${this.moralisChainId}, BaseUrl: ${this.baseUrl}`
    );
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

  async execute<T>(operation: ProviderOperation): Promise<Result<T, Error>> {
    this.logger.debug(`Executing operation: ${operation.type}`);

    switch (operation.type) {
      case 'getAddressBalances': {
        const { address } = operation;
        this.logger.debug(`Fetching raw address balance - Address: ${maskAddress(address)}`);
        return (await this.getAddressBalances(address)) as Result<T, Error>;
      }
      case 'getAddressTokenBalances': {
        const { address, contractAddresses } = operation;
        this.logger.debug(`Fetching raw token balances - Address: ${maskAddress(address)}`);
        return (await this.getAddressTokenBalances(address, contractAddresses)) as Result<T, Error>;
      }
      case 'getTokenMetadata': {
        const { contractAddresses } = operation;
        this.logger.debug(`Fetching token metadata - Contracts: ${contractAddresses.length} addresses`);
        return (await this.getTokenMetadata(contractAddresses)) as Result<T, Error>;
      }
      default:
        return err(new Error(`Unsupported operation: ${operation.type}`));
    }
  }

  async *executeStreaming<T extends NormalizedTransactionBase = NormalizedTransactionBase>(
    operation: ProviderOperation,
    resumeCursor?: CursorState
  ): AsyncIterableIterator<Result<StreamingBatchResult<T>, Error>> {
    if (operation.type !== 'getAddressTransactions') {
      yield err(new Error(`Streaming not yet implemented for operation: ${operation.type}`));
      return;
    }

    // Route based on transaction type
    const transactionType = operation.transactionType || 'normal';
    switch (transactionType) {
      case 'normal':
        yield* this.streamAddressTransactions(operation.address, resumeCursor) as AsyncIterableIterator<
          Result<StreamingBatchResult<T>, Error>
        >;
        break;
      case 'token':
        yield* this.streamAddressTokenTransactions(
          operation.address,
          operation.contractAddress,
          resumeCursor
        ) as AsyncIterableIterator<Result<StreamingBatchResult<T>, Error>>;
        break;
      case 'internal':
        // Moralis includes internal transactions automatically in getAddressTransactions
        // with the 'include=internal_transactions' parameter. Yield empty completion batch
        // to signal successful completion without duplicate fetching.
        this.logger.info(
          `Moralis internal transactions are included in getAddressTransactions stream - yielding empty batch for ${maskAddress(operation.address)}`
        );
        yield ok({
          data: [],
          cursor: createEmptyCompletionCursor({
            providerName: this.name,
            operationType: 'internal',
            identifier: operation.address,
          }),
          isComplete: true,
        });
        break;
      default:
        yield err(new Error(`Unsupported transaction type: ${transactionType}`));
    }
  }

  getHealthCheckConfig() {
    return {
      endpoint: `/dateToBlock?chain=${this.moralisChainId}&date=2023-01-01T00:00:00.000Z`,
      validate: (response: unknown) => {
        const data = response as { block: number };
        return data && typeof data.block === 'number';
      },
    };
  }

  async getTokenMetadata(contractAddresses: string[]): Promise<Result<TokenMetadata[], Error>> {
    if (contractAddresses.length === 0) {
      return ok([]);
    }

    const params = new URLSearchParams({
      chain: this.moralisChainId,
    });

    // Build addresses[0], addresses[1], etc. for batch request
    contractAddresses.forEach((address, index) => {
      params.append(`addresses[${index}]`, address);
    });

    const endpoint = `/erc20/metadata?${params.toString()}`;
    const result = await this.httpClient.get(endpoint, { schema: z.array(MoralisTokenMetadataSchema) });

    if (result.isErr()) {
      this.logger.warn(
        `Failed to fetch token metadata for ${contractAddresses.length} addresses: ${getErrorMessage(result.error)}`
      );
      return err(result.error);
    }

    const rawMetadataArray = result.value;
    if (!rawMetadataArray || rawMetadataArray.length === 0) {
      return err(new Error(`No metadata returned for ${contractAddresses.length} token(s)`));
    }

    // Map each returned metadata to our format
    const metadataResults: TokenMetadata[] = rawMetadataArray.map((metadata) => ({
      contractAddress: metadata.address || '',
      refreshedAt: new Date(),
      decimals: metadata.decimals ?? undefined,
      logoUrl: metadata.logo ?? undefined,
      name: metadata.name ?? undefined,
      symbol: metadata.symbol ?? undefined,

      // Professional spam detection from Moralis (primary signal for scam identification)
      possibleSpam: metadata.possible_spam ?? undefined,
      verifiedContract: metadata.verified_contract ?? undefined,

      // Additional metadata
      totalSupply: metadata.total_supply ?? undefined,
      createdAt: metadata.created_at ?? undefined,
      blockNumber: metadata.block_number ?? undefined,

      source: 'moralis',
    }));

    return ok(metadataResults);
  }

  private async getAddressBalances(address: string): Promise<Result<RawBalanceData, Error>> {
    const params = new URLSearchParams({
      chain: this.moralisChainId,
    });

    const endpoint = `/${address}/balance?${params.toString()}`;
    const result = await this.httpClient.get(endpoint, { schema: MoralisNativeBalanceSchema });

    if (result.isErr()) {
      this.logger.error(`Failed to fetch raw address balance for ${address} - Error: ${getErrorMessage(result.error)}`);
      return err(result.error);
    }

    const response = result.value;

    // Convert from wei to decimal
    const balanceDecimal = convertWeiToDecimal(response.balance, this.chainConfig.nativeDecimals);

    this.logger.debug(`Found raw native balance for ${address}: ${balanceDecimal}`);
    return ok({
      rawAmount: response.balance,
      symbol: this.chainConfig.nativeCurrency,
      decimals: this.chainConfig.nativeDecimals,
      decimalAmount: balanceDecimal,
    } as RawBalanceData);
  }

  private async getAddressTokenBalances(
    address: string,
    contractAddresses?: string[]
  ): Promise<Result<RawBalanceData[], Error>> {
    const params = new URLSearchParams({
      chain: this.moralisChainId,
    });

    if (contractAddresses) {
      contractAddresses.forEach((contract) => {
        params.append('token_addresses[]', contract);
      });
    }

    const endpoint = `/${address}/erc20?${params.toString()}`;
    const result = await this.httpClient.get(endpoint, { schema: z.array(MoralisTokenBalanceSchema) });

    if (result.isErr()) {
      this.logger.error(`Failed to fetch raw token balances for ${address} - Error: ${getErrorMessage(result.error)}`);
      return err(result.error);
    }

    const rawBalances = result.value || [];

    // Convert to RawBalanceData format
    const balances: RawBalanceData[] = [];
    for (const balance of rawBalances) {
      // Skip tokens with missing decimals - we can't accurately convert them
      if (balance.decimals === null || balance.decimals === undefined) {
        this.logger.warn(
          `Skipping token ${balance.token_address} with missing decimals (name: ${balance.name || 'unknown'}, symbol: ${balance.symbol || 'unknown'})`
        );
        continue;
      }

      // Convert from smallest units to decimal string
      const balanceDecimal = convertWeiToDecimal(balance.balance, balance.decimals);

      balances.push({
        rawAmount: balance.balance,
        decimals: balance.decimals,
        decimalAmount: balanceDecimal,
        symbol: balance.symbol || undefined,
        contractAddress: balance.token_address,
      });
    }

    this.logger.debug(`Found ${balances.length} raw token balances for ${address}`);
    return ok(balances);
  }

  private streamAddressTransactions(
    address: string,
    resumeCursor?: CursorState
  ): AsyncIterableIterator<Result<StreamingBatchResult<EvmTransaction>, Error>> {
    const fetchPage = async (ctx: StreamingPageContext): Promise<Result<StreamingPage<MoralisTransaction>, Error>> => {
      const params = new URLSearchParams({
        chain: this.moralisChainId,
        limit: '100',
        order: 'ASC', // Ascending order (oldest first) for correct cursor extraction
      });

      if (ctx.pageToken) {
        params.append('cursor', ctx.pageToken);
      }

      if (ctx.replayedCursor?.type === 'blockNumber') {
        params.append('from_block', String(ctx.replayedCursor.value));
      }

      // Include internal transactions in the same call for efficiency
      params.append('include', 'internal_transactions');

      const endpoint = `/${address}?${params.toString()}`;
      const result = await this.httpClient.get(endpoint, { schema: MoralisTransactionResponseSchema });

      if (result.isErr()) {
        this.logger.error(
          `Failed to fetch address transactions for ${maskAddress(address)} - Error: ${getErrorMessage(result.error)}`
        );
        return err(result.error);
      }

      const response = result.value;
      return ok({
        items: response.result || [],
        nextPageToken: response.cursor ?? undefined,
        isComplete: !response.cursor,
      });
    };

    return createStreamingIterator<MoralisTransaction, EvmTransaction>({
      providerName: this.name,
      operation: { type: 'getAddressTransactions', address },
      resumeCursor,
      fetchPage,
      mapItem: (raw) => {
        const mapped = mapMoralisTransaction(raw, this.chainConfig.nativeCurrency);
        if (mapped.isErr()) {
          const errorMessage = mapped.error.type === 'error' ? mapped.error.message : mapped.error.reason;
          this.logger.error(
            `Provider data validation failed - Address: ${maskAddress(address)}, Error: ${errorMessage}`
          );
          return err(new Error(`Provider data validation failed: ${errorMessage}`));
        }

        const results: TransactionWithRawData<EvmTransaction>[] = [
          {
            raw,
            normalized: mapped.value,
          },
        ];

        // Unpack and map internal transactions
        if (raw.internal_transactions && raw.internal_transactions.length > 0) {
          const parentTimestamp = new Date(raw.block_timestamp).getTime();

          for (let i = 0; i < raw.internal_transactions.length; i++) {
            const internalTx = raw.internal_transactions[i]!;
            const internalMapResult = mapMoralisInternalTransaction(
              internalTx,
              parentTimestamp,
              this.chainConfig.nativeCurrency,
              i // Pass array index for uniqueness
            );

            if (internalMapResult.isErr()) {
              const errorMessage =
                internalMapResult.error.type === 'error'
                  ? internalMapResult.error.message
                  : internalMapResult.error.reason;
              this.logger.error(`Internal transaction validation failed - Parent: ${raw.hash}, Error: ${errorMessage}`);
              return err(new Error(`Internal transaction validation failed: ${errorMessage}`));
            }

            results.push({
              raw: internalTx,
              normalized: internalMapResult.value,
            });
          }

          this.logger.debug(`Unpacked ${raw.internal_transactions.length} internal transaction(s) from ${raw.hash}`);
        }

        return ok(results);
      },
      extractCursors: (tx) => this.extractCursors(tx),
      applyReplayWindow: (cursor) => this.applyReplayWindow(cursor),
      dedupWindowSize: 500,
      logger: this.logger,
    });
  }

  private streamAddressTokenTransactions(
    address: string,
    contractAddress?: string,
    resumeCursor?: CursorState
  ): AsyncIterableIterator<Result<StreamingBatchResult<EvmTransaction>, Error>> {
    const fetchPage = async (
      ctx: StreamingPageContext
    ): Promise<Result<StreamingPage<MoralisTokenTransfer>, Error>> => {
      const params = new URLSearchParams({
        chain: this.moralisChainId,
        limit: '100',
        order: 'ASC', // Ascending order (oldest first) for correct cursor extraction
      });

      if (contractAddress) {
        params.append('contract_addresses[]', contractAddress);
      }

      if (ctx.pageToken) {
        params.append('cursor', ctx.pageToken);
      }

      if (ctx.replayedCursor?.type === 'blockNumber') {
        params.append('from_block', String(ctx.replayedCursor.value));
      }

      const endpoint = `/${address}/erc20/transfers?${params.toString()}`;
      const result = await this.httpClient.get(endpoint, { schema: MoralisTokenTransferResponseSchema });

      if (result.isErr()) {
        this.logger.error(
          `Failed to fetch token transactions for ${maskAddress(address)} - Error: ${getErrorMessage(result.error)}`
        );
        return err(result.error);
      }

      const response = result.value;
      return ok({
        items: response.result || [],
        nextPageToken: response.cursor ?? undefined,
        isComplete: !response.cursor,
      });
    };

    return createStreamingIterator<MoralisTokenTransfer, EvmTransaction>({
      providerName: this.name,
      operation: { type: 'getAddressTransactions', transactionType: 'token', address, contractAddress },
      resumeCursor,
      fetchPage,
      mapItem: (raw) => {
        const mapped = mapMoralisTokenTransfer(raw);
        if (mapped.isErr()) {
          const errorMessage = mapped.error.type === 'error' ? mapped.error.message : mapped.error.reason;
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
