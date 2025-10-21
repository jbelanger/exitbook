import { getErrorMessage, parseDecimal, type BlockchainBalanceSnapshot } from '@exitbook/core';
import { err, ok, type Result } from 'neverthrow';

import type { ProviderConfig, ProviderOperation } from '../../../../core/blockchain/index.ts';
import { BaseApiClient, RegisterApiClient } from '../../../../core/blockchain/index.ts';
import type { TransactionWithRawData } from '../../../../core/blockchain/types/index.ts';
import { maskAddress } from '../../../../core/blockchain/utils/address-utils.ts';
import type { SubstrateChainConfig } from '../../chain-config.interface.ts';
import { getSubstrateChainConfig } from '../../chain-registry.ts';
import type { SubstrateTransaction } from '../../types.ts';
import { isValidSS58Address } from '../../utils.ts';

import { TaostatsTransactionMapper } from './taostats.mapper.ts';
import type {
  TaostatsBalanceResponse,
  TaostatsTransactionAugmented,
  TaostatsTransactionRaw,
} from './taostats.schemas.js';

@RegisterApiClient({
  apiKeyEnvVar: 'TAOSTATS_API_KEY',
  baseUrl: 'https://api.taostats.io/api',
  blockchain: 'bittensor',
  capabilities: {
    supportedOperations: ['getAddressTransactions', 'getAddressBalances'],
  },
  defaultConfig: {
    rateLimit: {
      burstLimit: 1,
      requestsPerHour: 300,
      requestsPerMinute: 5,
      requestsPerSecond: 0.08,
    },
    retries: 3,
    timeout: 15000,
  },
  description: 'Bittensor network provider with Taostats API integration',
  displayName: 'Taostats',
  name: 'taostats',
  requiresApiKey: true,
  supportedChains: ['bittensor'],
})
export class TaostatsApiClient extends BaseApiClient {
  private readonly chainConfig: SubstrateChainConfig;
  private mapper: TaostatsTransactionMapper;

  constructor(config: ProviderConfig) {
    super(config);

    // Get chain config
    const chainConfig = getSubstrateChainConfig(config.blockchain);
    if (!chainConfig) {
      throw new Error(`Unsupported blockchain for Taostats provider: ${config.blockchain}`);
    }
    this.chainConfig = chainConfig;

    // Taostats doesn't use "Bearer" prefix for authorization
    this.reinitializeHttpClient({
      defaultHeaders: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(this.apiKey && {
          Authorization: this.apiKey,
        }),
      },
    });

    // Initialize mapper
    this.mapper = new TaostatsTransactionMapper();

    this.logger.debug(
      `Initialized TaostatsApiClient for ${config.blockchain} - BaseUrl: ${this.baseUrl}, TokenSymbol: ${this.chainConfig.nativeCurrency}`
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
          since: operation.since,
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
    return {
      endpoint: '/account/latest/v1?network=finney&limit=1',
      validate: (response: unknown) => {
        return !!(response && typeof response === 'object' && 'data' in response);
      },
    };
  }

  private async getAddressBalances(params: { address: string }): Promise<Result<BlockchainBalanceSnapshot, Error>> {
    const { address } = params;

    // Validate address format
    if (!isValidSS58Address(address)) {
      return err(new Error(`Invalid SS58 address for ${this.blockchain}: ${address}`));
    }

    this.logger.debug(`Fetching raw address balance - Address: ${maskAddress(address)}`);

    const result = await this.httpClient.get<TaostatsBalanceResponse>(
      `/account/latest/v1?network=finney&address=${address}`
    );

    if (result.isErr()) {
      this.logger.error(
        `Failed to fetch raw address balance - Address: ${maskAddress(address)}, Error: ${getErrorMessage(result.error)}`
      );
      return err(result.error);
    }

    const response = result.value;
    const balanceRao = response.data?.[0]?.balance_total || '0';

    // Convert from smallest unit (rao) to main unit (TAO)
    const balanceDecimal = parseDecimal(balanceRao)
      .div(parseDecimal('10').pow(this.chainConfig.nativeDecimals))
      .toFixed();

    this.logger.debug(
      `Found raw balance for ${maskAddress(address)}: ${balanceDecimal} ${this.chainConfig.nativeCurrency}`
    );

    return ok({ total: balanceDecimal, asset: this.chainConfig.nativeCurrency });
  }

  private async getAddressTransactions(params: {
    address: string;
    since?: number | undefined;
  }): Promise<Result<TransactionWithRawData<SubstrateTransaction>[], Error>> {
    const { address, since } = params;

    // Validate address format
    if (!isValidSS58Address(address)) {
      return err(new Error(`Invalid SS58 address for ${this.blockchain}: ${address}`));
    }

    this.logger.debug(`Fetching raw address transactions - Address: ${maskAddress(address)}`);

    const augmentedTransactions: TaostatsTransactionAugmented[] = [];
    let offset = 0;
    const maxPages = 100; // Safety limit to prevent infinite loops
    const limit = 100;
    let hasMorePages = true;

    while (hasMorePages && Math.floor(offset / limit) < maxPages) {
      // Build query parameters
      const params = new URLSearchParams({
        network: 'finney',
        address: address,
        limit: limit.toString(),
        offset: offset.toString(),
      });

      if (since) {
        // Taostats expects ISO timestamp
        const sinceDate = new Date(since).toISOString();
        params.append('after', sinceDate);
      }

      const endpoint = `/transfer/v1?${params.toString()}`;
      const result = await this.httpClient.get<{ data?: TaostatsTransactionRaw[] }>(endpoint);

      if (result.isErr()) {
        this.logger.error(
          `Failed to fetch raw address transactions - Address: ${maskAddress(address)}, Error: ${getErrorMessage(result.error)}`
        );
        return err(result.error);
      }

      const response = result.value;
      const pageTransactions = response.data || [];

      // Augment transactions with chain config data
      const pageAugmentedTransactions = pageTransactions.map((tx) => ({
        ...tx,
        _nativeCurrency: this.chainConfig.nativeCurrency,
        _nativeDecimals: this.chainConfig.nativeDecimals,
        _chainDisplayName: this.chainConfig.displayName,
      })) as TaostatsTransactionAugmented[];

      augmentedTransactions.push(...pageAugmentedTransactions);
      offset += limit;

      // Check if there are more pages
      hasMorePages = pageTransactions.length === limit;

      this.logger.debug(
        `Fetched page ${Math.floor(offset / limit)}: ${pageTransactions.length} transactions${hasMorePages ? ' (more pages available)' : ' (last page)'}`
      );

      // Safety check to prevent infinite pagination
      if (Math.floor(offset / limit) >= maxPages) {
        this.logger.warn(`Reached maximum page limit (${maxPages}), stopping pagination`);
        break;
      }
    }

    // Normalize transactions using mapper
    const transactions: TransactionWithRawData<SubstrateTransaction>[] = [];
    for (const rawTx of augmentedTransactions) {
      const mapResult = this.mapper.map(rawTx, { address });

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
      `Successfully retrieved and normalized transactions - Address: ${maskAddress(address)}, Count: ${transactions.length}, PagesProcessed: ${Math.floor(offset / limit)}`
    );

    return ok(transactions);
  }
}
