import { getErrorMessage } from '@exitbook/core';
import { HttpClient } from '@exitbook/platform-http';
import { err, ok, type Result } from 'neverthrow';

import { BaseApiClient } from '../../../shared/blockchain/base/api-client.js';
import type { ProviderConfig, ProviderOperation, RawBalanceData } from '../../../shared/blockchain/index.js';
import { RegisterApiClient } from '../../../shared/blockchain/index.js';
import type { TransactionWithRawData } from '../../../shared/blockchain/types/index.js';
import { maskAddress } from '../../../shared/blockchain/utils/address-utils.js';
import { transformNearBalance } from '../balance-utils.js';
import type { NearTransaction } from '../types.js';
import { isValidNearAccountId } from '../utils.js';

import { mapFastNearExplorerTransaction } from './fastnear.mapper-utils.js';
import { mapFastNearAccountData } from './fastnear.mapper.js';
import {
  FastNearAccountFullResponseSchema,
  FastNearExplorerAccountResponseSchema,
  type FastNearAccountFullResponse,
  type FastNearExplorerAccountRequest,
  type FastNearExplorerAccountResponse,
} from './fastnear.schemas.js';

@RegisterApiClient({
  baseUrl: 'https://api.fastnear.com',
  blockchain: 'near',
  capabilities: {
    supportedOperations: ['getAddressBalances', 'getAddressTransactions'],
  },
  defaultConfig: {
    rateLimit: {
      burstLimit: 5,
      requestsPerHour: 1000,
      requestsPerMinute: 60,
      requestsPerSecond: 2,
    },
    retries: 3,
    timeout: 30000,
  },
  description:
    'FastNear API for NEAR account balances, fungible tokens, NFTs, staking information, and transaction history',
  displayName: 'FastNear',
  name: 'fastnear',
  requiresApiKey: false,
})
export class FastNearApiClient extends BaseApiClient {
  private readonly explorerHttpClient: HttpClient;

  constructor(config: ProviderConfig) {
    super(config);

    this.explorerHttpClient = new HttpClient({
      baseUrl: 'https://explorer.main.fastnear.com/v0',
      defaultHeaders: {
        'Content-Type': 'application/json',
      },
      providerName: `${this.name}-explorer`,
      rateLimit: config.rateLimit,
      retries: config.retries ?? 3,
      timeout: config.timeout ?? 30000,
    });
  }

  async execute<T>(operation: ProviderOperation, _config?: Record<string, unknown>): Promise<Result<T, Error>> {
    this.logger.debug(
      `Executing operation - Type: ${operation.type}, Address: ${'address' in operation ? maskAddress(operation.address) : 'N/A'}`
    );

    switch (operation.type) {
      case 'getAddressBalances':
        return (await this.getAddressBalances(operation.address)) as Result<T, Error>;
      case 'getAddressTransactions':
        return (await this.getAddressTransactions({
          address: operation.address,
          maxBlockHeight: _config?.maxBlockHeight as number | undefined,
        })) as Result<T, Error>;
      default:
        return err(new Error(`Unsupported operation: ${operation.type}`));
    }
  }

  getHealthCheckConfig() {
    return {
      endpoint: '/v1/account/near/full',
      method: 'GET' as const,
      validate: (response: unknown) => {
        // FastNear full account endpoint returns an object with account, ft, nft, staking fields
        return response !== null && response !== undefined && typeof response === 'object';
      },
    };
  }

  async getAddressBalances(address: string): Promise<Result<RawBalanceData, Error>> {
    if (!isValidNearAccountId(address)) {
      return err(new Error(`Invalid NEAR account ID: ${address}`));
    }

    this.logger.debug(`Fetching account balances - Address: ${maskAddress(address)}`);

    const result = await this.httpClient.get<FastNearAccountFullResponse>(`/v1/account/${address}/full`);

    if (result.isErr()) {
      this.logger.error(
        `Failed to get account balances - Address: ${maskAddress(address)}, Error: ${getErrorMessage(result.error)}`
      );
      return err(result.error);
    }

    const response = result.value;

    // Validate response with schema
    const parseResult = FastNearAccountFullResponseSchema.safeParse(response);
    if (!parseResult.success) {
      const validationErrors = parseResult.error.issues
        .slice(0, 5)
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ');
      const errorCount = parseResult.error.issues.length;
      this.logger.error(
        `Provider data validation failed - Address: ${maskAddress(address)}, Errors (showing first 5 of ${errorCount}): ${validationErrors}`
      );
      return err(new Error(`Provider data validation failed: ${validationErrors}`));
    }

    const accountData = parseResult.data;

    // Map to normalized structure to extract native balance
    const mapResult = mapFastNearAccountData(accountData);

    if (mapResult.isErr()) {
      const errorMessage = mapResult.error.type === 'error' ? mapResult.error.message : mapResult.error.reason;
      this.logger.error(`Failed to map account data - Address: ${maskAddress(address)}, Error: ${errorMessage}`);
      return err(new Error(`Failed to map account data: ${errorMessage}`));
    }

    const balances = mapResult.value;

    // Transform native balance to RawBalanceData format
    // If no native balance exists, return zero balance
    const nativeBalance = balances.nativeBalance
      ? transformNearBalance(balances.nativeBalance.rawAmount)
      : transformNearBalance('0');

    this.logger.debug(
      `Successfully retrieved account balances - Address: ${maskAddress(address)}, Native: ${nativeBalance.decimalAmount} NEAR`
    );

    return ok(nativeBalance);
  }

