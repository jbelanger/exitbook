import { Decimal } from 'decimal.js';

import type { Balance, BlockchainTransaction, ProviderOperation, SubstrateChainConfig } from '@crypto/core';
import { isValidSS58Address, SUBSTRATE_CHAINS } from '@crypto/core';
import { createMoney } from '@crypto/shared-utils';
import { BaseRegistryProvider } from '../../shared/registry/base-registry-provider.ts';
import { RegisterProvider } from '../../shared/registry/decorators.ts';
import type { SubstrateAccountInfo } from '../types.ts';

@RegisterProvider({
  name: 'subscan',
  blockchain: 'polkadot',
  displayName: 'Substrate Networks Provider',
  type: 'rest',
  requiresApiKey: false,
  description: 'Multi-chain Substrate provider supporting Polkadot, Kusama, and Bittensor networks with explorer APIs and RPC fallback',
  capabilities: {
    supportedOperations: ['getAddressTransactions', 'getAddressBalance'],
    maxBatchSize: 1,
    providesHistoricalData: true,
    supportsPagination: true,
    supportsRealTimeData: true,
    supportsTokenData: false // Substrate native tokens only for now
  },
  networks: {
    mainnet: {
      baseUrl: 'https://polkadot.api.subscan.io'
    },
    testnet: {
      baseUrl: 'https://westend.api.subscan.io'
    }
  },
  defaultConfig: {
    timeout: 10000,
    retries: 3,
    rateLimit: {
      requestsPerSecond: 1,
      requestsPerMinute: 30,
      requestsPerHour: 500,
      burstLimit: 3
    }
  }
})
export class SubstrateProvider extends BaseRegistryProvider {
  private readonly chainConfig: SubstrateChainConfig;
  private readonly rpcClient?: any; // TODO: Implement proper RPC client if needed

  constructor() {
    super('polkadot', 'subscan', 'mainnet'); // Subscan provider for Polkadot

    // Initialize chain config for Polkadot by default
    const chainConfig = SUBSTRATE_CHAINS['polkadot'];
    if (!chainConfig) {
      throw new Error('Substrate chain configuration not found');
    }

    this.chainConfig = chainConfig;

    this.logger.debug(`Initialized SubstrateProvider from registry metadata - Network: ${this.network}, BaseUrl: ${this.baseUrl}, DisplayName: ${chainConfig.displayName}, TokenSymbol: ${chainConfig.tokenSymbol}, Ss58Format: ${chainConfig.ss58Format}`);
  }

  /**
   * Set the specific substrate chain (polkadot, kusama, bittensor)
   */
  setChain(chain: string): void {
    const chainConfig = SUBSTRATE_CHAINS[chain];
    if (!chainConfig) {
      throw new Error(`Unsupported Substrate chain: ${chain}`);
    }

    // Update the chain config
    (this as any).chainConfig = chainConfig;

    // Update network and base URL based on chain
    const networkUrls: Record<string, string> = {
      polkadot: 'https://polkadot.api.subscan.io',
      kusama: 'https://kusama.api.subscan.io',
      bittensor: 'https://api.taostats.io'
    };

    const baseUrl = networkUrls[chain];
    if (baseUrl) {
      (this as any).network = chain;
      (this as any).baseUrl = baseUrl;

      // Reinitialize HTTP client with new base URL
      (this as any).httpClient = this.initializeHttpClient(baseUrl);
    }

    this.logger.debug(`Switched to ${chain} chain - DisplayName: ${chainConfig.displayName}, TokenSymbol: ${chainConfig.tokenSymbol}, BaseUrl: ${this.baseUrl}`);
  }

  /**
   * Initialize HTTP client with custom base URL
   */
  private initializeHttpClient(baseUrl: string): any {
    const { HttpClient } = require('../../utils/http-client');
    return new HttpClient({
      baseUrl,
      timeout: 10000,
      retries: 3,
      rateLimit: {
        requestsPerSecond: 1,
        requestsPerMinute: 30,
        requestsPerHour: 500,
        burstLimit: 3
      },
      providerName: this.name,
      defaultHeaders: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    });
  }

