import type { Balance, BlockchainTransaction } from '@crypto/core';
import { AuthenticationError, ServiceError } from '@crypto/core';
import { createMoney, maskAddress, parseDecimal } from '@crypto/shared-utils';
import { Decimal } from 'decimal.js';

import { BaseRegistryProvider } from '../../shared/registry/base-registry-provider.ts';
import { RegisterProvider } from '../../shared/registry/decorators.ts';
import type { ProviderOperation } from '../../shared/types.ts';
import type {
  SnowtraceApiResponse,
  SnowtraceBalanceResponse,
  SnowtraceInternalTransaction,
  SnowtraceTokenTransfer,
  SnowtraceTransaction,
} from '../types.ts';
import { isValidAvalancheAddress } from '../utils.ts';

@RegisterProvider({
  apiKeyEnvVar: 'SNOWTRACE_API_KEY',
  blockchain: 'avalanche',
  capabilities: {
    maxBatchSize: 1,
    supportedOperations: ['getAddressTransactions', 'getAddressBalance', 'getTokenTransactions', 'getTokenBalances'],
    supportsHistoricalData: true,
    supportsPagination: true,
    supportsRealTimeData: true,
    supportsTokenData: true,
  },
  defaultConfig: {
    rateLimit: {
      burstLimit: 3,
      requestsPerHour: 100,
      requestsPerMinute: 30,
      requestsPerSecond: 1,
    },
    retries: 3,
    timeout: 10000,
  },
  description: 'Avalanche blockchain explorer API with comprehensive transaction and balance data',
  displayName: 'Snowtrace API',
  name: 'snowtrace',
  networks: {
    mainnet: {
      baseUrl: 'https://api.snowtrace.io/api',
    },
    testnet: {
      baseUrl: 'https://api-testnet.snowtrace.io/api',
    },
  },
  requiresApiKey: false,
  type: 'rest',
})
export class SnowtraceProvider extends BaseRegistryProvider {
  constructor() {
    super('avalanche', 'snowtrace', 'mainnet');

    this.logger.debug(
      `Initialized SnowtraceProvider from registry metadata - Network: ${this.network}, BaseUrl: ${this.baseUrl}, HasApiKey: ${this.apiKey !== 'YourApiKeyToken'}`
    );
  }

  private convertInternalTransaction(tx: SnowtraceInternalTransaction, userAddress: string): BlockchainTransaction {
    const isFromUser = tx.from.toLowerCase() === userAddress.toLowerCase();
    const isToUser = tx.to.toLowerCase() === userAddress.toLowerCase();

    let type: 'internal_transfer_in' | 'internal_transfer_out';
    if (isFromUser && isToUser) {
      type = 'internal_transfer_in';
    } else if (isFromUser) {
      type = 'internal_transfer_out';
    } else {
      type = 'internal_transfer_in';
    }

    const valueWei = new Decimal(tx.value);
    const valueAvax = valueWei.dividedBy(new Decimal(10).pow(18));

    return {
      blockHash: '',
      blockNumber: parseInt(tx.blockNumber),
      fee: createMoney(0, 'AVAX'),
      from: tx.from,
      gasPrice: 0,
      gasUsed: parseInt(tx.gasUsed),
      hash: tx.hash,
      status: tx.isError === '0' ? 'success' : 'failed',
      timestamp: parseInt(tx.timeStamp) * 1000,
      to: tx.to,
      type,
      value: createMoney(valueAvax.toNumber(), 'AVAX'),
    };
  }

  private convertNormalTransaction(tx: SnowtraceTransaction, userAddress: string): BlockchainTransaction {
    const isFromUser = tx.from.toLowerCase() === userAddress.toLowerCase();
    const isToUser = tx.to.toLowerCase() === userAddress.toLowerCase();

    // Determine transaction type
    let type: 'transfer_in' | 'transfer_out';
    if (isFromUser && isToUser) {
      type = 'transfer_in'; // Self-transfer, treat as incoming
    } else if (isFromUser) {
      type = 'transfer_out';
    } else {
      type = 'transfer_in';
    }

    // Convert value from wei to AVAX
    const valueWei = new Decimal(tx.value);
    const valueAvax = valueWei.dividedBy(new Decimal(10).pow(18));

    // Calculate fee
    const gasUsed = new Decimal(tx.gasUsed);
    const gasPrice = new Decimal(tx.gasPrice);
    const feeWei = gasUsed.mul(gasPrice);
    const feeAvax = feeWei.dividedBy(new Decimal(10).pow(18));

    return {
      blockHash: tx.blockHash,
      blockNumber: parseInt(tx.blockNumber),
      confirmations: parseInt(tx.confirmations),
      fee: createMoney(feeAvax.toNumber(), 'AVAX'),
      from: tx.from,
      gasPrice: parseDecimal(tx.gasPrice).toNumber(),
      gasUsed: parseInt(tx.gasUsed),
      hash: tx.hash,
      status: tx.txreceipt_status === '1' ? 'success' : 'failed',
      timestamp: parseInt(tx.timeStamp) * 1000,
      to: tx.to,
      type,
      value: createMoney(valueAvax.toNumber(), 'AVAX'),
    };
  }

