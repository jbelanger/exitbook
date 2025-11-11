import { getErrorMessage } from '@exitbook/core';
import { err, ok, type Result } from 'neverthrow';

import type {
  ProviderConfig,
  ProviderOperation,
  RawBalanceData,
  TransactionWithRawData,
} from '../../../../core/index.ts';
import { RegisterApiClient, BaseApiClient, maskAddress } from '../../../../core/index.ts';
import { transformSolBalance } from '../../balance-utils.ts';
import type { SolanaTransaction } from '../../schemas.ts';
import { isValidSolanaAddress } from '../../utils.ts';

import { mapSolscanTransaction } from './solscan.mapper-utils.js';
import type { SolscanTransaction, SolscanResponse } from './solscan.schemas.js';
import {
  SolscanAccountBalanceResponseSchema,
  SolscanAccountTransactionsResponseSchema,
  SolscanLegacyTransactionsResponseSchema,
} from './solscan.schemas.js';

export interface SolscanRawBalanceData {
  lamports: string;
}

@RegisterApiClient({
  apiKeyEnvVar: 'SOLSCAN_API_KEY',
  baseUrl: 'https://pro-api.solscan.io/v2.0',
  blockchain: 'solana',
  capabilities: {
    supportedOperations: ['getAddressTransactions', 'getAddressBalances'],
  },
  defaultConfig: {
    rateLimit: {
      burstLimit: 1,
      requestsPerMinute: 60,
      requestsPerSecond: 1,
    },
    retries: 3,
    timeout: 15000,
  },
  description: 'Solana blockchain explorer API with transaction and account data access',
  displayName: 'Solscan API',
  name: 'solscan',
  requiresApiKey: true,
})
export class SolscanApiClient extends BaseApiClient {
  constructor(config: ProviderConfig) {
    super(config);

    // Override HTTP client to add browser-like headers for Solscan
    const defaultHeaders: Record<string, string> = {
      Accept: 'application/json',
      'Accept-Encoding': 'gzip, deflate, br',
      'Accept-Language': 'en-US,en;q=0.9',
      Connection: 'keep-alive',
      'Content-Type': 'application/json',
      DNT: '1',
      'Upgrade-Insecure-Requests': '1',
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    };

    if (this.apiKey && this.apiKey !== 'YourApiKeyToken') {
      // Solscan Pro expects the API key in the custom `token` header
      defaultHeaders.token = this.apiKey;
    }

    this.reinitializeHttpClient({
      defaultHeaders,
    });
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
    return {
      endpoint: '/account/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      validate: (response: unknown) => {
        const data = response as SolscanResponse;
        return data && data.success !== false;
      },
    };
  }

  private async getAddressBalances(params: { address: string }): Promise<Result<RawBalanceData, Error>> {
    const { address } = params;

    if (!isValidSolanaAddress(address)) {
      return err(new Error(`Invalid Solana address: ${address}`));
    }

    this.logger.debug(`Fetching raw address balance - Address: ${maskAddress(address)}`);

    const result = await this.httpClient.get<SolscanResponse<{ lamports: string }>>(`/account/${address}`, {
      schema: SolscanAccountBalanceResponseSchema,
    });

    if (result.isErr()) {
      this.logger.error(
        `Failed to get raw address balance - Address: ${maskAddress(address)}, Error: ${getErrorMessage(result.error)}`
      );
      return err(result.error);
    }

    const response = result.value;

    if (!response || !response.success || !response.data) {
      return err(new Error('Failed to fetch balance from Solscan API'));
    }

    const lamports = response.data.lamports || '0';
    const balanceData = transformSolBalance(lamports);

    this.logger.debug(
      `Successfully retrieved raw address balance - Address: ${maskAddress(address)}, SOL: ${balanceData.decimalAmount}`
    );

    return ok(balanceData);
  }

  private async getAddressTransactions(params: {
    address: string;
  }): Promise<Result<TransactionWithRawData<SolanaTransaction>[], Error>> {
    const { address } = params;

    if (!isValidSolanaAddress(address)) {
      return err(new Error(`Invalid Solana address: ${address}`));
    }

    this.logger.debug(`Fetching raw address transactions - Address: ${maskAddress(address)}`);

    const queryParams = new URLSearchParams({
      account: address,
      limit: '100',
      offset: '0',
    });

    const result = await this.httpClient.get<
      SolscanResponse<
        | SolscanTransaction[]
        | {
            data?: SolscanTransaction[];
            items?: SolscanTransaction[];
          }
      >
    >(`/account/transactions?${queryParams.toString()}`, { schema: SolscanAccountTransactionsResponseSchema });

    if (result.isErr()) {
      this.logger.error(
        `Failed to get raw address transactions - Address: ${maskAddress(address)}, Error: ${getErrorMessage(result.error)}`
      );
      return err(result.error);
    }

    const response = result.value;

    this.logger.debug(
      `Solscan API response received - HasResponse: ${!!response}, Success: ${response?.success}, HasData: ${!!response?.data}, TransactionCount: ${Array.isArray(response?.data) ? response.data.length : 0}`
    );

    if (!response || !response.success || !response.data) {
      this.logger.debug(`No raw transactions found or API error - Address: ${maskAddress(address)}`);
      return ok([]);
    }

    let rawTransactions: SolscanTransaction[] = [];

    const data = response.data;
    if (Array.isArray(data)) {
      rawTransactions = data;
    } else if (data && typeof data === 'object') {
      const maybeItems = (data as { items?: SolscanTransaction[] }).items;
      const maybeData = (data as { data?: SolscanTransaction[] }).data;

      if (Array.isArray(maybeItems)) {
        rawTransactions = maybeItems;
      } else if (Array.isArray(maybeData)) {
        rawTransactions = maybeData;
      }
    }

    if (rawTransactions.length === 0) {
      this.logger.warn(
        `Unexpected Solscan payload shape, attempting legacy endpoint - Address: ${maskAddress(address)}`
      );

      const legacyResult = await this.httpClient.get<SolscanResponse<SolscanTransaction[]>>(
        `/account/transaction?address=${address}&limit=100&offset=0`,
        { schema: SolscanLegacyTransactionsResponseSchema }
      );

      if (legacyResult.isErr()) {
        this.logger.debug(
          `Legacy Solscan endpoint failed - Address: ${maskAddress(address)}, Error: ${getErrorMessage(legacyResult.error)}`
        );
        return ok([]);
      }

      const legacyResponse = legacyResult.value;

      if (!legacyResponse || !legacyResponse.success || !legacyResponse.data) {
        this.logger.debug(
          `Legacy Solscan endpoint also returned no data - Address: ${maskAddress(address)}, Success: ${legacyResponse?.success}`
        );
        return ok([]);
      }

      rawTransactions = Array.isArray(legacyResponse.data) ? legacyResponse.data : [];
    }

    const filteredRawTransactions = rawTransactions;

    const transactions: TransactionWithRawData<SolanaTransaction>[] = [];
    for (const rawTx of filteredRawTransactions) {
      const mapResult = mapSolscanTransaction(rawTx, {});

      if (mapResult.isErr()) {
        const errorMessage = mapResult.error.type === 'error' ? mapResult.error.message : mapResult.error.reason;
        this.logger.error(`Provider data validation failed - Address: ${maskAddress(address)}, Error: ${errorMessage}`);
        return err(new Error(`Provider data validation failed: ${errorMessage}`));
      }

      transactions.push({
        normalized: mapResult.value,
        raw: rawTx,
      });
    }

    this.logger.debug(
      `Successfully retrieved and normalized transactions - Address: ${maskAddress(address)}, Count: ${transactions.length}`
    );

    return ok(transactions);
  }
}
