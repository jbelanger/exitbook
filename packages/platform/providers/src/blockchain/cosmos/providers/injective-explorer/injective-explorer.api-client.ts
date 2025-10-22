import { getErrorMessage } from '@exitbook/core';
import { err, ok, type Result } from 'neverthrow';

import type { ProviderConfig, ProviderOperation } from '../../../../core/blockchain/index.ts';
import { BaseApiClient, RegisterApiClient } from '../../../../core/blockchain/index.ts';
import type { TransactionWithRawData } from '../../../../core/blockchain/types/index.ts';
import { maskAddress } from '../../../../core/blockchain/utils/address-utils.ts';
import type { CosmosChainConfig } from '../../chain-config.interface.js';
import { COSMOS_CHAINS } from '../../chain-registry.ts';
import type { CosmosTransaction } from '../../types.js';

import { InjectiveExplorerTransactionMapper } from './injective-explorer.mapper.ts';
import type { InjectiveApiResponse } from './injective-explorer.schemas.js';

@RegisterApiClient({
  baseUrl: 'https://sentry.exchange.grpc-web.injective.network',
  blockchain: 'injective',
  capabilities: {
    supportedOperations: ['getAddressTransactions'],
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

  constructor(config: ProviderConfig) {
    super(config);

    // Use provided chainConfig or default to Injective
    this.chainConfig = COSMOS_CHAINS['injective'] as CosmosChainConfig;
    this.mapper = new InjectiveExplorerTransactionMapper();

    this.logger.debug(
      `Initialized InjectiveExplorerApiClient for chain: ${this.chainConfig.chainName} - BaseUrl: ${this.baseUrl}`
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
        this.logger.debug(`Skipping transaction - Address: ${maskAddress(address)}, Reason: ${errorMessage}`);
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

  private validateAddress(address: string): boolean {
    // Use bech32Prefix from chainConfig for validation
    const addressRegex = new RegExp(`^${this.chainConfig.bech32Prefix}1[a-z0-9]{38}$`);
    return addressRegex.test(address);
  }
}
