import { getErrorMessage } from '@exitbook/core';
import { err, ok, type Result } from 'neverthrow';

import { BaseApiClient } from '../../../core/blockchain/base/api-client.ts';
import type { ProviderConfig, ProviderOperation } from '../../../core/blockchain/index.ts';
import { RegisterApiClient } from '../../../core/blockchain/index.ts';
import { maskAddress } from '../../../core/blockchain/utils/address-utils.ts';
import { isValidSolanaAddress } from '../utils.js';

import type { SolscanTransaction, SolscanResponse } from './solscan.types.js';

export interface SolscanRawBalanceData {
  lamports: string;
}

@RegisterApiClient({
  apiKeyEnvVar: 'SOLSCAN_API_KEY',
  baseUrl: 'https://pro-api.solscan.io/v2.0',
  blockchain: 'solana',
  capabilities: {
    supportedOperations: ['getRawAddressTransactions', 'getRawAddressBalance'],
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
      `Executing operation - Type: ${operation.type}, Address: ${'address' in operation ? maskAddress(operation.address as string) : 'N/A'}`
    );

    switch (operation.type) {
      case 'getRawAddressTransactions':
        return (await this.getRawAddressTransactions({
          address: operation.address,
          since: operation.since,
        })) as Result<T, Error>;
      case 'getRawAddressBalance':
        return (await this.getRawAddressBalance({
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

  private async getRawAddressBalance(params: { address: string }): Promise<Result<SolscanRawBalanceData, Error>> {
    const { address } = params;

    if (!isValidSolanaAddress(address)) {
      return err(new Error(`Invalid Solana address: ${address}`));
    }

    this.logger.debug(`Fetching raw address balance - Address: ${maskAddress(address)}`);

    const result = await this.httpClient.get<SolscanResponse<{ lamports: string }>>(`/account/${address}`);

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

    this.logger.debug(
      `Successfully retrieved raw address balance - Address: ${maskAddress(address)}, Lamports: ${response.data.lamports}`
    );

    return ok({ lamports: response.data.lamports || '0' });
  }

  private async getRawAddressTransactions(params: {
    address: string;
    since?: number | undefined;
  }): Promise<Result<SolscanTransaction[], Error>> {
    const { address, since } = params;

    if (!isValidSolanaAddress(address)) {
      return err(new Error(`Invalid Solana address: ${address}`));
    }

    this.logger.debug(`Fetching raw address transactions - Address: ${maskAddress(address)}, Since: ${since}`);

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
    >(`/account/transactions?${queryParams.toString()}`);

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

    let transactions: SolscanTransaction[] = [];

    const data = response.data;
    if (Array.isArray(data)) {
      transactions = data;
    } else if (data && typeof data === 'object') {
      const maybeItems = (data as { items?: SolscanTransaction[] }).items;
      const maybeData = (data as { data?: SolscanTransaction[] }).data;

      if (Array.isArray(maybeItems)) {
        transactions = maybeItems;
      } else if (Array.isArray(maybeData)) {
        transactions = maybeData;
      }
    }

    if (transactions.length === 0) {
      this.logger.warn(
        `Unexpected Solscan payload shape, attempting legacy endpoint - Address: ${maskAddress(address)}`
      );

      const legacyResult = await this.httpClient.get<SolscanResponse<SolscanTransaction[]>>(
        `/account/transaction?address=${address}&limit=100&offset=0`
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

      transactions = Array.isArray(legacyResponse.data) ? legacyResponse.data : [];
    }

    const filteredTransactions = since ? transactions.filter((tx) => tx.blockTime.getTime() >= since) : transactions;

    this.logger.debug(
      `Successfully retrieved raw address transactions - Address: ${maskAddress(address)}, TotalTransactions: ${filteredTransactions.length}`
    );

    return ok(filteredTransactions);
  }
}
