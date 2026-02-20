import type { CursorState, PaginationCursor } from '@exitbook/core';
import { getErrorMessage } from '@exitbook/core';
import { err, ok, type Result } from 'neverthrow';
import { z, type ZodType } from 'zod';

import type {
  NormalizedTransactionBase,
  OneShotOperation,
  ProviderConfig,
  ProviderOperation,
  RawBalanceData,
  StreamingBatchResult,
  StreamingOperation,
} from '../../../../core/index.js';
import { BaseApiClient, maskAddress } from '../../../../core/index.js';
import type { NormalizationError } from '../../../../core/index.js';
import type { StreamingPage, StreamingPageContext } from '../../../../core/streaming/streaming-adapter.js';
import { createStreamingIterator } from '../../../../core/streaming/streaming-adapter.js';
import { createRawBalanceData } from '../../balance-utils.js';
import type { BitcoinChainConfig } from '../../chain-config.interface.js';
import { getBitcoinChainConfig } from '../../chain-registry.js';
import { BITCOIN_STREAMING_DEDUP_WINDOW } from '../../constants.js';
import type { BitcoinTransaction } from '../../schemas.js';

import { calculateTatumBalance } from './utils.js';

/**
 * Chain-specific parameters that differentiate each Tatum UTXO client
 */
export interface TatumUtxoChainParams<TTransaction, TBalance> {
  apiPathSegment: string;
  balanceSchema: ZodType<TBalance>;
  healthCheckAddress: string;
  mapTransaction: (
    raw: TTransaction,
    chainConfig: BitcoinChainConfig
  ) => Result<BitcoinTransaction, NormalizationError>;
  transactionSchema: ZodType<TTransaction>;
  normalizeAddress?: ((address: string) => string) | undefined;
  paginationOffsetParam?: 'offset' | 'skip' | undefined;
  supportsBlockFrom?: boolean | undefined;
}

/**
 * Generic base class for Tatum UTXO-chain API clients.
 * Absorbs all shared behavior; chain-specific differences are injected via TatumUtxoChainParams.
 */
export abstract class TatumUtxoBaseApiClient<
  TTransaction,
  TBalance extends { incoming: string; outgoing: string },