  async isHealthy(): Promise<boolean> {
    try {
      // Try explorer API first if available
      if (this.httpClient) {
        const response = await this.testExplorerApi();
        if (response) return true;
      }

      // Fallback to RPC if available
      if (this.rpcClient) {
        const response = await this.testRpcConnection();
        if (response) return true;
      }

      return false;
    } catch (error) {
      this.logger.warn(`Health check failed - Chain: ${this.network}, Error: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  async testConnection(): Promise<boolean> {
    return this.isHealthy();
  }

  async execute<T>(operation: ProviderOperation<T>): Promise<T> {
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
    if (!isValidSS58Address(address)) {
      throw new Error(`Invalid SS58 address for ${this.blockchain}: ${address}`);
    }

    try {
      this.logger.debug(`Fetching transactions for ${this.network} address: ${this.maskAddress(address)}`);

      // Try explorer API first
      if (this.httpClient) {
        try {
          const transactions = await this.getTransactionsFromExplorer(address, since);
          if (transactions.length > 0) {
            return transactions;
          }
        } catch (error) {
          this.logger.warn(`Explorer API failed, trying RPC fallback - Error: ${error}`);
        }
      }

      // Fallback to RPC if available
      if (this.rpcClient) {
        return await this.getTransactionsFromRPC(address, since);
      }

      this.logger.warn('No available data sources for transactions');
      return [];

    } catch (error) {
      this.logger.error(`Failed to fetch transactions for ${this.network} address - Address: ${this.maskAddress(address)}, Error: ${error}`);
      throw error;
    }
  }

  private async getAddressBalance(params: { address: string }): Promise<Balance[]> {
    const { address } = params;
    if (!isValidSS58Address(address)) {
      throw new Error(`Invalid SS58 address for ${this.blockchain}: ${address}`);
    }

    try {
      this.logger.debug(`Fetching balance for ${this.network} address: ${this.maskAddress(address)}`);

      // Try RPC first for most accurate balance
      if (this.rpcClient) {
        try {
          const balance = await this.getBalanceFromRPC(address);
          if (balance) {
            return [balance];
          }
        } catch (error) {
          this.logger.warn(`RPC balance query failed, trying explorer API - Error: ${error}`);
        }
      }

      // Fallback to explorer API
      if (this.httpClient) {
        const balance = await this.getBalanceFromExplorer(address);
        if (balance) {
          return [balance];
        }
      }

      this.logger.warn('No available data sources for balance');
      return [];

    } catch (error) {
      this.logger.error(`Failed to fetch balance for ${this.network} address - Address: ${this.maskAddress(address)}, Error: ${error}`);
      throw error;
    }
  }

  private async testExplorerApi(): Promise<boolean> {
    try {
      // Use Subscan's metadata endpoint for health check - it's available on all Subscan APIs
      const response = await this.httpClient.post('/api/scan/metadata', {});
      return response && response.code === 0;
    } catch (error) {
      this.logger.debug(`Explorer API health check failed - Chain: ${this.network}, Error: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  private async testRpcConnection(): Promise<boolean> {
    if (!this.rpcClient) return false;

    try {
      const response = await this.rpcClient.post('', {
        id: 1,
        jsonrpc: '2.0',
        method: 'system_properties',
        params: []
      });

      return response && response.result;
    } catch (error) {
      return false;
    }
  }

  private async getTransactionsFromExplorer(address: string, since?: number): Promise<BlockchainTransaction[]> {
    const transactions: BlockchainTransaction[] = [];

    if (this.network === 'bittensor') {
      // Taostats API implementation
      try {
        const response = await this.httpClient.get(`/api/account/${address}/transactions`);
        if (response && response.data) {
          for (const tx of response.data) {
            const blockchainTx = this.convertTaostatsTransaction(tx, address);
            if (blockchainTx && (!since || blockchainTx.timestamp >= since)) {
              transactions.push(blockchainTx);
            }
          }
        }
      } catch (error) {
        this.logger.debug(`Taostats API transaction fetch failed - Error: ${error}`);
      }
    } else if (this.network === 'polkadot' || this.network === 'kusama') {
      // Subscan API implementation
      try {
        this.logger.debug(`Calling Subscan API for ${this.network} transactions - Address: ${this.maskAddress(address)}`);

        const response = await this.httpClient.post('/api/v2/scan/transfers', {
          address: address,
          page: 0,
          row: 100
        });

        this.logger.debug(`Subscan API response received - HasResponse: ${!!response}, Code: ${response?.code}, HasData: ${!!response?.data}, TransferCount: ${response?.data?.transfers?.length || 0}`);

        if (response && response.code === 0 && response.data && response.data.transfers) {
          for (const transfer of response.data.transfers) {
            this.logger.debug(`Processing transfer - From: ${transfer.from}, To: ${transfer.to}, UserAddress: ${this.maskAddress(address)}, Amount: ${transfer.amount}`);

            const blockchainTx = this.convertSubscanTransaction(transfer, address);
            this.logger.debug(`Converted transaction result - HasTransaction: ${!!blockchainTx}, Since: ${since}, TxTimestamp: ${blockchainTx?.timestamp}`);

            if (blockchainTx && (!since || blockchainTx.timestamp >= since)) {
              transactions.push(blockchainTx);
            }
          }
        }
      } catch (error) {
        this.logger.warn(`Subscan API transaction fetch failed - Error: ${error instanceof Error ? error.message : String(error)}, Blockchain: ${this.network}`);
      }
    }

    this.logger.debug(`Found ${transactions.length} transactions via explorer API for ${this.network}`);
    return transactions;
  }

  private async getTransactionsFromRPC(address: string, since?: number): Promise<BlockchainTransaction[]> {
    // RPC-based transaction fetching is more complex and would require
    // iterating through blocks and filtering extrinsics
    // For now, return empty array as fallback
    this.logger.debug('RPC transaction fetching not implemented yet');
    return [];
  }

  private async getBalanceFromRPC(address: string): Promise<Balance | null> {
    if (!this.rpcClient) return null;

    try {
      const response = await this.rpcClient.post('', {
        id: 1,
        jsonrpc: '2.0',
        method: 'system_account',
        params: [address]
      });

      if (response && response.result) {
        const accountInfo = response.result as SubstrateAccountInfo;
        const freeBalance = new Decimal(accountInfo.data.free);
        const reservedBalance = new Decimal(accountInfo.data.reserved);
        const totalBalance = freeBalance.plus(reservedBalance);

        // Convert from smallest unit to main unit using chain decimals
        const divisor = new Decimal(10).pow(this.chainConfig.tokenDecimals);
        const balanceInMainUnit = totalBalance.dividedBy(divisor);
        const freeInMainUnit = freeBalance.dividedBy(divisor);
        const reservedInMainUnit = reservedBalance.dividedBy(divisor);

        return {
          currency: this.chainConfig.tokenSymbol,
          balance: freeInMainUnit.toNumber(),
          used: reservedInMainUnit.toNumber(),
          total: balanceInMainUnit.toNumber()
        };
      }

      return null;
    } catch (error) {
      this.logger.debug(`RPC balance query failed - Address: ${this.maskAddress(address)}, Error: ${error}`);
      return null;
    }
  }

  private async getBalanceFromExplorer(address: string): Promise<Balance | null> {
    try {
      if (this.network === 'bittensor') {
        // Taostats balance endpoint
        const response = await this.httpClient.get(`/api/account/${address}/balance`);
        if (response && response.balance !== undefined) {
          const balance = new Decimal(response.balance);
          return {
            currency: 'TAO',
            balance: balance.toNumber(),
            used: 0, // Taostats might not provide reserved balance
            total: balance.toNumber()
          };
        }
      } else {
        // Subscan balance endpoint
        const response = await this.httpClient.post('/api/scan/account', {
          key: address
        });

        if (response && response.code === 0 && response.data) {
          const freeBalance = new Decimal(response.data.balance || '0');
          const reservedBalance = new Decimal(response.data.reserved || '0');
          const totalBalance = freeBalance.plus(reservedBalance);

          const divisor = new Decimal(10).pow(this.chainConfig.tokenDecimals);
          const balanceInMainUnit = totalBalance.dividedBy(divisor);
          const freeInMainUnit = freeBalance.dividedBy(divisor);
          const reservedInMainUnit = reservedBalance.dividedBy(divisor);

          return {
            currency: this.chainConfig.tokenSymbol,
            balance: freeInMainUnit.toNumber(),
            used: reservedInMainUnit.toNumber(),
            total: balanceInMainUnit.toNumber()
          };
        }
      }

      return null;
    } catch (error) {
      this.logger.debug(`Explorer balance query failed - Address: ${this.maskAddress(address)}, Error: ${error}`);
      return null;
    }
  }

  private convertTaostatsTransaction(tx: any, userAddress: string): BlockchainTransaction | null {
    try {
      const isFromUser = tx.from === userAddress;
      const isToUser = tx.to === userAddress;

      if (!isFromUser && !isToUser) {
        return null; // Not relevant to this address
      }

      const amount = new Decimal(tx.amount || '0');
      const fee = new Decimal(tx.fee || '0');

      const type = isFromUser ? 'transfer_out' : 'transfer_in';

      return {
        hash: tx.hash,
        blockNumber: tx.block_number || 0,
        blockHash: tx.block_hash || '',
        timestamp: new Date(tx.timestamp).getTime(),
        from: tx.from,
        to: tx.to,
        value: createMoney(amount.toNumber(), 'TAO'),
        fee: createMoney(fee.toNumber(), 'TAO'),
        status: tx.success ? 'success' : 'failed',
        type,
        confirmations: tx.confirmations || 1
      };
    } catch (error) {
      this.logger.warn(`Failed to convert Taostats transaction - Tx: ${JSON.stringify(tx)}, Error: ${error}`);
      return null;
    }
  }

  private convertSubscanTransaction(transfer: any, userAddress: string): BlockchainTransaction | null {
    try {
      const isFromUser = transfer.from === userAddress;
      const isToUser = transfer.to === userAddress;

      this.logger.debug(`Checking transaction relevance - From: ${transfer.from}, To: ${transfer.to}, UserAddress: ${this.maskAddress(userAddress)}, IsFromUser: ${isFromUser}, IsToUser: ${isToUser}`);

      if (!isFromUser && !isToUser) {
        this.logger.debug('Transaction not relevant to user address');
        return null; // Not relevant to this address
      }

      const amount = new Decimal(transfer.amount || '0');
      const divisor = new Decimal(10).pow(this.chainConfig.tokenDecimals);
      const amountInMainUnit = amount.dividedBy(divisor);

      const fee = new Decimal(transfer.fee || '0');
      const feeInMainUnit = fee.dividedBy(divisor);

      const type = isFromUser ? 'transfer_out' : 'transfer_in';

      return {
        hash: transfer.hash,
        blockNumber: transfer.block_num || 0,
        blockHash: transfer.block_hash || '',
        timestamp: transfer.block_timestamp * 1000, // Convert to milliseconds
        from: transfer.from,
        to: transfer.to,
        value: createMoney(amountInMainUnit.toNumber(), this.chainConfig.tokenSymbol),
        fee: createMoney(feeInMainUnit.toNumber(), this.chainConfig.tokenSymbol),
        status: transfer.success ? 'success' : 'failed',
        type,
        confirmations: 1
      };
    } catch (error) {
      this.logger.warn(`Failed to convert Subscan transaction - Transfer: ${JSON.stringify(transfer)}, Error: ${error}`);
      return null;
    }
  }

  private maskAddress(address: string): string {
    if (!address || address.length <= 8) return address;
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
  }
}