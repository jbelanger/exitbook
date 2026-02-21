import type { CursorState, PaginationCursor, TokenMetadata } from '@exitbook/core';
import { getErrorMessage } from '@exitbook/core';
import { err, ok, okAsync, type Result } from 'neverthrow';

import type {
  NormalizedTransactionBase,
  OneShotOperation,
  OneShotOperationResult,
  ProviderConfig,
  ProviderFactory,
  ProviderMetadata,
  ProviderOperation,
  RawBalanceData,
  StreamingBatchResult,
  StreamingOperation,
} from '../../../../core/index.js';
import { BaseApiClient, maskAddress } from '../../../../core/index.js';
import {
  createStreamingIterator,
  type StreamingPage,
  type StreamingPageContext,
} from '../../../../core/streaming/streaming-adapter.js';
import { transformXrpBalance, toIssuedCurrencyRawBalance } from '../../balance-utils.js';
import type { XrpChainConfig } from '../../chain-config.interface.js';
import { getXrpChainConfig } from '../../chain-registry.js';
import type { XrpTransaction } from '../../schemas.js';
import { isValidXrpAddress } from '../../utils.js';

import { mapXrplTransaction } from './xrpl-rpc.mapper-utils.js';
import {
  XrplAccountInfoResponseSchema,
  XrplAccountLinesResponseSchema,
  XrplAccountTxResponseSchema,
  type XrplAccountInfoResponse,
  type XrplAccountLinesResponse,
  type XrplAccountTxResponse,
  type XrplTransactionWithMeta,
} from './xrpl-rpc.schemas.js';

const XRPL_PAGE_SIZE = 200; // XRPL supports up to 400, use 200 for safety

/**
 * Pagination marker for XRPL account_tx
 * Contains ledger index and sequence number
 */
interface XrplPaginationMarker {
  ledger: number;
  seq: number;
}

export const xrplRpcMetadata: ProviderMetadata = {
  baseUrl: 'https://s1.ripple.com:51234',
  blockchain: 'xrp',
  capabilities: {
    supportedOperations: [
      'getAddressTransactions',
      'getAddressBalances',
      'getAddressTokenBalances',
      'getTokenMetadata',
    ],
    supportedTransactionTypes: ['normal'],
    supportedCursorTypes: ['pageToken', 'blockNumber', 'timestamp'],
    preferredCursorType: 'pageToken',
    replayWindow: { blocks: 2 },
  },
  defaultConfig: {
    rateLimit: {
      burstLimit: 10,
      requestsPerHour: 3600,
      requestsPerMinute: 60,
      requestsPerSecond: 1,
    },
    retries: 3,
    timeout: 30000,
  },
  description: 'XRPL public RPC API with transaction history and balance queries',
  displayName: 'XRPL RPC',
  name: 'xrpl-rpc',
  requiresApiKey: false,
};

export const xrplRpcFactory: ProviderFactory = {
  create: (config: ProviderConfig) => new XrplRpcApiClient(config),
  metadata: xrplRpcMetadata,
};

export class XrplRpcApiClient extends BaseApiClient {
  private readonly chainConfig: XrpChainConfig;

  constructor(config: ProviderConfig) {
    super(config);

    const chainConfig = getXrpChainConfig(config.blockchain);
    if (!chainConfig) {
      throw new Error(`Unsupported blockchain for XRPL RPC provider: ${config.blockchain}`);
    }
    this.chainConfig = chainConfig;

    // Override base URL with chain-specific URL
    this.reinitializeHttpClient({
      baseUrl: this.chainConfig.rpcUrl,
      defaultHeaders: {
        'Content-Type': 'application/json',
      },
    });

    this.logger.debug(`Initialized XrplRpcApiClient for ${config.blockchain} - RpcUrl: ${this.chainConfig.rpcUrl}`);
  }

  extractCursors(transaction: XrpTransaction): PaginationCursor[] {
    const cursors: PaginationCursor[] = [];

    if (transaction.ledgerIndex !== undefined) {
      cursors.push({ type: 'blockNumber', value: transaction.ledgerIndex });
    }

    if (transaction.timestamp) {
      cursors.push({ type: 'timestamp', value: transaction.timestamp });
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
      case 'getAddressTokenBalances':
        return (await this.getAddressTokenBalances({
          address: operation.address,
          contractAddresses: operation.contractAddresses,
        })) as Result<OneShotOperationResult<TOperation>, Error>;
      case 'getTokenMetadata':
        return (await this.getTokenMetadata(operation.contractAddresses)) as Result<
          OneShotOperationResult<TOperation>,
          Error
        >;
      default:
        return err(new Error(`Unsupported operation: ${operation.type}`));
    }
  }

