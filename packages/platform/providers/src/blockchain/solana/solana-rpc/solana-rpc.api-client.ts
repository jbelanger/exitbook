import { getErrorMessage } from '@exitbook/core';
import { err, ok, type Result } from 'neverthrow';

import { BaseApiClient } from '../../../core/blockchain/base/api-client.ts';
import type { JsonRpcResponse, ProviderConfig, ProviderOperation } from '../../../core/blockchain/index.ts';
import { RegisterApiClient } from '../../../core/blockchain/index.ts';
import type { TransactionWithRawData } from '../../../core/blockchain/types/index.ts';
import { maskAddress } from '../../../core/blockchain/utils/address-utils.ts';
import type { SolanaSignature, SolanaTokenAccountsResponse, SolanaTransaction } from '../types.js';
import { isValidSolanaAddress } from '../utils.js';

import { SolanaRPCTransactionMapper } from './solana-rpc.mapper.ts';
import type {
  SolanaRPCRawBalanceData,
  SolanaRPCRawTokenBalanceData,
  SolanaRPCTransaction,
} from './solana-rpc.types.ts';

@RegisterApiClient({
  baseUrl: 'https://api.mainnet-beta.solana.com',
  blockchain: 'solana',
  capabilities: {
    supportedOperations: ['getRawAddressTransactions', 'getRawAddressBalance', 'getRawTokenBalances'],
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
})
export class SolanaRPCApiClient extends BaseApiClient {
  private mapper: SolanaRPCTransactionMapper;

  constructor(config: ProviderConfig) {
    super(config);
    this.mapper = new SolanaRPCTransactionMapper();
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
      case 'getRawTokenBalances':
        return (await this.getRawTokenBalances({
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

  private async getRawAddressBalance(params: { address: string }): Promise<Result<SolanaRPCRawBalanceData, Error>> {
    const { address } = params;

    if (!isValidSolanaAddress(address)) {
      return err(new Error(`Invalid Solana address: ${address}`));
    }

    this.logger.debug(`Fetching raw address balance - Address: ${maskAddress(address)}`);

    const result = await this.httpClient.post<JsonRpcResponse<{ value: number }>>('/', {
      id: 1,
      jsonrpc: '2.0',
      method: 'getBalance',
      params: [address],
    });

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

    this.logger.debug(
      `Successfully retrieved raw address balance - Address: ${maskAddress(address)}, Lamports: ${response.result.value}`
    );

    return ok({ lamports: response.result.value });
  }

  private async getRawAddressTransactions(params: {
    address: string;
    since?: number | undefined;
  }): Promise<Result<TransactionWithRawData<SolanaTransaction>[], Error>> {
    const { address, since } = params;

    if (!isValidSolanaAddress(address)) {
      return err(new Error(`Invalid Solana address: ${address}`));
    }

    this.logger.debug(`Fetching raw address transactions - Address: ${maskAddress(address)}`);

    const signaturesResult = await this.httpClient.post<JsonRpcResponse<SolanaSignature[]>>('/', {
      id: 1,
      jsonrpc: '2.0',
      method: 'getSignaturesForAddress',
      params: [
        address,
        {
          limit: 50,
        },
      ],
    });

    if (signaturesResult.isErr()) {
      this.logger.error(
        `Failed to get raw address transactions - Address: ${maskAddress(address)}, Error: ${getErrorMessage(signaturesResult.error)}`
      );
      return err(signaturesResult.error);
    }

    const signaturesResponse = signaturesResult.value;

    if (!signaturesResponse?.result) {
      this.logger.debug(`No signatures found - Address: ${maskAddress(address)}`);
      return ok([]);
    }

    const rawTransactions: SolanaRPCTransaction[] = [];
    const signatures = signaturesResponse.result.slice(0, 25);

    this.logger.debug(`Retrieved signatures - Address: ${maskAddress(address)}, Count: ${signatures.length}`);

    for (const sig of signatures) {
      const txResult = await this.httpClient.post<JsonRpcResponse<SolanaRPCTransaction>>('/', {
        id: 1,
        jsonrpc: '2.0',
        method: 'getTransaction',
        params: [
          sig.signature,
          {
            encoding: 'json',
            maxSupportedTransactionVersion: 0,
          },
        ],
      });

      if (txResult.isErr()) {
        this.logger.debug(
          `Failed to fetch transaction details - Signature: ${sig.signature}, Error: ${getErrorMessage(txResult.error)}`
        );
        continue;
      }

      const txResponse = txResult.value;

      if (
        txResponse?.result &&
        (!since || (txResponse.result.blockTime && txResponse.result.blockTime.getTime() >= since))
      ) {
        rawTransactions.push(txResponse.result);
      }
    }

    rawTransactions.sort((a, b) => b.blockTime.getTime() - a.blockTime.getTime());

    const transactions: TransactionWithRawData<SolanaTransaction>[] = [];
    for (const rawTx of rawTransactions) {
      const mapResult = this.mapper.map(
        rawTx as never,
        { providerId: 'solana-rpc', sourceAddress: address },
        {} as never
      );

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

  private async getRawTokenBalances(params: {
    address: string;
    contractAddresses?: string[] | undefined;
  }): Promise<Result<SolanaRPCRawTokenBalanceData, Error>> {
    const { address } = params;

    if (!isValidSolanaAddress(address)) {
      return err(new Error(`Invalid Solana address: ${address}`));
    }

    this.logger.debug(`Fetching raw token balances - Address: ${maskAddress(address)}`);

    const result = await this.httpClient.post<JsonRpcResponse<SolanaTokenAccountsResponse>>('/', {
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
    });

    if (result.isErr()) {
      this.logger.error(
        `Failed to get raw token balances - Address: ${maskAddress(address)}, Error: ${getErrorMessage(result.error)}`
      );
      return err(result.error);
    }

    const tokenAccountsResponse = result.value;

    if (!tokenAccountsResponse?.result) {
      this.logger.debug(`No raw token accounts found - Address: ${maskAddress(address)}`);
      return ok({ tokenAccounts: { value: [] } });
    }

    this.logger.debug(
      `Successfully retrieved raw token balances - Address: ${maskAddress(address)}, TokenAccountCount: ${tokenAccountsResponse.result.value.length}`
    );

    return ok({ tokenAccounts: tokenAccountsResponse.result });
  }
}
