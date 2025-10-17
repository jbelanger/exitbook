import { getErrorMessage } from '@exitbook/core';
import { ServiceError } from '@exitbook/platform-http';
import { err, ok, type Result } from 'neverthrow';

import { BaseApiClient } from '../../../../core/blockchain/base/api-client.ts';
import type { ProviderConfig, ProviderOperation } from '../../../../core/blockchain/index.ts';
import { RegisterApiClient } from '../../../../core/blockchain/index.ts';
import type { TransactionWithRawData } from '../../../../core/blockchain/types/index.ts';
import { maskAddress } from '../../../../core/blockchain/utils/address-utils.ts';
import type { EvmTransaction } from '../../types.ts';

import { SnowtraceTransactionMapper } from './snowtrace.mapper.ts';
import type {
  SnowtraceApiResponse,
  SnowtraceInternalTransaction,
  SnowtraceTransaction,
  SnowtraceBalanceResponse,
  SnowtraceTokenTransfer,
} from './snowtrace.types.ts';

@RegisterApiClient({
  apiKeyEnvVar: 'SNOWTRACE_API_KEY',
  baseUrl: 'https://api.routescan.io/v2/network/mainnet/evm/43114/etherscan/api',
  blockchain: 'avalanche',
  capabilities: {
    supportedOperations: [
      'getRawAddressBalance',
      'getRawAddressInternalTransactions',
      'getRawAddressTransactions',
      'getRawTokenBalances',
      'getTokenTransactions',
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
  description: 'Avalanche blockchain explorer API with comprehensive transaction and balance data',
  displayName: 'Snowtrace API',
  name: 'snowtrace',
  requiresApiKey: false,
  supportedChains: ['avalanche'],
})
export class SnowtraceApiClient extends BaseApiClient {
  private mapper: SnowtraceTransactionMapper;

  constructor(config: ProviderConfig) {
    super(config);
    this.mapper = new SnowtraceTransactionMapper();
  }

  async execute<T>(operation: ProviderOperation): Promise<Result<T, Error>> {
    this.logger.debug(
      `Executing operation - Type: ${operation.type}, Address: ${'address' in operation ? maskAddress(operation.address as string) : 'N/A'}`
    );

    switch (operation.type) {
      case 'getRawAddressTransactions':
        return (await this.getRawAddressTransactions({
          address: operation.address,
          since: operation.since,
        })) as Result<T, Error>;
      case 'getRawAddressInternalTransactions':
        return (await this.getRawAddressInternalTransactions({
          address: operation.address,
          since: operation.since,
        })) as Result<T, Error>;
      case 'getRawAddressBalance':
        return (await this.getRawAddressBalance({
          address: operation.address,
        })) as Result<T, Error>;
      case 'getTokenTransactions':
        return (await this.getTokenTransactions({
          address: operation.address,
          contractAddress: operation.contractAddress,
          limit: operation.limit,
          since: operation.since,
          until: operation.until,
        })) as Result<T, Error>;
      case 'getRawTokenBalances':
        return (await this.getRawTokenBalances({
          address: operation.address,
          contractAddresses: operation.contractAddresses,
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
        const data = response as SnowtraceApiResponse<unknown>;
        return !!(data && data.status === '1');
      },
    };
  }

  private async getInternalTransactions(
    address: string,
    since?: number
  ): Promise<Result<SnowtraceInternalTransaction[], Error>> {
    const allTransactions: SnowtraceInternalTransaction[] = [];
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

      if (since) {
        params.set('startblock', Math.floor(since / 1000).toString());
      }

      if (this.apiKey && this.apiKey !== 'YourApiKeyToken') {
        params.append('apikey', this.apiKey);
      }

      const result = await this.httpClient.get(`?${params.toString()}`);

      if (result.isErr()) {
        this.logger.warn(
          `Failed to fetch internal transactions page ${page} - Error: ${getErrorMessage(result.error)}`
        );
        break;
      }

      const res = result.value as SnowtraceApiResponse<unknown>;
      if (res.status !== '1') {
        // If no results found or error, break the loop
        if (res.message === 'No transactions found') {
          break;
        }

        this.logger.debug(`No internal transactions found - Message: ${res.message}`);
        break;
      }

      const transactions = (res.result as SnowtraceInternalTransaction[]) || [];
      allTransactions.push(...transactions);

      // If we got less than the max offset, we've reached the end
      if (transactions.length < maxOffset) {
        break;
      }

      page++;
    }

    return ok(allTransactions);
  }

  private async getNormalTransactions(address: string, since?: number): Promise<Result<SnowtraceTransaction[], Error>> {
    const allTransactions: SnowtraceTransaction[] = [];
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

      if (since) {
        params.set('startblock', Math.floor(since / 1000).toString());
      }

      if (this.apiKey && this.apiKey !== 'YourApiKeyToken') {
        params.append('apikey', this.apiKey);
      }

      const result = await this.httpClient.get(`?${params.toString()}`);

      if (result.isErr()) {
        this.logger.error(`Failed to fetch normal transactions page ${page} - Error: ${getErrorMessage(result.error)}`);
        return err(result.error);
      }

      const res = result.value as SnowtraceApiResponse<unknown>;

      if (res.status !== '1') {
        if (res.message === 'NOTOK' && res.message.includes('Invalid API Key')) {
          return err(new ServiceError('Invalid Snowtrace API key', this.name, 'getNormalTransactions'));
        }
        // If no results found, break the loop
        if (res.message === 'No transactions found') {
          break;
        }
        return err(new ServiceError(`Snowtrace API error: ${res.message}`, this.name, 'getNormalTransactions'));
      }

      const transactions = (res.result as SnowtraceTransaction[]) || [];
      allTransactions.push(...transactions);

      // If we got less than the max offset, we've reached the end
      if (transactions.length < maxOffset) {
        break;
      }

      page++;
    }

    return ok(allTransactions);
  }

  private async getRawAddressBalance(params: { address: string }): Promise<Result<SnowtraceBalanceResponse, Error>> {
    const { address } = params;

    if (!this.isValidAvalancheAddress(address)) {
      return err(new Error(`Invalid Avalanche address: ${address}`));
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

    const res = result.value as SnowtraceApiResponse<unknown>;

    if (res.status !== '1') {
      return err(new ServiceError(`Failed to fetch AVAX balance: ${res.message}`, this.name, 'getRawAddressBalance'));
    }

    this.logger.debug(`Retrieved raw balance for ${maskAddress(address)}: ${String(res.result)} wei`);

    return ok({
      message: res.message,
      result: typeof res.result === 'string' ? res.result : String(res.result),
      status: res.status,
    } as SnowtraceBalanceResponse);
  }

  private async getRawAddressTransactions(params: {
    address: string;
    since?: number | undefined;
  }): Promise<Result<TransactionWithRawData<EvmTransaction>[], Error>> {
    const { address, since } = params;

    if (!this.isValidAvalancheAddress(address)) {
      return err(new Error(`Invalid Avalanche address: ${address}`));
    }

    this.logger.debug(`Fetching raw address transactions - Address: ${maskAddress(address)}`);

    const result = await this.getNormalTransactions(address, since);

    if (result.isErr()) {
      this.logger.error(
        `Failed to get raw address transactions - Address: ${maskAddress(address)}, Error: ${getErrorMessage(result.error)}`
      );
      return err(result.error);
    }

    return this.normalizeTransactions(result.value, address, 'transactions');
  }

  private async getRawAddressInternalTransactions(params: {
    address: string;
    since?: number | undefined;
  }): Promise<Result<TransactionWithRawData<EvmTransaction>[], Error>> {
    const { address, since } = params;

    if (!this.isValidAvalancheAddress(address)) {
      return err(new Error(`Invalid Avalanche address: ${address}`));
    }

    this.logger.debug(`Fetching raw address internal transactions - Address: ${maskAddress(address)}`);

    const result = await this.getInternalTransactions(address, since);

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

  private async getRawTokenBalances(_params: {
    address: string;
    contractAddresses?: string[] | undefined;
  }): Promise<Result<[], Error>> {
    // Snowtrace doesn't have a direct "get all token balances" endpoint
    this.logger.debug('Token balance fetching not implemented for Snowtrace - use specific contract addresses');
    return Promise.resolve(ok([]));
  }

  private async getTokenTransactions(params: {
    address: string;
    contractAddress?: string | undefined;
    limit?: number | undefined;
    since?: number | undefined;
    until?: number | undefined;
  }): Promise<Result<TransactionWithRawData<EvmTransaction>[], Error>> {
    const { address, contractAddress, since } = params;
    const result = await this.getTokenTransfers(address, since, contractAddress);

    if (result.isErr()) {
      return err(result.error);
    }

    return this.normalizeTransactions(result.value, address, 'token transactions');
  }

  private async getTokenTransfers(
    address: string,
    since?: number,
    contractAddress?: string
  ): Promise<Result<SnowtraceTokenTransfer[], Error>> {
    const allTransactions: SnowtraceTokenTransfer[] = [];
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

      if (since) {
        params.set('startblock', Math.floor(since / 1000).toString());
      }

      if (contractAddress) {
        params.append('contractaddress', contractAddress);
      }

      if (this.apiKey && this.apiKey !== 'YourApiKeyToken') {
        params.append('apikey', this.apiKey);
      }

      const result = await this.httpClient.get(`?${params.toString()}`);

      if (result.isErr()) {
        this.logger.warn(`Failed to fetch token transfers page ${page} - Error: ${getErrorMessage(result.error)}`);
        break;
      }

      const res = result.value as SnowtraceApiResponse<unknown>;

      if (res.status !== '1') {
        // If no results found or error, break the loop
        if (res.message === 'No transactions found') {
          break;
        }
        this.logger.debug(`No token transfers found - Message: ${res.message}`);
        break;
      }

      const transactions = (res.result as SnowtraceTokenTransfer[]) || [];
      allTransactions.push(...transactions);

      // If we got less than the max offset, we've reached the end
      if (transactions.length < maxOffset) {
        break;
      }

      page++;
    }

    return ok(allTransactions);
  }

  // Avalanche address validation
  private isValidAvalancheAddress(address: string): boolean {
    // Avalanche C-Chain uses Ethereum-style addresses but they are case-sensitive
    const ethAddressRegex = /^0x[a-fA-F0-9]{40}$/;
    return ethAddressRegex.test(address);
  }

  private normalizeTransactions(
    rawTransactions: (SnowtraceTransaction | SnowtraceInternalTransaction | SnowtraceTokenTransfer)[],
    address: string,
    transactionType: string
  ): Result<TransactionWithRawData<EvmTransaction>[], Error> {
    if (!Array.isArray(rawTransactions) || rawTransactions.length === 0) {
      this.logger.debug(`No raw ${transactionType} found - Address: ${maskAddress(address)}`);
      return ok([]);
    }

    const transactions: TransactionWithRawData<EvmTransaction>[] = [];
    for (const rawTx of rawTransactions) {
      const mapResult = this.mapper.map(
        rawTx as never,
        { providerId: 'snowtrace', sourceAddress: address },
        {} as never
      );

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
