import { getErrorMessage } from '@exitbook/core';
import { err, ok, type Result } from 'neverthrow';

import type {
  ProviderConfig,
  ProviderFactory,
  ProviderMetadata,
  JsonRpcResponse,
  RawBalanceData,
  OneShotOperation,
} from '../../../../core/index.js';
import { BaseApiClient, maskAddress } from '../../../../core/index.js';
import { transformSolBalance, transformTokenAccounts } from '../../balance-utils.js';
import { isValidSolanaAddress } from '../../utils.js';

import type { SolanaTokenAccountsResponse } from './solana-rpc.schemas.js';
import {
  SolanaRPCBalanceJsonRpcResponseSchema,
  SolanaRPCTokenAccountsJsonRpcResponseSchema,
} from './solana-rpc.schemas.js';

export const solanaRpcMetadata: ProviderMetadata = {
  baseUrl: 'https://api.mainnet-beta.solana.com',
  blockchain: 'solana',
  capabilities: {
    supportedOperations: ['getAddressBalances', 'getAddressTokenBalances'],
  },
  defaultConfig: {
    rateLimit: {
      burstLimit: 1,
      requestsPerMinute: 12, // Conservative for public RPC
      requestsPerSecond: 0.2, // Conservative for public RPC
    },
    retries: 3,
    timeout: 30000,
  },
  description: 'Direct connection to Solana mainnet RPC endpoints with basic transaction data',
  displayName: 'Solana RPC',
  name: 'solana-rpc',
  requiresApiKey: false,
};

export const solanaRpcFactory: ProviderFactory = {
  create: (config: ProviderConfig) => new SolanaRPCApiClient(config),
  metadata: solanaRpcMetadata,
};

export class SolanaRPCApiClient extends BaseApiClient {
  constructor(config: ProviderConfig) {
    super(config);
  }

  async execute<T>(operation: OneShotOperation): Promise<Result<T, Error>> {
    this.logger.debug(
      `Executing operation - Type: ${operation.type}, Address: ${'address' in operation ? maskAddress(operation.address) : 'N/A'}`
    );

    switch (operation.type) {
      case 'getAddressBalances':
        return (await this.getAddressBalances({
          address: operation.address,
        })) as Result<T, Error>;
      case 'getAddressTokenBalances':
        return (await this.getAddressTokenBalances({
          address: operation.address,
          contractAddresses: operation.contractAddresses,
        })) as Result<T, Error>;
      default:
        return err(new Error(`Unsupported operation: ${operation.type}`));
    }
  }

  getHealthCheckConfig() {
    return {
      body: {
        id: 1,
        jsonrpc: '2.0',
        method: 'getHealth',
      },
      endpoint: '/',
      method: 'POST' as const,
      validate: (response: unknown) => {
        const data = response as JsonRpcResponse<string>;
        return data && data.result === 'ok';
      },
    };
  }

  private async getAddressBalances(params: { address: string }): Promise<Result<RawBalanceData, Error>> {
    const { address } = params;

    if (!isValidSolanaAddress(address)) {
      return err(new Error(`Invalid Solana address: ${address}`));
    }

    this.logger.debug(`Fetching raw address balance - Address: ${maskAddress(address)}`);

    const result = await this.httpClient.post<JsonRpcResponse<{ value: number }>>(
      '/',
      {
        id: 1,
        jsonrpc: '2.0',
        method: 'getBalance',
        params: [address],
      },
      { schema: SolanaRPCBalanceJsonRpcResponseSchema }
    );

    if (result.isErr()) {
      this.logger.error(
        `Failed to get raw address balance - Address: ${maskAddress(address)}, Error: ${getErrorMessage(result.error)}`
      );
      return err(result.error);
    }

    const response = result.value;

    if (!response?.result || response.result.value === undefined) {
      return err(new Error('Failed to fetch balance from Solana RPC'));
    }

    const balanceData = transformSolBalance(response.result.value);

    this.logger.debug(
      `Successfully retrieved raw address balance - Address: ${maskAddress(address)}, SOL: ${balanceData.decimalAmount}`
    );

    return ok(balanceData);
  }

  private async getAddressTokenBalances(params: {
    address: string;
    contractAddresses?: string[] | undefined;
  }): Promise<Result<RawBalanceData[], Error>> {
    const { address } = params;

    if (!isValidSolanaAddress(address)) {
      return err(new Error(`Invalid Solana address: ${address}`));
    }

    this.logger.debug(`Fetching raw token balances - Address: ${maskAddress(address)}`);

    const result = await this.httpClient.post<JsonRpcResponse<SolanaTokenAccountsResponse>>(
      '/',
      {
        id: 1,
        jsonrpc: '2.0',
        method: 'getTokenAccountsByOwner',
        params: [
          address,
          {
            programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
          },
          {
            encoding: 'jsonParsed',
          },
        ],
      },
      { schema: SolanaRPCTokenAccountsJsonRpcResponseSchema }
    );

    if (result.isErr()) {
      this.logger.error(
        `Failed to get raw token balances - Address: ${maskAddress(address)}, Error: ${getErrorMessage(result.error)}`
      );
      return err(result.error);
    }

    const tokenAccountsResponse = result.value;

    if (!tokenAccountsResponse?.result) {
      this.logger.debug(`No raw token accounts found - Address: ${maskAddress(address)}`);
      return ok([]);
    }

    const balances = transformTokenAccounts(tokenAccountsResponse.result.value);

    this.logger.debug(
      `Successfully retrieved raw token balances - Address: ${maskAddress(address)}, TokenAccountCount: ${balances.length}`
    );

    return ok(balances);
  }
}