  private async getAddressTransactions(params: {
    address: string;
    maxBlockHeight?: number | undefined;
  }): Promise<Result<TransactionWithRawData<NearTransaction>[], Error>> {
    const { address, maxBlockHeight } = params;

    if (!isValidNearAccountId(address)) {
      return err(new Error(`Invalid NEAR account ID: ${address}`));
    }

    this.logger.debug(
      `Fetching address transactions - Address: ${maskAddress(address)}, MaxBlockHeight: ${maxBlockHeight ?? 'none'}`
    );

    const allTransactions: TransactionWithRawData<NearTransaction>[] = [];
    let currentMaxBlockHeight = maxBlockHeight;
    let pageCount = 0;
    const maxPages = 100;

    while (pageCount < maxPages) {
      const requestBody: FastNearExplorerAccountRequest = {
        account_id: address,
        max_block_height: currentMaxBlockHeight,
      };

      const result = await this.explorerHttpClient.post<FastNearExplorerAccountResponse>('/account', requestBody);

      if (result.isErr()) {
        if (pageCount === 0) {
          this.logger.error(
            `Failed to get address transactions - Address: ${maskAddress(address)}, Error: ${getErrorMessage(result.error)}`
          );
          return err(result.error);
        }
        this.logger.warn(
          `Failed to fetch page ${pageCount + 1} - Address: ${maskAddress(address)}, Error: ${getErrorMessage(result.error)}`
        );
        break;
      }

      const response = result.value;

      const parseResult = FastNearExplorerAccountResponseSchema.safeParse(response);
      if (!parseResult.success) {
        const validationErrors = parseResult.error.issues
          .slice(0, 5)
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('; ');
        const errorCount = parseResult.error.issues.length;
        this.logger.error(
          `Provider data validation failed on page ${pageCount + 1} - Address: ${maskAddress(address)}, Errors (showing first 5 of ${errorCount}): ${validationErrors}`
        );
        if (pageCount === 0) {
          return err(new Error(`Provider data validation failed: ${validationErrors}`));
        }
        break;
      }

      const validatedResponse = parseResult.data;

      if (!validatedResponse.transactions || validatedResponse.transactions.length === 0) {
        break;
      }

      for (let i = 0; i < validatedResponse.transactions.length; i++) {
        const rawTx = validatedResponse.transactions[i];
        const metadata = validatedResponse.account_txs[i];

        if (!rawTx || !metadata) {
          this.logger.warn(
            `Mismatched transaction and metadata arrays at index ${i} - Address: ${maskAddress(address)}`
          );
          continue;
        }

        const mapResult = mapFastNearExplorerTransaction(rawTx, metadata, { providerName: this.name });

        if (mapResult.isErr()) {
          const errorMessage = mapResult.error.type === 'error' ? mapResult.error.message : mapResult.error.reason;
          this.logger.error(
            `Provider data validation failed - Address: ${maskAddress(address)}, Error: ${errorMessage}`
          );
          return err(new Error(`Provider data validation failed: ${errorMessage}`));
        }

        allTransactions.push({
          normalized: mapResult.value,
          raw: rawTx,
        });
      }

      this.logger.debug(
        `Fetched page ${pageCount + 1} - Address: ${maskAddress(address)}, Transactions: ${validatedResponse.transactions.length}`
      );

      if (validatedResponse.account_txs.length < 200) {
        break;
      }

      const lastTx = validatedResponse.account_txs[validatedResponse.account_txs.length - 1];
      if (lastTx) {
        currentMaxBlockHeight = lastTx.tx_block_height - 1;
      }

      pageCount++;
    }

    if (pageCount >= maxPages) {
      this.logger.warn(`Reached maximum page limit (${maxPages}), stopping pagination`);
    }

    this.logger.debug(
      `Successfully retrieved and normalized transactions - Address: ${maskAddress(address)}, Count: ${allTransactions.length}`
    );

    return ok(allTransactions);
  }
}