> extends BaseApiClient {
  protected readonly chainConfig: BitcoinChainConfig;
  protected readonly chainParams: TatumUtxoChainParams<TTransaction, TBalance>;

  constructor(config: ProviderConfig, chainParams: TatumUtxoChainParams<TTransaction, TBalance>) {
    super(config);

    const chainConfig = getBitcoinChainConfig(config.blockchain);
    if (!chainConfig) {
      throw new Error(`Unsupported blockchain: ${config.blockchain}`);
    }
    this.chainConfig = chainConfig;
    this.chainParams = chainParams;

    this.reinitializeHttpClient({
      baseUrl: `https://api.tatum.io/v3/${chainParams.apiPathSegment}`,
      defaultHeaders: {
        accept: 'application/json',
        'x-api-key': this.apiKey,
      },
    });

    this.logger.debug(
      `Initialized ${this.constructor.name} - BaseUrl: ${this.baseUrl}, HasApiKey: ${this.apiKey !== 'YourApiKeyToken'}`
    );
  }

  extractCursors(transaction: BitcoinTransaction): PaginationCursor[] {
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

  async execute<T>(operation: OneShotOperation): Promise<Result<T, Error>> {
    this.logger.debug(
      `Executing operation - Type: ${operation.type}, Address: ${'address' in operation ? maskAddress(operation.address) : 'N/A'}`
    );

    switch (operation.type) {
      case 'getAddressBalances':
        return (await this.getAddressBalances(operation.address)) as Result<T, Error>;
      case 'hasAddressTransactions':
        return (await this.hasAddressTransactions(operation.address)) as Result<T, Error>;
      default:
        return err(new Error(`Unsupported operation: ${operation.type}`));
    }
  }

  async *executeStreaming<T extends NormalizedTransactionBase = NormalizedTransactionBase>(
    operation: StreamingOperation,
    resumeCursor?: CursorState
  ): AsyncIterableIterator<Result<StreamingBatchResult<T>, Error>> {
    switch (operation.type) {
      case 'getAddressTransactions':
        yield* this.streamAddressTransactions(operation.address, resumeCursor) as AsyncIterableIterator<
          Result<StreamingBatchResult<T>, Error>
        >;
        break;
      default:
        yield err(new Error(`Streaming not yet implemented for operation: ${(operation as ProviderOperation).type}`));
    }
  }

  async hasAddressTransactions(address: string): Promise<Result<boolean, Error>> {
    this.logger.debug(`Checking if address has transactions - Address: ${maskAddress(address)}`);

    const normalizedAddress = this.normalizeAddress(address);
    const offsetParam = this.chainParams.paginationOffsetParam ?? 'offset';

    const txResult = await this.makeRequest<TTransaction[]>(
      `/transaction/address/${normalizedAddress}`,
      {
        [offsetParam]: 0,
        pageSize: 1,
      },
      z.array(this.chainParams.transactionSchema)
    );

    if (txResult.isErr()) {
      this.logger.error(
        `Failed to check address transactions - Address: ${maskAddress(address)}, Error: ${getErrorMessage(txResult.error)}`
      );
      return err(txResult.error);
    }

    const hasTransactions = Array.isArray(txResult.value) && txResult.value.length > 0;

    this.logger.debug(
      `Address transaction check complete - Address: ${maskAddress(address)}, HasTransactions: ${hasTransactions}`
    );

    return ok(hasTransactions);
  }

  async getAddressBalances(address: string): Promise<Result<RawBalanceData, Error>> {
    this.logger.debug(`Fetching lightweight address info - Address: ${maskAddress(address)}`);

    const normalizedAddress = this.normalizeAddress(address);
    const balanceResult = await this.makeRequest<TBalance>(
      `/address/balance/${normalizedAddress}`,
      undefined,
      this.chainParams.balanceSchema
    );

    if (balanceResult.isErr()) {
      this.logger.error(
        `Failed to get address balance - Address: ${maskAddress(address)}, Error: ${getErrorMessage(balanceResult.error)}`
      );
      return err(balanceResult.error);
    }

    const balanceData = balanceResult.value;
    const { balanceBTC, balanceSats } = calculateTatumBalance(balanceData.incoming, balanceData.outgoing);

    this.logger.debug(
      `Successfully retrieved lightweight address info - Address: ${maskAddress(address)}, Balance: ${balanceBTC}`
    );

    return ok(createRawBalanceData(balanceSats, balanceBTC, this.chainConfig.nativeCurrency));
  }

  override getHealthCheckConfig() {
    return {
      endpoint: `/address/balance/${this.chainParams.healthCheckAddress}`,
      validate: (response: unknown) => {
        return response !== null && response !== undefined;
      },
    };
  }

  private normalizeAddress(address: string): string {
    return this.chainParams.normalizeAddress ? this.chainParams.normalizeAddress(address) : address;
  }

  private streamAddressTransactions(
    address: string,
    resumeCursor?: CursorState
  ): AsyncIterableIterator<Result<StreamingBatchResult<BitcoinTransaction>, Error>> {
    const pageSize = 50; // Tatum max page size
    const offsetParam = this.chainParams.paginationOffsetParam ?? 'offset';
    const supportsBlockFrom = this.chainParams.supportsBlockFrom ?? true;

    const fetchPage = async (ctx: StreamingPageContext): Promise<Result<StreamingPage<TTransaction>, Error>> => {
      const offset = ctx.pageToken ? parseInt(ctx.pageToken, 10) : 0;

      const normalizedAddress = this.normalizeAddress(address);
      const queryParams: Record<string, unknown> = {
        [offsetParam]: offset,
        pageSize,
      };

      if (supportsBlockFrom && ctx.replayedCursor?.type === 'blockNumber') {
        queryParams['blockFrom'] = ctx.replayedCursor.value;
      }

      const result = await this.makeRequest<TTransaction[]>(
        `/transaction/address/${normalizedAddress}`,
        queryParams,
        z.array(this.chainParams.transactionSchema)
      );

      if (result.isErr()) {
        this.logger.error(
          `Failed to fetch address transactions for ${maskAddress(address)} - Error: ${getErrorMessage(result.error)}`
        );
        return err(result.error);
      }

      const items = result.value;
      const hasMore = items.length === pageSize;
      const nextOffset = hasMore ? offset + pageSize : undefined;

      return ok({
        items,
        nextPageToken: nextOffset !== undefined ? String(nextOffset) : undefined,
        isComplete: !hasMore,
      });
    };

    return createStreamingIterator<TTransaction, BitcoinTransaction>({
      providerName: this.name,
      operation: { type: 'getAddressTransactions', address },
      resumeCursor,
      fetchPage,
      mapItem: (raw) => {
        const mapped = this.chainParams.mapTransaction(raw, this.chainConfig);
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
      dedupWindowSize: BITCOIN_STREAMING_DEDUP_WINDOW,
      logger: this.logger,
    });
  }

  private async makeRequest<T>(
    endpoint: string,
    params?: Record<string, unknown>,
    schema?: ZodType<T>
  ): Promise<Result<T, Error>> {
    this.validateApiKey();

    let url = endpoint;
    if (params && Object.keys(params).length > 0) {
      const queryString = new URLSearchParams(
        Object.entries(params)
          .filter(([, value]) => value !== undefined && value !== null)
          .map(([key, value]) => [key, String(value)] as [string, string])
      ).toString();
      url = `${endpoint}?${queryString}`;
    }

    const result = schema ? await this.httpClient.get<T>(url, { schema }) : await this.httpClient.get<T>(url);

    if (result.isErr()) {
      this.logger.error(
        `Tatum API request failed - Blockchain: ${this.blockchain}, Endpoint: ${endpoint}, Error: ${getErrorMessage(result.error)}`
      );
      return err(result.error);
    }

    return ok(result.value);
  }
}
