import { getErrorMessage } from '@exitbook/core';
import { err, ok, type Result } from 'neverthrow';

import { BaseApiClient } from '../../../shared/blockchain/base/api-client.js';
import type { ProviderConfig, ProviderOperation } from '../../../shared/blockchain/index.js';
import { RegisterApiClient } from '../../../shared/blockchain/index.js';
import type { TransactionWithRawData } from '../../../shared/blockchain/types/index.js';
import { maskAddress } from '../../../shared/blockchain/utils/address-utils.js';
import type { NearTransaction } from '../types.js';
import { isValidNearAccountId } from '../utils.js';

import { mapNearDataTransaction } from './neardata.mapper.js';
import {
  NearDataAccountResponseSchema,
  type NearDataAccountRequest,
  type NearDataAccountResponse,
} from './neardata.schemas.js';

@RegisterApiClient({
  baseUrl: 'https://mainnet.neardata.xyz',
  blockchain: 'near',
  capabilities: {
    supportedOperations: ['getAddressTransactions'],
  },
  defaultConfig: {
    rateLimit: {
      burstLimit: 3,
      requestsPerHour: 500,
      requestsPerMinute: 30,
      requestsPerSecond: 1,
    },
    retries: 3,
    timeout: 30000,
  },
  description: 'NearData server for NEAR blockchain transaction history',
  displayName: 'NearData',
  name: 'neardata',
  requiresApiKey: false,
})
export class NearDataApiClient extends BaseApiClient {
  constructor(config: ProviderConfig) {
    super(config);
  }

  async execute<T>(operation: ProviderOperation, _config?: Record<string, unknown>): Promise<Result<T, Error>> {
    this.logger.debug(
      `Executing operation - Type: ${operation.type}, Address: ${'address' in operation ? maskAddress(operation.address) : 'N/A'}`
    );

    switch (operation.type) {
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
      body: {
        account_id: 'near',
        max_block_height: undefined,
      },
      endpoint: '/v0/account',
      method: 'POST' as const,
      validate: (response: unknown) => {
        return Array.isArray(response);
      },
    };
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
      `Fetching raw address transactions - Address: ${maskAddress(address)}, MaxBlockHeight: ${maxBlockHeight ?? 'none'}`
    );

    const requestBody: NearDataAccountRequest = {
      account_id: address,
      max_block_height: maxBlockHeight ?? undefined,
    };

    const result = await this.httpClient.post<NearDataAccountResponse>('/v0/account', requestBody);

    if (result.isErr()) {
      this.logger.error(
        `Failed to get raw address transactions - Address: ${maskAddress(address)}, Error: ${getErrorMessage(result.error)}`
      );
      return err(result.error);
    }

    const response = result.value;

    // Validate response with schema
    const parseResult = NearDataAccountResponseSchema.safeParse(response);
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

    const transactionsData = parseResult.data;

    this.logger.debug(
      `Total raw transactions fetched - Address: ${maskAddress(address)}, Count: ${transactionsData.length}`
    );

    // Map and normalize transactions
    const transactions: TransactionWithRawData<NearTransaction>[] = [];
    for (const rawTx of transactionsData) {
      const mapResult = mapNearDataTransaction(rawTx, { providerName: this.name });

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
