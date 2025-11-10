import { getErrorMessage } from '@exitbook/core';
import { err, ok, type Result } from 'neverthrow';

import { BaseApiClient } from '../../../shared/blockchain/base/api-client.js';
import type { ProviderConfig, TransactionWithRawData } from '../../../shared/blockchain/index.js';
import { RegisterApiClient } from '../../../shared/blockchain/index.js';
import type { ProviderOperation, RawBalanceData } from '../../../shared/blockchain/types/index.js';
import { maskAddress } from '../../../shared/blockchain/utils/address-utils.js';
import { calculateTatumBalance, createRawBalanceData } from '../balance-utils.js';
import type { BitcoinChainConfig } from '../chain-config.interface.js';
import { getBitcoinChainConfig } from '../chain-registry.js';
import { mapTatumLitecoinTransaction } from '../mapper-utils.js';
import type { BitcoinTransaction } from '../schemas.js';

import type { TatumLitecoinTransaction, TatumLitecoinBalance } from './tatum-litecoin.schemas.js';

@RegisterApiClient({
  apiKeyEnvVar: 'TATUM_API_KEY',
  baseUrl: 'https://api.tatum.io/v3/litecoin',
  blockchain: 'litecoin',
  capabilities: {
    supportedOperations: ['getAddressTransactions', 'getAddressBalances', 'hasAddressTransactions'],
  },
  defaultConfig: {
    rateLimit: {
      burstLimit: 50,
      requestsPerHour: 10800,
      requestsPerMinute: 180,
      requestsPerSecond: 3,
    },
    retries: 3,
    timeout: 15000,
  },
  description: 'Tatum API provider for Litecoin (values as strings in LTC)',
  displayName: 'Tatum Litecoin API',
  name: 'tatum',
  requiresApiKey: true,
  supportedChains: ['litecoin'],
})
export class TatumLitecoinApiClient extends BaseApiClient {
  private readonly chainConfig: BitcoinChainConfig;

  constructor(config: ProviderConfig) {
    super(config);

    const chainConfig = getBitcoinChainConfig(config.blockchain);
    if (!chainConfig) {
      throw new Error(`Unsupported blockchain: ${config.blockchain}`);
    }
    this.chainConfig = chainConfig;

    // Reinitialize HTTP client with Tatum-specific headers
    this.reinitializeHttpClient({
      baseUrl: 'https://api.tatum.io/v3/litecoin',
      defaultHeaders: {
        accept: 'application/json',
        'x-api-key': this.apiKey,
      },
    });

    this.logger.debug(
      `Initialized TatumLitecoinApiClient - BaseUrl: ${this.baseUrl}, HasApiKey: ${this.apiKey !== 'YourApiKeyToken'}`
    );
  }

  async execute<T>(operation: ProviderOperation, _config?: Record<string, unknown>): Promise<Result<T, Error>> {
    this.logger.debug(
      `Executing operation - Type: ${operation.type}, Address: ${'address' in operation ? maskAddress(operation.address) : 'N/A'}`
    );

    switch (operation.type) {
      case 'getAddressTransactions':
        return (await this.getAddressTransactions(operation.address)) as Result<T, Error>;
      case 'getAddressBalances':
        return (await this.getAddressBalances(operation.address)) as Result<T, Error>;
      case 'hasAddressTransactions':
        return (await this.hasAddressTransactions(operation.address)) as Result<T, Error>;
      default:
        return err(new Error(`Unsupported operation: ${operation.type}`));
    }
  }

