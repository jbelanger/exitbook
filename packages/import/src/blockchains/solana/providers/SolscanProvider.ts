import type { Balance, BlockchainTransaction } from '@crypto/core';
import { createMoney, maskAddress } from '@crypto/shared-utils';
import { Decimal } from 'decimal.js';

import { BaseRegistryProvider } from '../../shared/registry/base-registry-provider.ts';
import { RegisterProvider } from '../../shared/registry/decorators.ts';
import type { ProviderOperation } from '../../shared/types.ts';
import type { SolscanResponse, SolscanTransaction } from '../types.ts';
import { isValidSolanaAddress, lamportsToSol } from '../utils.ts';

@RegisterProvider({
  apiKeyEnvVar: 'SOLSCAN_API_KEY',
  blockchain: 'solana',
  capabilities: {
    maxBatchSize: 1,
    supportedOperations: ['getAddressTransactions', 'getAddressBalance'],
    supportsHistoricalData: true,
    supportsPagination: true,
    supportsRealTimeData: true,
    supportsTokenData: true,
  },
  defaultConfig: {
    rateLimit: {
      burstLimit: 1,
      requestsPerSecond: 0.2, // Conservative: 1 request per 5 seconds
    },
    retries: 3,
    timeout: 15000,
  },
  description: 'Solana blockchain explorer API with transaction and account data access',
  displayName: 'Solscan API',
  name: 'solscan',
  networks: {
    devnet: {
      baseUrl: 'https://api.solscan.io',
    },
    mainnet: {
      baseUrl: 'https://public-api.solscan.io',
    },
    testnet: {
      baseUrl: 'https://api.solscan.io',
    },
  },
  requiresApiKey: false,
  type: 'rest',
})
export class SolscanProvider extends BaseRegistryProvider {
  constructor() {
    super('solana', 'solscan', 'mainnet');

    // Override HTTP client to add browser-like headers for Solscan
    this.reinitializeHttpClient({
      defaultHeaders: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept-Language': 'en-US,en;q=0.9',
        Connection: 'keep-alive',
        'Content-Type': 'application/json',
        DNT: '1',
        'Upgrade-Insecure-Requests': '1',
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        ...(this.apiKey &&
          this.apiKey !== 'YourApiKeyToken' && {
            Authorization: `Bearer ${this.apiKey}`,
          }),
      },
    });
  }

  private async getAddressBalance(params: { address: string }): Promise<Balance> {
    const { address } = params;

    if (!isValidSolanaAddress(address)) {
      throw new Error(`Invalid Solana address: ${address}`);
    }

    this.logger.debug(`Fetching address balance - Address: ${maskAddress(address)}, Network: ${this.network}`);

    try {
      const response = await this.httpClient.get<SolscanResponse<{ lamports: string }>>(`/account/${address}`);

      if (!response || !response.success || !response.data) {
        throw new Error('Failed to fetch balance from Solscan API');
      }

      const lamports = new Decimal(response.data.lamports || '0');
      const solBalance = lamportsToSol(lamports.toNumber());

      this.logger.debug(
        `Successfully retrieved address balance - Address: ${maskAddress(address)}, BalanceSOL: ${solBalance.toNumber()}, Network: ${this.network}`
      );

      return {
        balance: solBalance.toNumber(),
        currency: 'SOL',
        total: solBalance.toNumber(),
        used: 0,
      };
    } catch (error) {
      this.logger.error(
        `Failed to get address balance - Address: ${maskAddress(address)}, Network: ${this.network}, Error: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }

  private async getAddressTransactions(params: {
    address: string;
    since?: number | undefined;
  }): Promise<BlockchainTransaction[]> {
    const { address, since } = params;

    if (!isValidSolanaAddress(address)) {
      throw new Error(`Invalid Solana address: ${address}`);
    }

    this.logger.debug(
      `Fetching address transactions - Address: ${maskAddress(address)}, Since: ${since}, Network: ${this.network}`
    );

    try {
      const response = await this.httpClient.get<SolscanResponse<SolscanTransaction[]>>(
        `/account/transaction?address=${address}&limit=100&offset=0`
      );

      this.logger.debug(
        `Solscan API response received - HasResponse: ${!!response}, Success: ${response?.success}, HasData: ${!!response?.data}, TransactionCount: ${response?.data?.length || 0}`
      );

      if (!response || !response.success || !response.data) {
        this.logger.debug(`No transactions found or API error - Address: ${maskAddress(address)}`);
        return [];
      }

      const transactions: BlockchainTransaction[] = [];

      for (const tx of response.data) {
        try {
          const blockchainTx = this.transformTransaction(tx, address);
          if (blockchainTx && (!since || blockchainTx.timestamp >= since)) {
            transactions.push(blockchainTx);
          }
        } catch (error) {
          this.logger.warn(
            `Failed to transform transaction - TxHash: ${tx.txHash}, Error: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }

      // Sort by timestamp (newest first)
      transactions.sort((a, b) => b.timestamp - a.timestamp);

      this.logger.debug(
        `Successfully retrieved address transactions - Address: ${maskAddress(address)}, TotalTransactions: ${transactions.length}, Network: ${this.network}`
      );

      return transactions;
    } catch (error) {
      this.logger.error(
        `Failed to get address transactions - Address: ${maskAddress(address)}, Network: ${this.network}, Error: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }

  private transformTransaction(tx: SolscanTransaction, userAddress: string): BlockchainTransaction | null {
    try {
      // Check if user is involved in the transaction
      const isUserSigner = tx.signer.includes(userAddress);
      const userAccount = tx.inputAccount?.find(acc => acc.account === userAddress);

      if (!isUserSigner && !userAccount) {
        this.logger.debug(`Transaction not relevant to user address - TxHash: ${tx.txHash}`);
        return null;
      }

      // Calculate amount and determine direction
      let amount = new Decimal(0);
      let type: 'transfer_in' | 'transfer_out' = 'transfer_out';

      if (userAccount) {
        const balanceChange = userAccount.postBalance - userAccount.preBalance;
        amount = lamportsToSol(Math.abs(balanceChange));
        type = balanceChange > 0 ? 'transfer_in' : 'transfer_out';
      } else {
        // Fallback to lamport field if available
        amount = lamportsToSol(Math.abs(tx.lamport || 0));
        type = 'transfer_out';
      }

      // Calculate fee
      const fee = lamportsToSol(tx.fee);

      return {
        blockHash: '',
        blockNumber: tx.slot,
        confirmations: 1,
        fee: createMoney(fee.toNumber(), 'SOL'),
        from: tx.signer?.[0] || '',
        gasPrice: undefined,
        gasUsed: undefined,
        hash: tx.txHash,
        nonce: undefined,
        status: tx.status === 'Success' ? 'success' : 'failed',
        timestamp: tx.blockTime * 1000,
        to: '',
        tokenContract: undefined,
        tokenSymbol: 'SOL',
        type,
        value: createMoney(amount.toNumber(), 'SOL'),
      };
    } catch (error) {
      this.logger.warn(
        `Failed to transform transaction - TxHash: ${tx.txHash}, Error: ${error instanceof Error ? error.message : String(error)}`
      );
      return null;
    }
  }

  async execute<T>(operation: ProviderOperation<T>): Promise<T> {
    this.logger.debug(
      `Executing operation - Type: ${operation.type}, Address: ${'address' in operation ? maskAddress(operation.address as string) : 'N/A'}`
    );

    try {
      switch (operation.type) {
        case 'getAddressTransactions':
          return this.getAddressTransactions({
            address: operation.address,
            since: operation.since,
          }) as T;
        case 'getAddressBalance':
          return this.getAddressBalance({
            address: operation.address,
          }) as T;
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

  async isHealthy(): Promise<boolean> {
    try {
      const response = await this.httpClient.get<SolscanResponse>(
        '/account/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
      );
      return response && response.success !== false;
    } catch (error) {
      this.logger.warn(`Health check failed - Error: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      const response = await this.httpClient.get<SolscanResponse>(
        '/account/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
      );
      this.logger.debug(`Connection test successful - HasResponse: ${!!response}`);
      return response && response.success !== false;
    } catch (error) {
      this.logger.error(`Connection test failed - Error: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }
}