  async *executeStreaming<T extends NormalizedTransactionBase = NormalizedTransactionBase>(
    operation: StreamingOperation,
    resumeCursor?: CursorState
  ): AsyncIterableIterator<Result<StreamingBatchResult<T>, Error>> {
    if (operation.type !== 'getAddressTransactions') {
      yield err(new Error(`Streaming not yet implemented for operation: ${(operation as ProviderOperation).type}`));
      return;
    }

    yield* this.streamAddressTransactions(operation.address, resumeCursor) as AsyncIterableIterator<
      Result<StreamingBatchResult<T>, Error>
    >;
  }

  getHealthCheckConfig() {
    return {
      body: {
        id: 1,
        jsonrpc: '2.0',
        method: 'server_info',
      },
      endpoint: '/',
      method: 'POST' as const,
      validate: (response: unknown) => {
        const data = response as { result?: { info?: { complete_ledgers?: string } } };
        return !!data?.result?.info?.complete_ledgers;
      },
    };
  }

  async getTokenMetadata(contractAddresses: string[]): Promise<Result<TokenMetadata[], Error>> {
    if (contractAddresses.length === 0) {
      return okAsync([]);
    }

    // XRPL tokens are identified by issuer:currency format
    // contractAddress format: "issuer:currency"
    // For XRPL, metadata is limited - we can only return what we can extract from the trust line
    // In practice, this would need to query additional on-chain data or use a separate API
    this.logger.warn('Token metadata lookup not fully implemented for XRPL - returning basic info');

    const metadata: TokenMetadata[] = contractAddresses.map((addr) => {
      const [_issuer, currency] = addr.split(':');
      return {
        contractAddress: addr,
        symbol: currency || undefined,
      };
    });

    return ok(metadata);
  }

  private async getAddressBalances(params: { address: string }): Promise<Result<RawBalanceData, Error>> {
    const { address } = params;

    if (!isValidXrpAddress(address)) {
      return err(new Error(`Invalid XRP address: ${address}`));
    }

    this.logger.debug(`Fetching raw address balance - Address: ${maskAddress(address)}`);

    const result = await this.httpClient.post<XrplAccountInfoResponse>(
      '/',
      {
        id: 1,
        jsonrpc: '2.0',
        method: 'account_info',
        params: [
          {
            account: address,
            ledger_index: 'validated',
          },
        ],
      },
      { schema: XrplAccountInfoResponseSchema }
    );

    if (result.isErr()) {
      this.logger.error(
        `Failed to get raw address balance - Address: ${maskAddress(address)}, Error: ${getErrorMessage(result.error)}`
      );
      return err(result.error);
    }

    const response = result.value;

    if (!response?.result?.account_data) {
      return err(new Error('Failed to fetch XRP balance from XRPL RPC'));
    }

    const balanceData = transformXrpBalance(response.result.account_data.Balance);

    this.logger.debug(
      `Successfully retrieved raw address balance - Address: ${maskAddress(address)}, XRP: ${balanceData.decimalAmount}`
    );

    return ok(balanceData);
  }

  private async getAddressTokenBalances(params: {
    address: string;
    contractAddresses?: string[] | undefined;
  }): Promise<Result<RawBalanceData[], Error>> {
    const { address, contractAddresses } = params;

    if (!isValidXrpAddress(address)) {
      return err(new Error(`Invalid XRP address: ${address}`));
    }

    this.logger.debug(`Fetching raw token balances - Address: ${maskAddress(address)}`);

    const allBalances: RawBalanceData[] = [];
    let marker: string | undefined;
    const maxPages = 100; // Safety limit to prevent infinite loops
    let pageCount = 0;

    // Fetch all pages of trust lines
    do {
      const result = await this.httpClient.post<XrplAccountLinesResponse>(
        '/',
        {
          id: 1,
          jsonrpc: '2.0',
          method: 'account_lines',
          params: [
            {
              account: address,
              ledger_index: 'validated',
              marker,
            },
          ],
        },
        { schema: XrplAccountLinesResponseSchema }
      );

      if (result.isErr()) {
        this.logger.error(
          `Failed to get raw token balances - Address: ${maskAddress(address)}, Error: ${getErrorMessage(result.error)}`
        );
        return err(result.error);
      }

      const response = result.value;

      if (!response?.result?.lines) {
        break;
      }

      // Convert trust lines to balance data
      const pageBalances = response.result.lines.map((line) =>
        toIssuedCurrencyRawBalance(line.currency, line.balance, line.account)
      );

      allBalances.push(...pageBalances);

      // Update marker for next page
      marker = response.result.marker;
      pageCount++;

      if (pageCount >= maxPages) {
        const errorMsg = `Reached max page limit (${maxPages}) for token balances - Address: ${maskAddress(address)}. Account has too many trust lines to fetch safely.`;
        this.logger.error(errorMsg);
        return err(new Error(errorMsg));
      }
    } while (marker);

    // Filter by contractAddresses if specified
    let filteredBalances = allBalances;
    if (contractAddresses && contractAddresses.length > 0) {
      const addressSet = new Set(contractAddresses);
      filteredBalances = allBalances.filter(
        (balance) => balance.contractAddress && addressSet.has(balance.contractAddress)
      );
    }

    this.logger.debug(
      `Successfully retrieved raw token balances - Address: ${maskAddress(address)}, TokenCount: ${filteredBalances.length} (${allBalances.length} total, ${pageCount} pages)`
    );

    return ok(filteredBalances);
  }

