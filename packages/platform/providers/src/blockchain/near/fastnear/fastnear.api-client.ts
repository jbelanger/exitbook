import { getErrorMessage } from '@exitbook/core';
import { err, ok, type Result } from 'neverthrow';

import { BaseApiClient } from '../../../shared/blockchain/base/api-client.js';
import type { ProviderConfig, ProviderOperation, RawBalanceData } from '../../../shared/blockchain/index.js';
import { RegisterApiClient } from '../../../shared/blockchain/index.js';
import { maskAddress } from '../../../shared/blockchain/utils/address-utils.js';
import { transformNearBalance } from '../balance-utils.js';
import { isValidNearAccountId } from '../utils.js';

import { mapFastNearAccountData } from './fastnear.mapper.js';
import { FastNearAccountFullResponseSchema, type FastNearAccountFullResponse } from './fastnear.schemas.js';

@RegisterApiClient({
  baseUrl: 'https://api.fastnear.com',
  blockchain: 'near',
  capabilities: {
    supportedOperations: ['getAddressBalances'],
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
  description: 'FastNear API for NEAR account balances, fungible tokens, NFTs, and staking information',
  displayName: 'FastNear',
  name: 'fastnear',
  requiresApiKey: false,
})
export class FastNearApiClient extends BaseApiClient {
  constructor(config: ProviderConfig) {
    super(config);
  }

  async execute<T>(operation: ProviderOperation, _config?: Record<string, unknown>): Promise<Result<T, Error>> {
    this.logger.debug(
      `Executing operation - Type: ${operation.type}, Address: ${'address' in operation ? maskAddress(operation.address) : 'N/A'}`
    );

    switch (operation.type) {
      case 'getAddressBalances':
        return (await this.getAddressBalances(operation.address)) as Result<T, Error>;
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
}
