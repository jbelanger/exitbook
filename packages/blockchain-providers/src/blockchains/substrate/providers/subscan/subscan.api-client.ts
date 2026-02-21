import type { CursorState, PaginationCursor } from '@exitbook/core';
import { getErrorMessage } from '@exitbook/core';
import { err, ok, type Result } from 'neverthrow';

import type {
  NormalizedTransactionBase,
  ProviderConfig,
  ProviderFactory,
  ProviderMetadata,
  ProviderOperation,
  StreamingBatchResult,
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
  StreamingOperation,
} from '../../../../core/types/index.js';
import { maskAddress } from '../../../../core/utils/address-utils.js';
import { convertToMainUnit, createRawBalanceData } from '../../balance-utils.js';
import type { SubstrateChainConfig } from '../../chain-config.interface.js';
import { getSubstrateChainConfig } from '../../chain-registry.js';
import type { SubstrateTransaction } from '../../types.js';
import { isValidSS58Address } from '../../utils.js';

import { convertSubscanTransaction } from './subscan.mapper-utils.js';
import type { SubscanAccountResponse, SubscanTransfer, SubscanTransfersResponse } from './subscan.schemas.js';
import { SubscanAccountResponseSchema, SubscanTransfersResponseSchema } from './subscan.schemas.js';

/**
 * Maps blockchain names to Subscan-specific subdomain identifiers
 * Generated from Subscan network list - mainnet chains only
 */
const CHAIN_SUBDOMAIN_MAP: Record<string, string> = {
  acala: 'acala',
  'aleph-zero': 'alephzero',
  altair: 'altair',
  'assethub-kusama': 'assethub-kusama',
  'assethub-paseo': 'assethub-paseo',
  'assethub-polkadot': 'assethub-polkadot',
  'assethub-westend': 'assethub-westend',
  astar: 'astar',
  'autonomys-chronos': 'autonomys-chronos',
  autonomys: 'autonomys',
  'avail-turing': 'avail-turing',
  avail: 'avail',
  basilisk: 'basilisk',
  bifrost: 'bifrost',
  'bifrost-kusama': 'bifrost-kusama',
  'bridgehub-kusama': 'bridgehub-kusama',
  'bridgehub-paseo': 'bridgehub-paseo',
  'bridgehub-polkadot': 'bridgehub-polkadot',
  'bridgehub-westend': 'bridgehub-westend',
  calamari: 'calamari',
  canary: 'canary',
  'canary-matrix': 'canary-matrix',
  'cc-enterprise': 'cc-enterprise',
  centrifuge: 'centrifuge',
  clover: 'clover',
  'collectives-polkadot': 'collectives-polkadot',
  'coretime-kusama': 'coretime-kusama',
  'coretime-paseo': 'coretime-paseo',
  'coretime-polkadot': 'coretime-polkadot',
  'coretime-westend': 'coretime-westend',
  creditcoin: 'creditcoin',
  crust: 'crust',
  'crust-parachain': 'crust-parachain',
  dancelight: 'dancelight',
  darwinia: 'darwinia',
  dbc: 'dbc',
  dock: 'dock',
  energywebx: 'energywebx',
  enjin: 'enjin',
  gasp: 'gasp',
  heima: 'heima',
  humanode: 'humanode',
  hydradx: 'hydration',
  hydration: 'hydration',
  integritee: 'integritee',
  karura: 'karura',
  khala: 'khala',
  kilt: 'spiritnet',
  krest: 'krest',
  kusama: 'kusama',
  manta: 'manta',
  matrix: 'matrix',
  moonbase: 'moonbase',
  moonbeam: 'moonbeam',
  moonriver: 'moonriver',
  mythos: 'mythos',
  neuroweb: 'neuroweb',
  nodle: 'nodle',
  opal: 'opal',
  paseo: 'paseo',
  peaq: 'peaq',
  pendulum: 'pendulum',
  'people-kusama': 'people-kusama',
  'people-paseo': 'people-paseo',
  'people-polkadot': 'people-polkadot',
  'people-westend': 'people-westend',
  phala: 'phala',
  polkadot: 'polkadot',
  polymesh: 'polymesh',
  pro: 'pro',
  reef: 'reef',
  robonomics: 'robonomics',
  'robonomics-freemium': 'robonomics-freemium',
  shibuya: 'shibuya',
  shiden: 'shiden',
  sora: 'sora',
  spiritnet: 'spiritnet',
  stafi: 'stafi',
  statemine: 'assethub-kusama',
  statemint: 'assethub-polkadot',
  sxt: 'sxt',
  tanssi: 'tanssi',
  unique: 'unique',
  vara: 'vara',
  vflow: 'vflow',
  westend: 'westend',
  zkverify: 'zkverify',
};