  private streamAddressTransactions(
    address: string,
    resumeCursor?: CursorState
  ): AsyncIterableIterator<Result<StreamingBatchResult<XrpTransaction>, Error>> {
    const fetchPage = async (
      ctx: StreamingPageContext
    ): Promise<Result<StreamingPage<XrplTransactionWithMeta>, Error>> => {
      const params: {
        account: string;
        binary?: boolean;
        forward?: boolean;
        ledger_index_max?: number;
        ledger_index_min?: number;
        limit?: number;
        marker?: XrplPaginationMarker;
      } = {
        account: address,
        binary: false,
        forward: true, // Oldest to newest for proper cursor resume
        ledger_index_max: -1, // Latest validated ledger
        ledger_index_min: -1, // Earliest available ledger
        limit: XRPL_PAGE_SIZE,
      };

      // Use pageToken as the marker for pagination
      if (ctx.pageToken) {
        try {
          params.marker = JSON.parse(ctx.pageToken) as XrplPaginationMarker;
        } catch (error) {
          this.logger.warn(`Failed to parse pageToken: ${ctx.pageToken}, Error: ${getErrorMessage(error)}`);
        }
      }

      // Apply ledger_index_min from cursor for replay window
      if (ctx.replayedCursor?.type === 'blockNumber') {
        params.ledger_index_min = ctx.replayedCursor.value;
      } else if (ctx.resumeCursor?.alternatives) {
        const blockCursor = ctx.resumeCursor.alternatives.find((c) => c.type === 'blockNumber');
        if (blockCursor) {
          params.ledger_index_min = blockCursor.value;
        }
      }

      const result = await this.httpClient.post<XrplAccountTxResponse>(
        '/',
        {
          id: 1,
          jsonrpc: '2.0',
          method: 'account_tx',
          params: [params],
        },
        { schema: XrplAccountTxResponseSchema }
      );

      if (result.isErr()) {
        this.logger.error(
          `Failed to fetch transactions for ${maskAddress(address)} - Error: ${getErrorMessage(result.error)}`
        );
        return err(result.error);
      }

      const response = result.value;

      if (!response?.result?.transactions) {
        return ok({
          items: [],
          isComplete: true,
        });
      }

      const transactions = response.result.transactions;
      const marker = response.result.marker;

      return ok({
        items: transactions,
        nextPageToken: marker ? JSON.stringify(marker) : undefined,
        isComplete: !marker,
      });
    };

    return createStreamingIterator<XrplTransactionWithMeta, XrpTransaction>({
      providerName: this.name,
      operation: { type: 'getAddressTransactions', address },
      resumeCursor,
      fetchPage,
      mapItem: (raw) => {
        const mapped = mapXrplTransaction(raw, address);
        if (mapped.isErr()) {
          const errorMessage = mapped.error.type === 'error' ? mapped.error.message : mapped.error.reason;
          this.logger.error(
            `Provider data validation failed - Address: ${maskAddress(address)}, Error: ${errorMessage}`
          );
          return err(new Error(`Provider data validation failed: ${errorMessage}`));
        }
        return ok([{ raw, normalized: mapped.value }]);
      },
      extractCursors: (tx) => this.extractCursors(tx),
      applyReplayWindow: (cursor) => this.applyReplayWindow(cursor),
      dedupWindowSize: 200,
      logger: this.logger,
    });
  }
}