  private convertTokenTransfer(tx: SnowtraceTokenTransfer, userAddress: string): BlockchainTransaction {
    const isFromUser = tx.from.toLowerCase() === userAddress.toLowerCase();
    const isToUser = tx.to.toLowerCase() === userAddress.toLowerCase();

    let type: 'token_transfer_in' | 'token_transfer_out';
    if (isFromUser && isToUser) {
      type = 'token_transfer_in';
    } else if (isFromUser) {
      type = 'token_transfer_out';
    } else {
      type = 'token_transfer_in';
    }

    // Convert value using token decimals
    const decimals = parseInt(tx.tokenDecimal);
    const valueRaw = new Decimal(tx.value);
    const value = valueRaw.dividedBy(new Decimal(10).pow(decimals));

    return {
      blockHash: tx.blockHash,
      blockNumber: parseInt(tx.blockNumber),
      confirmations: parseInt(tx.confirmations),
      fee: createMoney(0, 'AVAX'),
      from: tx.from,
      gasPrice: parseDecimal(tx.gasPrice).toNumber(),
      gasUsed: parseInt(tx.gasUsed),
      hash: tx.hash,
      status: 'success',
      timestamp: parseInt(tx.timeStamp) * 1000,
      to: tx.to,
      tokenContract: tx.contractAddress,
      tokenSymbol: tx.tokenSymbol,
      type,
      value: createMoney(value.toNumber(), tx.tokenSymbol),
    };
  }

