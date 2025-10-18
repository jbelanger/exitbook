import { getErrorMessage, type BlockchainBalanceSnapshot } from '@exitbook/core';
import { Decimal } from 'decimal.js';
import { err, ok, type Result } from 'neverthrow';

import { BaseApiClient } from '../../../core/blockchain/base/api-client.ts';
import type { ProviderConfig, ProviderOperation } from '../../../core/blockchain/index.ts';
import { RegisterApiClient } from '../../../core/blockchain/index.ts';
import type { TransactionWithRawData } from '../../../core/blockchain/types/index.ts';
import { maskAddress } from '../../../core/blockchain/utils/address-utils.ts';
import type { SolanaTransaction } from '../types.js';
import { isValidSolanaAddress } from '../utils.js';

import { SolscanTransactionMapper } from './solscan.mapper.ts';
import type { SolscanTransaction, SolscanResponse } from './solscan.types.js';

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
  private mapper: SolscanTransactionMapper;

  constructor(config: ProviderConfig) {
    super(config);
    this.mapper = new SolscanTransactionMapper();

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
      endpoint: '/account/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      validate: (response: unknown) => {
        const data = response as SolscanResponse;
        return data && data.success !== false;
      },
    };
  }

  private async getAddressBalances(params: { address: string }): Promise<Result<BlockchainBalanceSnapshot, Error>> {
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

    // Convert from lamports to SOL (1 SOL = 10^9 lamports)
    const lamports = response.data.lamports || '0';
    const balanceSOL = new Decimal(lamports).div(new Decimal(10).pow(9)).toString();

    this.logger.debug(
      `Successfully retrieved raw address balance - Address: ${maskAddress(address)}, SOL: ${balanceSOL}`
    );

    return ok({ total: balanceSOL });
  }

  private async getAddressTransactions(params: {
    address: string;
    since?: number | undefined;
  }): Promise<Result<TransactionWithRawData<SolanaTransaction>[], Error>> {
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

      rawTransactions = Array.isArray(legacyResponse.data) ? legacyResponse.data : [];
    }

    const filteredRawTransactions = since
      ? rawTransactions.filter((tx) => tx.blockTime.getTime() >= since)
      : rawTransactions;

    const transactions: TransactionWithRawData<SolanaTransaction>[] = [];
    for (const rawTx of filteredRawTransactions) {
      const mapResult = this.mapper.map(rawTx, { providerId: 'solscan', sourceAddress: address }, {});

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
