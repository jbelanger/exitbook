import { getErrorMessage, parseDecimal, type BlockchainBalanceSnapshot } from '@exitbook/core';
import { ServiceError } from '@exitbook/platform-http';
import { err, ok, type Result } from 'neverthrow';

import { BaseApiClient } from '../../../../core/blockchain/base/api-client.ts';
import type { ProviderConfig, ProviderOperation } from '../../../../core/blockchain/index.ts';
import { RegisterApiClient } from '../../../../core/blockchain/index.ts';
import type { TransactionWithRawData } from '../../../../core/blockchain/types/index.ts';
import { maskAddress } from '../../../../core/blockchain/utils/address-utils.ts';
import type { EvmChainConfig } from '../../chain-config.interface.ts';
import { getEvmChainConfig } from '../../chain-registry.ts';
import type { EvmTransaction } from '../../types.ts';

import { RoutescanTransactionMapper } from './routescan.mapper.ts';
import type {
  RoutescanApiResponse,
  RoutescanInternalTransaction,
  RoutescanTransaction,
  RoutescanTokenTransfer,
} from './routescan.schemas.js';

/**
 * Maps blockchain names to Routescan chain IDs for free chains
 */
const CHAIN_ID_MAP: Record<string, number> = {
  animalia: 8787,
  arbitrum: 42161,
  avalanche: 43114,
  beam: 4337,
  'berachain-mainnet': 80094,
  blockticity: 28530,
  boba: 288,
  'boba-bnb': 56288,
  botanix: 3637,
  bsc: 56,
  chiliz: 88888,
  corgnet: 42069,
  corn: 21000000,
  delaunch: 96786,
  dexalot: 432204,
  dfk: 53935,
  ethereum: 1,
  feature: 33311,
  'fifa-blockchain': 13322,
  flare: 14,
  growth: 61587,
  gunz: 43419,
  henesys: 68414,
  innovo: 10036,
  'lamina1-identity': 10850,
  lamina1: 10849,
  lucid: 62521,
  mantle: 5000,
  mitosis: 124816,
  numine: 8021,
  numbers: 10507,
  optimism: 10,
  plasma: 9745,
  plyr: 16180,
  polynomial: 8008,
  pulsechain: 369,
  qchain: 12150,
  songbird: 19,
  space: 8227,
  superseed: 5330,
  tiltyard: 710420,
  titan: 84358,
  tradex: 21024,
  zeroone: 27827,
};

@RegisterApiClient({
  baseUrl: 'https://api.routescan.io/v2/network/mainnet/evm/1/etherscan/api',
  blockchain: 'ethereum',
  capabilities: {
    supportedOperations: [
      'getAddressBalances',
      'getAddressInternalTransactions',
      'getAddressTransactions',
      'getAddressTokenTransactions',
    ],
  },
  defaultConfig: {
    rateLimit: {
      burstLimit: 8,
      requestsPerHour: 12960,
      requestsPerMinute: 216,
      requestsPerSecond: 5,
    },
    retries: 3,
    timeout: 10000,
  },
  description: 'Multi-chain EVM blockchain explorer API with Etherscan-compatible interface',
  displayName: 'Routescan',
  name: 'routescan',
  requiresApiKey: false,
  supportedChains: Object.keys(CHAIN_ID_MAP),
})
export class RoutescanApiClient extends BaseApiClient {
  private readonly chainConfig: EvmChainConfig;
  private readonly routescanChainId: number;
  private mapper: RoutescanTransactionMapper;

  constructor(config: ProviderConfig) {
    super(config);

    // Get chain config
    const chainConfig = getEvmChainConfig(config.blockchain);
    if (!chainConfig) {
      throw new Error(`Unsupported blockchain for Routescan provider: ${config.blockchain}`);
    }
    this.chainConfig = chainConfig;

    // Map to Routescan chain ID
    const routescanChainId = CHAIN_ID_MAP[config.blockchain];
    if (!routescanChainId) {
      throw new Error(`No Routescan chain ID mapping for blockchain: ${config.blockchain}`);
    }
    this.routescanChainId = routescanChainId;

    // Override base URL with chain-specific URL
    this.reinitializeHttpClient({
      baseUrl: `https://api.routescan.io/v2/network/mainnet/evm/${this.routescanChainId}/etherscan/api`,
    });

    // Initialize mapper with native currency
    this.mapper = new RoutescanTransactionMapper({
      nativeCurrency: this.chainConfig.nativeCurrency,
    });

    this.logger.debug(
      `Initialized RoutescanApiClient for ${config.blockchain} - ChainId: ${this.routescanChainId}, BaseUrl: ${this.baseUrl}, NativeCurrency: ${this.chainConfig.nativeCurrency}`
    );
  }