export const subscanMetadata: ProviderMetadata = {
  baseUrl: 'https://polkadot.api.subscan.io',
  blockchain: 'polkadot',
  capabilities: {
    supportedOperations: ['getAddressTransactions', 'getAddressBalances'],
    supportedTransactionTypes: ['normal'],
    supportedCursorTypes: ['pageToken', 'blockNumber', 'timestamp'],
    preferredCursorType: 'pageToken',
  },
  defaultConfig: {
    rateLimit: {
      burstLimit: 4,
      requestsPerHour: 500,
      requestsPerMinute: 120,
      requestsPerSecond: 2,
    },
    retries: 3,
    timeout: 10000,
  },
  description: 'Polkadot and Kusama networks provider with Subscan API integration',
  displayName: 'Subscan',
  name: 'subscan',
  requiresApiKey: false,
  supportedChains: Object.keys(CHAIN_SUBDOMAIN_MAP),
};

export const subscanFactory: ProviderFactory = {
  create: (config: ProviderConfig) => new SubscanApiClient(config),
  metadata: subscanMetadata,
};

export class SubscanApiClient extends BaseApiClient {
  private readonly chainConfig: SubstrateChainConfig;
  private readonly subscanSubdomain: string;

  constructor(config: ProviderConfig) {
    super(config);

    // Get chain config
    const chainConfig = getSubstrateChainConfig(config.blockchain);
    if (!chainConfig) {
      throw new Error(`Unsupported blockchain for Subscan provider: ${config.blockchain}`);
    }
    this.chainConfig = chainConfig;

    // Map to Subscan subdomain
    const mappedSubdomain = CHAIN_SUBDOMAIN_MAP[config.blockchain];
    if (!mappedSubdomain) {
      throw new Error(`No Subscan subdomain mapping for blockchain: ${config.blockchain}`);
    }
    this.subscanSubdomain = mappedSubdomain;

    // Override base URL with chain-specific subdomain
    this.reinitializeHttpClient({
      baseUrl: `https://${this.subscanSubdomain}.api.subscan.io`,
    });

    this.logger.debug(
      `Initialized SubscanApiClient for ${config.blockchain} - Subdomain: ${this.subscanSubdomain}, BaseUrl: ${this.baseUrl}, TokenSymbol: ${this.chainConfig.nativeCurrency}`
    );
  }

  extractCursors(transaction: SubstrateTransaction): PaginationCursor[] {
    const cursors: PaginationCursor[] = [];

    // Primary cursor: transaction timestamp
    if (transaction.timestamp) {
      cursors.push({ type: 'timestamp', value: transaction.timestamp });
    }

    // Alternative cursor: block height if available
    if (transaction.blockHeight !== undefined) {
      cursors.push({ type: 'blockNumber', value: transaction.blockHeight });
    }

    return cursors;
  }