  /**
   * Check if address has any transactions
   */
  async hasAddressTransactions(address: string): Promise<Result<boolean, Error>> {
    this.logger.debug(`Checking if address has transactions - Address: ${maskAddress(address)}`);

    const txResult = await this.makeRequest<TatumLitecoinTransaction[]>(`/transaction/address/${address}`, {
      offset: 0,
      pageSize: 1,
    });

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

  /**
   * Get lightweight address info for efficient gap scanning
   */
  async getAddressBalances(address: string): Promise<Result<RawBalanceData, Error>> {
    this.logger.debug(`Fetching lightweight address info - Address: ${maskAddress(address)}`);

    const balanceResult = await this.makeRequest<TatumLitecoinBalance>(`/address/balance/${address}`);

    if (balanceResult.isErr()) {
      this.logger.error(
        `Failed to get address balance - Address: ${maskAddress(address)}, Error: ${getErrorMessage(balanceResult.error)}`
      );
      return err(balanceResult.error);
    }

    const balanceData = balanceResult.value;
    const { balanceBTC, balanceSats } = calculateTatumBalance(balanceData.incoming, balanceData.outgoing);

    this.logger.debug(
      `Successfully retrieved lightweight address info - Address: ${maskAddress(address)}, BalanceLTC: ${balanceBTC}`
    );

    return ok(createRawBalanceData(balanceSats, balanceBTC, this.chainConfig.nativeCurrency));
  }

  /**
   * Get raw address transactions - no transformation, just raw Tatum API data
   */
  async getAddressTransactions(
    address: string,
    params?: {
      blockFrom?: number | undefined;
      blockTo?: number | undefined;
      offset?: number | undefined;
      pageSize?: number | undefined;
      txType?: 'incoming' | 'outgoing' | undefined;
    }
  ): Promise<Result<TransactionWithRawData<BitcoinTransaction>[], Error>> {
    this.logger.debug(`Fetching raw address transactions - Address: ${maskAddress(address)}`);

    const queryParams = {
      offset: params?.offset || 0,
      pageSize: Math.min(params?.pageSize || 50, 50),
      ...(params?.blockFrom && { blockFrom: params.blockFrom }),
      ...(params?.blockTo && { blockTo: params.blockTo }),
      ...(params?.txType && { txType: params.txType }),
    };

    const result = await this.makeRequest<TatumLitecoinTransaction[]>(`/transaction/address/${address}`, queryParams);

    if (result.isErr()) {
      this.logger.error(
        `Failed to get raw address transactions - Address: ${maskAddress(address)}, Error: ${getErrorMessage(result.error)}`
      );
      return err(result.error);
    }

    const rawTransactions = result.value;

    if (!Array.isArray(rawTransactions)) {
      this.logger.debug(`No transactions found - Address: ${maskAddress(address)}`);
      return ok([]);
    }

    // Normalize transactions immediately using mapper
    const transactions: TransactionWithRawData<BitcoinTransaction>[] = [];
    for (const rawTx of rawTransactions) {
      const mapResult = mapTatumLitecoinTransaction(rawTx, {}, this.chainConfig);

      if (mapResult.isErr()) {
        // Fail fast - provider returned invalid data
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
      `Retrieved and normalized transactions - Address: ${maskAddress(address)}, Count: ${transactions.length}`
    );

    return ok(transactions);
  }

  override getHealthCheckConfig() {
    return {
      endpoint: '/address/balance/ltc1qum2k5q3zqc8wl4etdwl52s08s6gwh5dj7s0hw5',
      validate: (response: unknown) => {
        return response !== null && response !== undefined;
      },
    };
  }

  /**
   * Make a request to the Tatum API with common error handling
   */
  private async makeRequest<T>(endpoint: string, params?: Record<string, unknown>): Promise<Result<T, Error>> {
    this.validateApiKey();

    // Build URL with query parameters
    let url = endpoint;
    if (params && Object.keys(params).length > 0) {
      const queryString = new URLSearchParams(
        Object.entries(params)
          .filter(([, value]) => value !== undefined && value !== null)
          .map(([key, value]) => [key, String(value)] as [string, string])
      ).toString();
      url = `${endpoint}?${queryString}`;
    }

    const result = await this.httpClient.get<T>(url);

    if (result.isErr()) {
      this.logger.error(
        `Tatum API request failed - Blockchain: ${this.blockchain}, Endpoint: ${endpoint}, Error: ${getErrorMessage(result.error)}`
      );
      return err(result.error);
    }

    return ok(result.value);
  }
}