  async execute<T>(operation: ProviderOperation): Promise<Result<T, Error>> {
    this.logger.debug(
      `Executing operation - Type: ${operation.type}, Address: ${'address' in operation ? maskAddress(operation.address) : 'N/A'}`
    );

    switch (operation.type) {
      case 'getAddressTransactions':
        return (await this.getAddressTransactions({
          address: operation.address,
        })) as Result<T, Error>;
      case 'getAddressInternalTransactions':
        return (await this.getAddressInternalTransactions({
          address: operation.address,
        })) as Result<T, Error>;
      case 'getAddressBalances':
        return (await this.getAddressBalances({
          address: operation.address,
        })) as Result<T, Error>;
      case 'getAddressTokenTransactions':
        return (await this.getAddressTokenTransactions({
          address: operation.address,
          contractAddress: operation.contractAddress,
          limit: operation.limit,
        })) as Result<T, Error>;
      default:
        return err(new Error(`Unsupported operation: ${operation.type}`));
    }
  }

  getHealthCheckConfig() {
    const params = new URLSearchParams({
      action: 'ethsupply',
      module: 'stats',
    });

    if (this.apiKey && this.apiKey !== 'YourApiKeyToken') {
      params.append('apikey', this.apiKey);
    }

    return {
      endpoint: `?${params.toString()}`,
      validate: (response: unknown) => {
        const data = response as RoutescanApiResponse<unknown>;
        return !!(data && data.status === '1');
      },
    };
  }

  private async fetchAddressInternalTransactions(
    address: string
  ): Promise<Result<RoutescanInternalTransaction[], Error>> {
    const allTransactions: RoutescanInternalTransaction[] = [];
    let page = 1;

    while (true) {
      // API constraint: page * offset <= 10000, so optimize accordingly
      const maxOffset = Math.floor(10000 / page);
      if (maxOffset < 1) break; // Can't fetch more pages

      const params = new URLSearchParams({
        action: 'txlistinternal',
        address: address,
        endblock: '99999999',
        module: 'account',
        offset: maxOffset.toString(),
        page: page.toString(),
        sort: 'asc',
        startblock: '0',
      });

      if (this.apiKey && this.apiKey !== 'YourApiKeyToken') {
        params.append('apikey', this.apiKey);
      }

      const result = await this.httpClient.get(`?${params.toString()}`);

      if (result.isErr()) {
        this.logger.error(
          `Failed to fetch internal transactions page ${page} - Error: ${getErrorMessage(result.error)}`
        );
        return err(result.error);
      }

      const res = result.value as RoutescanApiResponse<unknown>;
      if (res.status !== '1') {
        // If no results found, break the loop
        if (res.message === 'No transactions found') {
          break;
        }
        return err(
          new ServiceError(`Routescan API error: ${res.message}`, this.name, 'fetchAddressInternalTransactions')
        );
      }

      const transactions = (res.result as RoutescanInternalTransaction[]) || [];
      allTransactions.push(...transactions);

      // If we got less than the max offset, we've reached the end
      if (transactions.length < maxOffset) {
        break;
      }

      page++;
    }

    return ok(allTransactions);
  }