  private async getAddressBalance(params: { address: string }): Promise<Balance> {
    const { address } = params;

    if (!isValidAvalancheAddress(address)) {
      throw new Error(`Invalid Avalanche address: ${address}`);
    }

    this.logger.debug(`Fetching address balance - Address: ${maskAddress(address)}, Network: ${this.network}`);

    try {
      // Get AVAX balance
      const avaxBalance = await this.getAVAXBalance(address);

      this.logger.debug(`Retrieved balance for ${maskAddress(address)}: ${avaxBalance.balance} AVAX`);

      return avaxBalance;
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

    if (!isValidAvalancheAddress(address)) {
      throw new Error(`Invalid Avalanche address: ${address}`);
    }

    this.logger.debug(`Fetching address transactions - Address: ${maskAddress(address)}, Network: ${this.network}`);

    try {
      // Get normal transactions
      const normalTransactions = await this.getNormalTransactions(address, since);

      // Get internal transactions
      const internalTransactions = await this.getInternalTransactions(address, since);

      // Note: Token transfers are handled separately via getTokenTransactions
      const allTransactions = [...normalTransactions, ...internalTransactions];

      // Sort by timestamp (newest first)
      allTransactions.sort((a, b) => b.timestamp - a.timestamp);

      this.logger.debug(`Retrieved ${allTransactions.length} transactions for ${maskAddress(address)}`);

      return allTransactions;
    } catch (error) {
      this.logger.error(
        `Failed to get address transactions - Address: ${maskAddress(address)}, Network: ${this.network}, Error: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }

  private async getAVAXBalance(address: string): Promise<Balance> {
    const params = new URLSearchParams({
      action: 'balance',
      address: address,
      module: 'account',
      tag: 'latest',
    });

    if (this.apiKey && this.apiKey !== 'YourApiKeyToken') {
      params.append('apikey', this.apiKey);
    }

    const response = (await this.httpClient.get(`?${params.toString()}`)) as SnowtraceBalanceResponse;

    if (response.status !== '1') {
      throw new ServiceError(`Failed to fetch AVAX balance: ${response.message}`, this.name, 'getAVAXBalance');
    }

    // Convert from wei to AVAX
    const balanceWei = new Decimal(response.result);
    const balanceAvax = balanceWei.dividedBy(new Decimal(10).pow(18));

    return {
      balance: balanceAvax.toNumber(),
      currency: 'AVAX',
      total: balanceAvax.toNumber(),
      used: 0,
    };
  }

  private async getInternalTransactions(address: string, since?: number): Promise<BlockchainTransaction[]> {
    const params = new URLSearchParams({
      action: 'txlistinternal',
      address: address,
      endblock: '99999999',
      module: 'account',
      sort: 'asc',
      startblock: '0',
    });

    if (since) {
      params.set('startblock', Math.floor(since / 1000).toString());
    }

    if (this.apiKey && this.apiKey !== 'YourApiKeyToken') {
      params.append('apikey', this.apiKey);
    }

    try {
      const response = (await this.httpClient.get(
        `?${params.toString()}`
      )) as SnowtraceApiResponse<SnowtraceInternalTransaction>;

      if (response.status !== '1') {
        // Internal transactions might not be available for all addresses
        this.logger.debug(`No internal transactions found - Message: ${response.message}`);
        return [];
      }

      return response.result.map(tx => this.convertInternalTransaction(tx, address));
    } catch (error) {
      this.logger.warn(`Failed to fetch internal transactions`);
      return [];
    }
  }

  private async getNormalTransactions(address: string, since?: number): Promise<BlockchainTransaction[]> {
    const params = new URLSearchParams({
      action: 'txlist',
      address: address,
      endblock: '99999999',
      module: 'account',
      sort: 'asc',
      startblock: '0',
    });

    if (since) {
      // Convert timestamp to approximate block number (simplified)
      // In production, you'd want to use a more accurate method
      params.set('startblock', Math.floor(since / 1000).toString());
    }

    if (this.apiKey && this.apiKey !== 'YourApiKeyToken') {
      params.append('apikey', this.apiKey);
    }

    const response = (await this.httpClient.get(`?${params.toString()}`)) as SnowtraceApiResponse<SnowtraceTransaction>;

    if (response.status !== '1') {
      if (response.message === 'NOTOK' && response.message.includes('Invalid API Key')) {
        throw new AuthenticationError('Invalid Snowtrace API key', this.name, 'getNormalTransactions');
      }
      throw new ServiceError(`Snowtrace API error: ${response.message}`, this.name, 'getNormalTransactions');
    }

    return response.result.map(tx => this.convertNormalTransaction(tx, address));
  }

  private async getTokenBalances(params: {
    address: string;
    contractAddresses?: string[] | undefined;
  }): Promise<Balance[]> {
    const { address, contractAddresses } = params;
    return this.getTokenBalancesForAddress(address, contractAddresses);
  }

  private async getTokenBalancesForAddress(_address: string, _contractAddresses?: string[]): Promise<Balance[]> {
    // Snowtrace doesn't have a direct "get all token balances" endpoint like some other explorers
    // For now, return empty array - in production you might want to track known token contracts
    this.logger.debug('Token balance fetching not implemented for Snowtrace - use specific contract addresses');
    return [];
  }

  private async getTokenTransactions(params: {
    address: string;
    contractAddress?: string | undefined;
    limit?: number | undefined;
    since?: number | undefined;
    until?: number | undefined;
  }): Promise<BlockchainTransaction[]> {
    const { address, contractAddress, since } = params;
    return this.getTokenTransfers(address, since, contractAddress);
  }

  private async getTokenTransfers(
    address: string,
    since?: number,
    contractAddress?: string
  ): Promise<BlockchainTransaction[]> {
    const params = new URLSearchParams({
      action: 'tokentx',
      address: address,
      endblock: '99999999',
      module: 'account',
      sort: 'asc',
      startblock: '0',
    });

    if (since) {
      params.set('startblock', Math.floor(since / 1000).toString());
    }

    if (contractAddress) {
      params.append('contractaddress', contractAddress);
    }

    if (this.apiKey && this.apiKey !== 'YourApiKeyToken') {
      params.append('apikey', this.apiKey);
    }

    try {
      const response = (await this.httpClient.get(
        `?${params.toString()}`
      )) as SnowtraceApiResponse<SnowtraceTokenTransfer>;

      if (response.status !== '1') {
        this.logger.debug(`No token transfers found - Message: ${response.message}`);
        return [];
      }

      return response.result.map(tx => this.convertTokenTransfer(tx, address));
    } catch (error) {
      this.logger.warn(`Failed to fetch token transfers`);
      return [];
    }
  }

  async execute<T>(operation: ProviderOperation<T>): Promise<T> {
    this.logger.debug(
      `Executing operation - Type: ${operation.type}, Address: ${operation.type !== 'parseWalletTransaction' && operation.type !== 'testConnection' && 'address' in operation ? maskAddress(operation.address as string) : 'N/A'}`
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
        case 'getTokenTransactions':
          return this.getTokenTransactions({
            address: operation.address,
            contractAddress: operation.contractAddress,
            limit: operation.limit,
            since: operation.since,
            until: operation.until,
          }) as T;
        case 'getTokenBalances':
          return this.getTokenBalances({
            address: operation.address,
            contractAddresses: operation.contractAddresses,
          }) as T;
        default:
          throw new Error(`Unsupported operation: ${operation.type}`);
      }
    } catch (error) {
      this.logger.error(
        `Operation execution failed - Type: ${operation.type}, Params: ${JSON.stringify(operation)}, Error: ${error instanceof Error ? error.message : String(error)}, Stack: ${error instanceof Error ? error.stack : undefined}`
      );
      throw error;
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      // Test with a simple API call
      const params = new URLSearchParams({
        action: 'ethsupply',
        module: 'stats',
      });

      if (this.apiKey && this.apiKey !== 'YourApiKeyToken') {
        params.append('apikey', this.apiKey);
      }

      const response = await this.httpClient.get(`?${params.toString()}`);
      return !!(response && (response as SnowtraceApiResponse<unknown>).status === '1');
    } catch (error) {
      this.logger.warn(`Health check failed - Error: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      const result = await this.isHealthy();
      if (!result) {
        this.logger.warn(`Connection test failed - Provider unhealthy`);
      }
      return result;
    } catch (error) {
      this.logger.error(`Connection test failed - Error: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }
}
