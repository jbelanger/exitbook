import { maskAddress } from '@exitbook/shared-utils';

import { BlockchainApiClient } from '../../shared/api/blockchain-api-client.ts';
import { RegisterApiClient } from '../../shared/registry/decorators.js';
import type { JsonRpcResponse, ProviderOperation } from '../../shared/types.js';
import type { SolanaSignature, SolanaTokenAccountsResponse } from '../types.js';
import { isValidSolanaAddress } from '../utils.js';

import type {
  SolanaRPCRawBalanceData,
  SolanaRPCRawTokenBalanceData,
  SolanaRPCTransaction,
} from './solana-rpc.types.ts';

@RegisterApiClient({
  blockchain: 'solana',
  capabilities: {
    supportedOperations: ['getRawAddressTransactions', 'getRawAddressBalance', 'getRawTokenBalances'],
  },
  defaultConfig: {
    rateLimit: {
      burstLimit: 2,
      requestsPerSecond: 1, // Conservative for public RPC
    },
    retries: 3,
    timeout: 30000,
  },
  description: 'Direct connection to Solana mainnet RPC endpoints with basic transaction data',
  displayName: 'Solana RPC',
  name: 'solana-rpc',
  networks: {
    devnet: {
      baseUrl: 'https://api.devnet.solana.com',
    },
    mainnet: {
      baseUrl: 'https://api.mainnet-beta.solana.com',
    },
    testnet: {
      baseUrl: 'https://api.testnet.solana.com',
    },
  },
  requiresApiKey: false,
})
export class SolanaRPCApiClient extends BlockchainApiClient {
  constructor() {
    super('solana', 'solana-rpc', 'mainnet');
  }

  async execute<T>(operation: ProviderOperation<T>): Promise<T> {
    this.logger.debug(
      `Executing operation - Type: ${operation.type}, Address: ${'address' in operation ? maskAddress(operation.address as string) : 'N/A'}`
    );

    try {
      switch (operation.type) {
        case 'getRawAddressTransactions':
          return (await this.getRawAddressTransactions({
            address: operation.address,
            since: operation.since,
          })) as T;
        case 'getRawAddressBalance':
          return (await this.getRawAddressBalance({
            address: operation.address,
          })) as T;
        case 'getRawTokenBalances':
          return (await this.getRawTokenBalances({
            address: operation.address,
            contractAddresses: operation.contractAddresses,
          })) as T;
        default:
          throw new Error(`Unsupported operation: ${operation.type}`);
      }
    } catch (error) {
      this.logger.error(
        `Operation execution failed - Type: ${operation.type}, Error: ${error instanceof Error ? error.message : String(error)}, Stack: ${error instanceof Error ? error.stack : undefined}`
      );
      throw error;
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

  private async getRawAddressBalance(params: { address: string }): Promise<SolanaRPCRawBalanceData> {
    const { address } = params;

    if (!isValidSolanaAddress(address)) {
      throw new Error(`Invalid Solana address: ${address}`);
    }

    this.logger.debug(`Fetching raw address balance - Address: ${maskAddress(address)}, Network: ${this.network}`);

    try {
      const response = await this.httpClient.post<JsonRpcResponse<{ value: number }>>('/', {
        id: 1,
        jsonrpc: '2.0',
        method: 'getBalance',
        params: [address],
      });

      if (!response?.result || response.result.value === undefined) {
        throw new Error('Failed to fetch balance from Solana RPC');
      }

      this.logger.debug(
        `Successfully retrieved raw address balance - Address: ${maskAddress(address)}, Lamports: ${response.result.value}, Network: ${this.network}`
      );

      return { lamports: response.result.value };
    } catch (error) {
      this.logger.error(
        `Failed to get raw address balance - Address: ${maskAddress(address)}, Network: ${this.network}, Error: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }

  private async getRawAddressTransactions(params: {
    address: string;
    since?: number | undefined;
  }): Promise<SolanaRPCTransaction[]> {
    const { address, since } = params;

    if (!isValidSolanaAddress(address)) {
      throw new Error(`Invalid Solana address: ${address}`);
    }

    this.logger.debug(`Fetching raw address transactions - Address: ${maskAddress(address)}, Network: ${this.network}`);

    try {
      // Get signatures for address
      const signaturesResponse = await this.httpClient.post<JsonRpcResponse<SolanaSignature[]>>('/', {
        id: 1,
        jsonrpc: '2.0',
        method: 'getSignaturesForAddress',
        params: [
          address,
          {
            limit: 50, // Conservative limit for public RPC
          },
        ],
      });

      if (!signaturesResponse?.result) {
        this.logger.debug(`No signatures found - Address: ${maskAddress(address)}`);
        return [];
      }

      const transactions: SolanaRPCTransaction[] = [];
      const signatures = signaturesResponse.result.slice(0, 25); // Limit for performance

      this.logger.debug(`Retrieved signatures - Address: ${maskAddress(address)}, Count: ${signatures.length}`);

      // Fetch transaction details
      for (const sig of signatures) {
        try {
          const txResponse = await this.httpClient.post<JsonRpcResponse<SolanaRPCTransaction>>('/', {
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

          if (txResponse?.result && (!since || (txResponse.result.blockTime && txResponse.result.blockTime >= since))) {
            transactions.push(txResponse.result);
          }
        } catch (error) {
          this.logger.debug(
            `Failed to fetch transaction details - Signature: ${sig.signature}, Error: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }

      // Sort by timestamp (newest first)
      transactions.sort((a, b) => (b.blockTime || 0) - (a.blockTime || 0));

      this.logger.debug(
        `Successfully retrieved raw address transactions - Address: ${maskAddress(address)}, TotalTransactions: ${transactions.length}, Network: ${this.network}`
      );

      return transactions;
    } catch (error) {
      this.logger.error(
        `Failed to get raw address transactions - Address: ${maskAddress(address)}, Network: ${this.network}, Error: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }

  private async getRawTokenBalances(params: {
    address: string;
    contractAddresses?: string[] | undefined;
  }): Promise<SolanaRPCRawTokenBalanceData> {
    const { address } = params;

    if (!isValidSolanaAddress(address)) {
      throw new Error(`Invalid Solana address: ${address}`);
    }

    this.logger.debug(`Fetching raw token balances - Address: ${maskAddress(address)}, Network: ${this.network}`);

    try {
      // Get all token accounts owned by the address
      const tokenAccountsResponse = await this.httpClient.post<JsonRpcResponse<SolanaTokenAccountsResponse>>('/', {
        id: 1,
        jsonrpc: '2.0',
        method: 'getTokenAccountsByOwner',
        params: [
          address,
          {
            programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', // SPL Token Program ID
          },
          {
            encoding: 'jsonParsed',
          },
        ],
      });

      if (!tokenAccountsResponse?.result) {
        this.logger.debug(`No raw token accounts found - Address: ${maskAddress(address)}`);
        return { tokenAccounts: { value: [] } };
      }

      this.logger.debug(
        `Successfully retrieved raw token balances - Address: ${maskAddress(address)}, TokenAccountCount: ${tokenAccountsResponse.result.value.length}, Network: ${this.network}`
      );

      return { tokenAccounts: tokenAccountsResponse.result };
    } catch (error) {
      this.logger.error(
        `Failed to get raw token balances - Address: ${maskAddress(address)}, Network: ${this.network}, Error: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }
}