  private async getNormalTransactions(address: string): Promise<Result<RoutescanTransaction[], Error>> {
    const allTransactions: RoutescanTransaction[] = [];
    let page = 1;

    while (true) {
      // API constraint: page * offset <= 10000, so optimize accordingly
      const maxOffset = Math.floor(10000 / page);
      if (maxOffset < 1) break; // Can't fetch more pages

      const params = new URLSearchParams({
        action: 'txlist',
        address: address,
        endblock: '99999999',
        module: 'account',
        offset: maxOffset.toString(),
        page: page.toString(),
        sort: 'asc',
        startblock: '0',
      });

      if (this.apiKey && this.apiKey !== 'YourApiKeyToken') {
        params.append('apikey', this.apiKey);
      }

      const result = await this.httpClient.get(`?${params.toString()}`);

      if (result.isErr()) {
        this.logger.error(`Failed to fetch normal transactions page ${page} - Error: ${getErrorMessage(result.error)}`);
        return err(result.error);
      }

      const res = result.value as RoutescanApiResponse<unknown>;

      if (res.status !== '1') {
        if (res.message === 'NOTOK' && res.message.includes('Invalid API Key')) {
          return err(new ServiceError('Invalid Routescan API key', this.name, 'getNormalTransactions'));
        }
        // If no results found, break the loop
        if (res.message === 'No transactions found') {
          break;
        }
        return err(new ServiceError(`Routescan API error: ${res.message}`, this.name, 'getNormalTransactions'));
      }

      const transactions = (res.result as RoutescanTransaction[]) || [];
      allTransactions.push(...transactions);

      // If we got less than the max offset, we've reached the end
      if (transactions.length < maxOffset) {
        break;
      }

      page++;
    }

    return ok(allTransactions);
  }

  private async getAddressBalances(params: { address: string }): Promise<Result<BlockchainBalanceSnapshot, Error>> {
    const { address } = params;

    if (!this.isValidEvmAddress(address)) {
      return err(new Error(`Invalid EVM address: ${address}`));
    }

    this.logger.debug(`Fetching raw address balance - Address: ${maskAddress(address)}`);

    const urlParams = new URLSearchParams({
      action: 'balance',
      address: address,
      module: 'account',
      tag: 'latest',
    });

    if (this.apiKey && this.apiKey !== 'YourApiKeyToken') {
      urlParams.append('apikey', this.apiKey);
    }

    const result = await this.httpClient.get(`?${urlParams.toString()}`);

    if (result.isErr()) {
      this.logger.error(
        `Failed to get raw address balance - Address: ${maskAddress(address)}, Error: ${getErrorMessage(result.error)}`
      );
      return err(result.error);
    }

    const res = result.value as RoutescanApiResponse<unknown>;

    if (res.status !== '1') {
      return err(
        new ServiceError(
          `Failed to fetch ${this.chainConfig.nativeCurrency} balance: ${res.message}`,
          this.name,
          'getAddressBalances'
        )
      );
    }

    // Convert from wei to native currency (18 decimals for most EVM chains)
    const balanceWei = typeof res.result === 'string' ? res.result : String(res.result);
    const balanceDecimal = parseDecimal(balanceWei)
      .div(parseDecimal('10').pow(this.chainConfig.nativeDecimals))
      .toString();

    this.logger.debug(
      `Retrieved raw balance for ${maskAddress(address)}: ${balanceDecimal} ${this.chainConfig.nativeCurrency}`
    );

    return ok({
      total: balanceDecimal,
      asset: this.chainConfig.nativeCurrency,
    });
  }

  private async getAddressTransactions(params: {
    address: string;
  }): Promise<Result<TransactionWithRawData<EvmTransaction>[], Error>> {
    const { address } = params;

    if (!this.isValidEvmAddress(address)) {
      return err(new Error(`Invalid EVM address: ${address}`));
    }

    this.logger.debug(`Fetching raw address transactions - Address: ${maskAddress(address)}`);

    const result = await this.getNormalTransactions(address);

    if (result.isErr()) {
      this.logger.error(
        `Failed to get raw address transactions - Address: ${maskAddress(address)}, Error: ${getErrorMessage(result.error)}`
      );
      return err(result.error);
    }

    return this.normalizeTransactions(result.value, address, 'transactions');
  }

