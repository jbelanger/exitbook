import { Decimal } from 'decimal.js';

import type { Balance, BlockchainTransaction, ProviderOperation } from '@crypto/core';

import { createMoney } from '@crypto/shared-utils';
import { BaseRegistryProvider } from '../../shared/registry/base-registry-provider.ts';
import { RegisterProvider } from '../../shared/registry/decorators.ts';
import type { SolscanTransaction } from '../types.ts';
import { isValidSolanaAddress, lamportsToSol } from '../utils.ts';


@RegisterProvider({
  name: 'solscan',
  blockchain: 'solana',
  displayName: 'Solscan API',
  type: 'rest',
  requiresApiKey: false,
  apiKeyEnvVar: 'SOLSCAN_API_KEY',
  description: 'Solana blockchain explorer API with transaction and account data access',
  capabilities: {
    supportedOperations: ['getAddressTransactions', 'getAddressBalance'],
    maxBatchSize: 1,
    providesHistoricalData: true,
    supportsPagination: true,
    supportsRealTimeData: true,
    supportsTokenData: true
  },
  networks: {
    mainnet: {
      baseUrl: 'https://public-api.solscan.io'
    },
    testnet: {
      baseUrl: 'https://api.solscan.io'
    },
    devnet: {
      baseUrl: 'https://api.solscan.io'
    }
  },
  defaultConfig: {
    timeout: 15000,
    retries: 3,
    rateLimit: {
      requestsPerSecond: 0.2, // Conservative: 1 request per 5 seconds
      burstLimit: 1
    }
  }
})
export class SolscanProvider extends BaseRegistryProvider {

  constructor() {
    super('solana', 'solscan', 'mainnet');

    // Override HTTP client to add browser-like headers for Solscan
    this.reinitializeHttpClient({
      defaultHeaders: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        ...(this.apiKey && this.apiKey !== 'YourApiKeyToken' && { 'Authorization': `Bearer ${this.apiKey}` })
      }
    });
  }

  async isHealthy(): Promise<boolean> {
    try {
      const response = await this.httpClient.get('/account/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
      return response && response.success !== false;
    } catch (error) {
      this.logger.warn(`Health check failed - Error: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      const response = await this.httpClient.get('/account/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
      this.logger.debug(`Connection test successful - HasResponse: ${!!response}`);
      return response && response.success !== false;
    } catch (error) {
      this.logger.error(`Connection test failed - Error: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  async execute<T>(operation: ProviderOperation<T>, config?: any): Promise<T> {
    this.logger.debug(`Executing operation - Type: ${operation.type}, Address: ${operation.params?.address ? this.maskAddress(operation.params.address) : 'N/A'}`);

    try {
      switch (operation.type) {
        case 'getAddressTransactions':
          return this.getAddressTransactions(operation.params as { address: string; since?: number }) as T;
        case 'getAddressBalance':
          return this.getAddressBalance(operation.params as { address: string }) as T;
        default:
          throw new Error(`Unsupported operation: ${operation.type}`);
      }
    } catch (error) {
      this.logger.error(`Operation execution failed - Type: ${operation.type}, Params: ${JSON.stringify(operation.params)}, Error: ${error instanceof Error ? error.message : String(error)}, Stack: ${error instanceof Error ? error.stack : undefined}`);
      throw error;
    }
  }

  private async getAddressTransactions(params: { address: string; since?: number }): Promise<BlockchainTransaction[]> {
    const { address, since } = params;

    if (!isValidSolanaAddress(address)) {
      throw new Error(`Invalid Solana address: ${address}`);
    }

    this.logger.debug(`Fetching address transactions - Address: ${this.maskAddress(address)}, Since: ${since}, Network: ${this.network}`);

    try {
      const response = await this.httpClient.get(`/account/transaction?address=${address}&limit=100&offset=0`);

      this.logger.debug(`Solscan API response received - HasResponse: ${!!response}, Success: ${response?.success}, HasData: ${!!response?.data}, TransactionCount: ${response?.data?.length || 0}`);

      if (!response || !response.success || !response.data) {
        this.logger.debug(`No transactions found or API error - Address: ${this.maskAddress(address)}`);
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
          this.logger.warn(`Failed to transform transaction - TxHash: ${tx.txHash}, Error: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      // Sort by timestamp (newest first)
      transactions.sort((a, b) => b.timestamp - a.timestamp);

      this.logger.debug(`Successfully retrieved address transactions - Address: ${this.maskAddress(address)}, TotalTransactions: ${transactions.length}, Network: ${this.network}`);

      return transactions;

    } catch (error) {
      this.logger.error(`Failed to get address transactions - Address: ${this.maskAddress(address)}, Network: ${this.network}, Error: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  private async getAddressBalance(params: { address: string }): Promise<Balance> {
    const { address } = params;

    if (!isValidSolanaAddress(address)) {
      throw new Error(`Invalid Solana address: ${address}`);
    }

    this.logger.debug(`Fetching address balance - Address: ${this.maskAddress(address)}, Network: ${this.network}`);

    try {
      const response = await this.httpClient.get(`/account/${address}`);

      if (!response || !response.success || !response.data) {
        throw new Error('Failed to fetch balance from Solscan API');
      }

      const lamports = new Decimal(response.data.lamports || '0');
      const solBalance = lamportsToSol(lamports.toNumber());

      this.logger.debug(`Successfully retrieved address balance - Address: ${this.maskAddress(address)}, BalanceSOL: ${solBalance.toNumber()}, Network: ${this.network}`);

      return {
        currency: 'SOL',
        balance: solBalance.toNumber(),
        used: 0,
        total: solBalance.toNumber()
      };

    } catch (error) {
      this.logger.error(`Failed to get address balance - Address: ${this.maskAddress(address)}, Network: ${this.network}, Error: ${error instanceof Error ? error.message : String(error)}`);
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
        hash: tx.txHash,
        blockNumber: tx.slot,
        blockHash: '',
        timestamp: tx.blockTime * 1000,
        from: tx.signer?.[0] || '',
        to: '',
        value: createMoney(amount.toNumber(), 'SOL'),
        fee: createMoney(fee.toNumber(), 'SOL'),
        gasUsed: undefined,
        gasPrice: undefined,
        status: tx.status === 'Success' ? 'success' : 'failed',
        type,
        tokenContract: undefined,
        tokenSymbol: 'SOL',
        nonce: undefined,
        confirmations: 1
      };
    } catch (error) {
      this.logger.warn(`Failed to transform transaction - TxHash: ${tx.txHash}, Error: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  private maskAddress(address: string): string {
    if (address.length <= 8) return address;
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
  }
}