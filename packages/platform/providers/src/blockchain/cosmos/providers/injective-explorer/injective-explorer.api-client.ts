import { getErrorMessage } from '@exitbook/core';
import { HttpClient } from '@exitbook/platform-http';
import { err, ok, type Result } from 'neverthrow';

import type { ProviderConfig, ProviderOperation } from '../../../../shared/blockchain/index.ts';
import { BaseApiClient, RegisterApiClient } from '../../../../shared/blockchain/index.ts';
import type { RawBalanceData, TransactionWithRawData } from '../../../../shared/blockchain/types/index.ts';
import { maskAddress } from '../../../../shared/blockchain/utils/address-utils.ts';
import { convertBalance, createZeroBalance, findNativeBalance } from '../../balance-utils.js';
import type { CosmosChainConfig } from '../../chain-config.interface.js';
import { COSMOS_CHAINS } from '../../chain-registry.ts';
import type { CosmosTransaction } from '../../types.js';

import { InjectiveExplorerTransactionMapper } from './injective-explorer.mapper.ts';
import type { InjectiveApiResponse, InjectiveBalanceResponse } from './injective-explorer.schemas.js';

@RegisterApiClient({
  baseUrl: 'https://sentry.exchange.grpc-web.injective.network',
  blockchain: 'injective',
  capabilities: {
    supportedOperations: ['getAddressTransactions', 'getAddressBalances'],
  },
  defaultConfig: {
    rateLimit: {
      burstLimit: 5,
      requestsPerHour: 500,
      requestsPerMinute: 60,
      requestsPerSecond: 2,
    },
    retries: 3,
    timeout: 15000,
  },
  description: 'Direct connection to Injective Protocol blockchain explorer with comprehensive transaction data',
  displayName: 'Injective Explorer API',
  name: 'injective-explorer',
  requiresApiKey: false,
  supportedChains: ['injective'],
})
export class InjectiveExplorerApiClient extends BaseApiClient {
  private chainConfig: CosmosChainConfig;
  private mapper: InjectiveExplorerTransactionMapper;
  private restClient: HttpClient;

  constructor(config: ProviderConfig) {
    super(config);

    // Use provided chainConfig or default to Injective
    this.chainConfig = COSMOS_CHAINS['injective'] as CosmosChainConfig;
    this.mapper = new InjectiveExplorerTransactionMapper();

    // Create separate HTTP client for REST API (Bank module queries)
    this.restClient = new HttpClient({
      baseUrl: this.chainConfig.restEndpoints?.[0] ?? '',
      providerName: `${this.metadata.name}-rest`,
      rateLimit: config.rateLimit,
      retries: config.retries,
      timeout: config.timeout,
    });

    this.logger.debug(
      `Initialized InjectiveExplorerApiClient for chain: ${this.chainConfig.chainName} - BaseUrl: ${this.baseUrl}, RestUrl: ${this.chainConfig.restEndpoints?.[0] ?? ''}`
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
      case 'getAddressBalances':
        return (await this.getAddressBalances({
          address: operation.address,
        })) as Result<T, Error>;
      default:
        return err(new Error(`Unsupported operation: ${operation.type}`));
    }
  }

  getHealthCheckConfig() {
    const testAddress = 'inj1qq6hgelyft8z5fnm6vyyn3ge3w2nway4ykdf6a';
    return {
      endpoint: `/api/explorer/v1/accountTxs/${testAddress}`,
      validate: (response: unknown) => {
        return Boolean(response && typeof response === 'object');
      },
    };
  }

  private async getAddressTransactions(params: {
    address: string;
  }): Promise<Result<TransactionWithRawData<CosmosTransaction>[], Error>> {
    const { address } = params;

    if (!this.validateAddress(address)) {
      return err(new Error(`Invalid ${this.chainConfig.displayName} address: ${address}`));
    }

    this.logger.debug(`Fetching raw address transactions - Address: ${maskAddress(address)}`);

    const endpoint = `/api/explorer/v1/accountTxs/${address}`;
    const result = await this.httpClient.get<InjectiveApiResponse>(endpoint);

    if (result.isErr()) {
      this.logger.error(
        `Failed to get raw address transactions - Address: ${maskAddress(address)}, Error: ${getErrorMessage(result.error)}`
      );
      return err(result.error);
    }

    const response = result.value;

    if (!response.data || !Array.isArray(response.data)) {
      this.logger.debug(`No raw transactions found for address - Address: ${maskAddress(address)}`);
      return ok([]);
    }

    const rawTransactions = response.data;

    if (!Array.isArray(rawTransactions) || rawTransactions.length === 0) {
      this.logger.debug(`No raw transactions found - Address: ${maskAddress(address)}`);
      return ok([]);
    }

    const transactions: TransactionWithRawData<CosmosTransaction>[] = [];
    for (const rawTx of rawTransactions) {
      const mapResult = this.mapper.map(rawTx, {
        address,
      });

      if (mapResult.isErr()) {
        const errorMessage = mapResult.error.type === 'error' ? mapResult.error.message : mapResult.error.reason;
        if (mapResult.error.type === 'error') {
          // Log validation errors at error level (matches other providers)
          this.logger.error(
            `Provider data validation failed - Address: ${maskAddress(address)}, Error: ${errorMessage}`
          );
        } else {
          // Log skipped transactions (non-errors) at debug level
          this.logger.debug(`Skipping transaction - Address: ${maskAddress(address)}, Reason: ${errorMessage}`);
        }
        continue;
      }

      transactions.push({
        raw: rawTx,
        normalized: mapResult.value,
      });
    }

    this.logger.debug(
      `Successfully retrieved and normalized transactions - Address: ${maskAddress(address)}, Count: ${transactions.length}`
    );

    return ok(transactions);
  }

  private async getAddressBalances(params: { address: string }): Promise<Result<RawBalanceData, Error>> {
    const { address } = params;

    if (!this.validateAddress(address)) {
      return err(new Error(`Invalid ${this.chainConfig.displayName} address: ${address}`));
    }

    this.logger.debug(`Fetching raw address balance - Address: ${maskAddress(address)}`);

    const endpoint = `/cosmos/bank/v1beta1/balances/${address}`;
    const result = await this.restClient.get<InjectiveBalanceResponse>(endpoint);

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

    const nativeBalance = findNativeBalance(response.balances, this.chainConfig.nativeCurrency);

    if (!nativeBalance) {
      this.logger.debug(
        `No native currency balance found for address - Address: ${maskAddress(address)}, Denoms found: ${response.balances.map((b) => b.denom).join(', ')}`
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
}