  private async getAddressInternalTransactions(params: {
    address: string;
  }): Promise<Result<TransactionWithRawData<EvmTransaction>[], Error>> {
    const { address } = params;

    if (!this.isValidEvmAddress(address)) {
      return err(new Error(`Invalid EVM address: ${address}`));
    }

    this.logger.debug(`Fetching raw address internal transactions - Address: ${maskAddress(address)}`);

    const result = await this.fetchAddressInternalTransactions(address);

    if (result.isErr()) {
      this.logger.error(
        `Failed to get raw address internal transactions - Address: ${maskAddress(address)}, Error: ${getErrorMessage(
          result.error
        )}`
      );
      return err(result.error);
    }

    return this.normalizeTransactions(result.value, address, 'internal transactions');
  }

  private async getAddressTokenTransactions(params: {
    address: string;
    contractAddress?: string | undefined;
    limit?: number | undefined;
  }): Promise<Result<TransactionWithRawData<EvmTransaction>[], Error>> {
    const { address, contractAddress } = params;
    const result = await this.getTokenTransfers(address, contractAddress);

    if (result.isErr()) {
      return err(result.error);
    }

    return this.normalizeTransactions(result.value, address, 'token transactions');
  }

  private async getTokenTransfers(
    address: string,
    contractAddress?: string
  ): Promise<Result<RoutescanTokenTransfer[], Error>> {
    const allTransactions: RoutescanTokenTransfer[] = [];
    let page = 1;

    while (true) {
      // API constraint: page * offset <= 10000, so optimize accordingly
      const maxOffset = Math.floor(10000 / page);
      if (maxOffset < 1) break; // Can't fetch more pages

      const params = new URLSearchParams({
        action: 'tokentx',
        address: address,
        endblock: '99999999',
        module: 'account',
        offset: maxOffset.toString(),
        page: page.toString(),
        sort: 'asc',
        startblock: '0',
      });

      if (contractAddress) {
        params.append('contractaddress', contractAddress);
      }

      if (this.apiKey && this.apiKey !== 'YourApiKeyToken') {
        params.append('apikey', this.apiKey);
      }

      const result = await this.httpClient.get(`?${params.toString()}`);

      if (result.isErr()) {
        this.logger.error(`Failed to fetch token transfers page ${page} - Error: ${getErrorMessage(result.error)}`);
        return err(result.error);
      }

      const res = result.value as RoutescanApiResponse<unknown>;

      if (res.status !== '1') {
        // If no results found, break the loop
        if (res.message === 'No transactions found') {
          break;
        }
        return err(new ServiceError(`Routescan API error: ${res.message}`, this.name, 'getTokenTransfers'));
      }

      const transactions = (res.result as RoutescanTokenTransfer[]) || [];
      allTransactions.push(...transactions);

      // If we got less than the max offset, we've reached the end
      if (transactions.length < maxOffset) {
        break;
      }

      page++;
    }

    return ok(allTransactions);
  }

  private isValidEvmAddress(address: string): boolean {
    // EVM addresses are 42 characters (0x + 40 hex characters)
    const ethAddressRegex = /^0x[a-fA-F0-9]{40}$/;
    return ethAddressRegex.test(address);
  }

  private normalizeTransactions(
    rawTransactions: (RoutescanTransaction | RoutescanInternalTransaction | RoutescanTokenTransfer)[],
    address: string,
    transactionType: string
  ): Result<TransactionWithRawData<EvmTransaction>[], Error> {
    if (!Array.isArray(rawTransactions) || rawTransactions.length === 0) {
      this.logger.debug(`No raw ${transactionType} found - Address: ${maskAddress(address)}`);
      return ok([]);
    }

    const transactions: TransactionWithRawData<EvmTransaction>[] = [];
    for (const rawTx of rawTransactions) {
      const mapResult = this.mapper.map(rawTx, {});

      if (mapResult.isErr()) {
        const errorMessage = mapResult.error.type === 'error' ? mapResult.error.message : mapResult.error.reason;
        this.logger.error(`Provider data validation failed - Address: ${maskAddress(address)}, Error: ${errorMessage}`);
        return err(new Error(`Provider data validation failed: ${errorMessage}`));
      }

      transactions.push({
        raw: rawTx,
        normalized: mapResult.value,
      });
    }

    this.logger.debug(
      `Successfully retrieved and normalized ${transactionType} - Address: ${maskAddress(address)}, Count: ${transactions.length}`
    );
    return ok(transactions);
  }
}