  applyReplayWindow(cursor: PaginationCursor): PaginationCursor {
    // Page-based pagination is precise, no replay window needed
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
      endpoint: '/api/scan/metadata',
      method: 'POST' as const,
      body: {},
      validate: (response: unknown) => {
        const data = response as { code?: number };
        return data && data.code === 0;
      },
    };
  }

  private async getAddressBalances(params: { address: string }): Promise<Result<RawBalanceData, Error>> {
    const { address } = params;

    // Validate address format
    if (!isValidSS58Address(address)) {
      return err(new Error(`Invalid SS58 address for ${this.blockchain}: ${address}`));
    }

    this.logger.debug(`Fetching raw address balance - Address: ${maskAddress(address)}`);

    const result = await this.httpClient.post<SubscanAccountResponse>(
      '/api/scan/account',
      {
        key: address,
      },
      { schema: SubscanAccountResponseSchema }
    );

    if (result.isErr()) {
      this.logger.error(
        `Failed to fetch raw address balance - Address: ${maskAddress(address)}, Error: ${getErrorMessage(result.error)}`
      );
      return err(result.error);
    }

    const response = result.value;

    // Check for API errors
    if (response.code !== 0) {
      const error = new Error(`Subscan API error: ${response.message || `Code ${response.code}`}`);
      this.logger.error(
        `Failed to fetch raw address balance - Address: ${maskAddress(address)}, Error: ${getErrorMessage(error)}`
      );
      return err(error);
    }

    // Convert from smallest unit to main unit
    const balanceSmallest = response.data?.balance || '0';
    const balanceDecimal = convertToMainUnit(balanceSmallest, this.chainConfig.nativeDecimals);

    this.logger.debug(
      `Found raw balance for ${maskAddress(address)}: ${balanceDecimal} ${this.chainConfig.nativeCurrency}`
    );

    return ok(
      createRawBalanceData(
        balanceSmallest,
        balanceDecimal,
        this.chainConfig.nativeDecimals,
        this.chainConfig.nativeCurrency
      )
    );
  }

  /**
   * Stream address transactions with page-based pagination
   * Subscan uses 0-based page numbering
   */
  private streamAddressTransactions(
    address: string,
    resumeCursor?: CursorState
  ): AsyncIterableIterator<Result<StreamingBatchResult<SubstrateTransaction>, Error>> {
    const fetchPage = async (ctx: StreamingPageContext): Promise<Result<StreamingPage<SubscanTransfer>, Error>> => {
      // Subscan uses 0-based page numbering
      const page = ctx.pageToken ? parseInt(ctx.pageToken, 10) : 0;
      const rowsPerPage = 100;

      this.logger.debug(`Fetching transfers page ${page} - Address: ${maskAddress(address)}`);

      const body: Record<string, unknown> = {
        address: address,
        page: page,
        row: rowsPerPage,
      };

      const result = await this.httpClient.post<SubscanTransfersResponse>('/api/v2/scan/transfers', body, {
        schema: SubscanTransfersResponseSchema,
      });

      if (result.isErr()) {
        this.logger.error(
          `Failed to fetch transfers for ${maskAddress(address)} page ${page} - Error: ${getErrorMessage(result.error)}`
        );
        return err(result.error);
      }

      const response = result.value;

      // Check for API errors
      if (response.code !== 0) {
        const error = new Error(`Subscan API error: ${response.message || `Code ${response.code}`}`);
        this.logger.error(
          `Failed to fetch transfers - Address: ${maskAddress(address)}, Page: ${page}, Error: ${getErrorMessage(error)}`
        );
        return err(error);
      }

      const transfers = response.data?.transfers || [];

      if (transfers.length === 0) {
        return ok({
          items: [],
          nextPageToken: undefined,
          isComplete: true,
        });
      }

      // Check if there are more pages
      const hasMore = transfers.length === rowsPerPage;
      const nextPageToken = hasMore ? String(page + 1) : undefined;

      this.logger.debug(
        `Fetched page ${page} - Address: ${maskAddress(address)}, Transfers: ${transfers.length}, HasMore: ${hasMore}`
      );

      return ok({
        items: transfers,
        nextPageToken,
        isComplete: !hasMore,
      });
    };

    return createStreamingIterator<SubscanTransfer, SubstrateTransaction>({
      providerName: this.name,
      operation: { type: 'getAddressTransactions', address },
      resumeCursor,
      fetchPage,
      mapItem: (raw) => {
        // Normalize transaction using pure mapping function
        const relevantAddresses = new Set([address]);
        const mapResult = convertSubscanTransaction(
          raw,
          relevantAddresses,
          this.chainConfig,
          this.chainConfig.nativeCurrency,
          this.chainConfig.nativeDecimals
        );

        // Skip transactions that aren't relevant to this address or have validation errors
        if (mapResult.isErr()) {
          const error = mapResult.error;
          if (error.type === 'skip') {
            // Return a skip error that the streaming adapter will filter out
            return err(new Error(`Transaction not relevant: ${error.reason}`));
          }
          // error.type === 'error'
          this.logger.error(
            `Provider data validation failed - Address: ${maskAddress(address)}, Error: ${error.message}`
          );
          return err(new Error(`Provider data validation failed: ${error.message}`));
        }

        return ok([
          {
            raw,
            normalized: mapResult.value,
          },
        ]);
      },
      extractCursors: (tx) => this.extractCursors(tx),
      applyReplayWindow: (cursor) => this.applyReplayWindow(cursor),
      dedupWindowSize: 200,
      logger: this.logger,
    });
  }
}
