import type { Balance, BlockchainTransaction, RateLimitConfig } from '@crypto/core';
import { ServiceError } from '@crypto/core';
import { getLogger } from '@crypto/shared-logger';
import { HttpClient, createMoney } from '@crypto/shared-utils';
import { Decimal } from 'decimal.js';
import { IBlockchainProvider, ProviderCapabilities, ProviderOperation } from '../../shared/types.ts';

const logger = getLogger('AlchemyProvider');

export interface AlchemyConfig {
  apiKey?: string;
  network?: string;
  baseUrl?: string;
  timeout?: number;
  retries?: number;
}


export class AlchemyProvider implements IBlockchainProvider<AlchemyConfig> {
  readonly name = 'alchemy';
  readonly blockchain = 'ethereum';
  readonly capabilities: ProviderCapabilities = {
    supportedOperations: ['getAddressTransactions', 'getAddressBalance', 'getTokenTransactions', 'getTokenBalances'],
    maxBatchSize: 100, // Alchemy supports batch requests
    supportsHistoricalData: true,
    supportsPagination: true,
    maxLookbackDays: undefined, // No limit
    supportsRealTimeData: true,
    supportsTokenData: true
  };
  readonly rateLimit: RateLimitConfig = {
    requestsPerSecond: 5, // Alchemy allows higher rates
    requestsPerMinute: 300,
    requestsPerHour: 3600,
    burstLimit: 10
  };

  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly network: string;
  private readonly httpClient: HttpClient;

  constructor(config: AlchemyConfig = {}) {
    this.apiKey = config.apiKey || process.env.ALCHEMY_API_KEY || '';
    this.network = config.network || 'eth-mainnet';
    this.baseUrl = config.baseUrl || `https://${this.network}.g.alchemy.com/v2/${this.apiKey}`;
    this.httpClient = new HttpClient({
      baseUrl: this.baseUrl,
      timeout: config.timeout || 10000,
      retries: config.retries || 3,
      rateLimit: this.rateLimit,
      providerName: this.name
    });

    if (!this.apiKey) {
      throw new Error('Alchemy API key is required - set ALCHEMY_API_KEY environment variable');
    }

    logger.debug(`Initialized AlchemyProvider - Network: ${this.network}, BaseUrl: ${this.baseUrl.replace(this.apiKey, 'HIDDEN')}, Timeout: ${config.timeout || 10000}, Retries: ${config.retries || 3}`);
  }

  async isHealthy(): Promise<boolean> {
    try {
      // Test with a simple JSON-RPC call
      const response = await this.httpClient.post('', {
        jsonrpc: '2.0',
        method: 'eth_blockNumber',
        params: [],
        id: 1
      });
      return response && response.result;
    } catch (error) {
      logger.warn(`Health check failed - Error: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  async testConnection(): Promise<boolean> {
    return this.isHealthy();
  }

  async execute<T>(operation: ProviderOperation<T>): Promise<T> {
    switch (operation.type) {
      case 'getAddressTransactions':
        return this.getAddressTransactions(operation.params.address, operation.params.since) as Promise<T>;
      case 'getAddressBalance':
        return this.getAddressBalance(operation.params.address) as Promise<T>;
      case 'getTokenTransactions':
        return this.getTokenTransactions(operation.params.address, operation.params.contractAddress, operation.params.since) as Promise<T>;
      case 'getTokenBalances':
        return this.getTokenBalances(operation.params.address, operation.params.contractAddresses) as Promise<T>;
      default:
        throw new ServiceError(`Unsupported operation: ${operation.type}`, this.name, operation.type);
    }
  }

  private async getAddressTransactions(address: string, since?: number): Promise<BlockchainTransaction[]> {

    try {
      // Get only regular transactions (external + internal, no tokens)
      // Token transactions are handled separately via getTokenTransactions
      const transfers = await this.getAssetTransfers(address, since, ['external', 'internal']);

      // Convert to standard blockchain transactions
      const transactions = transfers.map(transfer => this.convertAssetTransfer(transfer, address));

      // Sort by timestamp
      transactions.sort((a, b) => a.timestamp - b.timestamp);

      logger.debug(`Found ${transactions.length} regular transactions for ${address}`);
      return transactions;

    } catch (error) {
      logger.error(`Failed to fetch regular transactions for ${address} - Error: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  private async getAddressBalance(address: string): Promise<Balance[]> {

    try {
      // Get ETH balance
      const ethBalanceResponse = await this.httpClient.post('', {
        jsonrpc: '2.0',
        method: 'eth_getBalance',
        params: [address, 'latest'],
        id: 1
      });
      const ethBalanceWei = new Decimal(ethBalanceResponse.result);
      const ethBalance = ethBalanceWei.dividedBy(new Decimal(10).pow(18));

      const balances: Balance[] = [{
        currency: 'ETH',
        balance: ethBalance.toNumber(),
        used: 0,
        total: ethBalance.toNumber()
      }];

      // Get token balances using Alchemy's enhanced API
      const tokenBalances = await this.getTokenBalancesForAddress(address);
      balances.push(...tokenBalances);

      return balances;
    } catch (error) {
      logger.error(`Failed to fetch balance for ${address} - Error: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  private async getTokenTransactions(address: string, contractAddress?: string, since?: number): Promise<BlockchainTransaction[]> {

    // Use asset transfers with token category filter
    const transfers = await this.getAssetTransfers(address, since, ['erc20', 'erc721', 'erc1155'], contractAddress);
    return transfers.map(transfer => this.convertAssetTransfer(transfer, address));
  }

  private async getTokenBalances(address: string, contractAddresses?: string[]): Promise<Balance[]> {
    return this.getTokenBalancesForAddress(address, contractAddresses);
  }

  private async getAssetTransfers(
    address: string,
    since?: number,
    category: string[] = ['external', 'internal', 'erc20', 'erc721', 'erc1155'],
    contractAddress?: string
  ): Promise<any[]> {
    const params: any = {
      fromAddress: address,
      toAddress: address,
      category,
      withMetadata: true,
      excludeZeroValue: false,
      maxCount: '0x3e8' // 1000 in hex
    };

    if (contractAddress) {
      params.contractAddresses = [contractAddress];
    }

    if (since) {
      // Convert timestamp to block number (approximate)
      const blockNumber = await this.timestampToBlockNumber(since);
      if (blockNumber) {
        params.fromBlock = `0x${blockNumber.toString(16)}`;
      }
    }

    // Get transfers from address
    const fromResponse = await this.httpClient.post('', {
      jsonrpc: '2.0',
      method: 'alchemy_getAssetTransfers',
      params: [params],
      id: 1
    });

    // Get transfers to address
    const toParams = { ...params };
    delete toParams.fromAddress;
    toParams.toAddress = address;
    const toResponse = await this.httpClient.post('', {
      jsonrpc: '2.0',
      method: 'alchemy_getAssetTransfers',
      params: [toParams],
      id: 1
    });

    const allTransfers = [
      ...(fromResponse.result?.transfers || []),
      ...(toResponse.result?.transfers || [])
    ];

    // Remove duplicates based on hash + category
    const uniqueTransfers = allTransfers.filter((transfer, index, array) =>
      array.findIndex(t => t.hash === transfer.hash && t.category === transfer.category) === index
    );

    return uniqueTransfers;
  }

  private async getTokenBalancesForAddress(address: string, contractAddresses?: string[]): Promise<Balance[]> {
    try {
      const params: any = {
        address,
        tokenType: 'erc20'
      };

      if (contractAddresses) {
        params.contractAddresses = contractAddresses;
      }

      const response = await this.httpClient.post('', {
        jsonrpc: '2.0',
        method: 'alchemy_getTokenBalances',
        params: [address, contractAddresses || 'DEFAULT_TOKENS'],
        id: 1
      });

      const balances: Balance[] = [];

      for (const tokenBalance of response.result?.tokenBalances || []) {
        if (tokenBalance.tokenBalance && tokenBalance.tokenBalance !== '0x0') {
          // Get token metadata
          const metadata = await this.httpClient.post('', {
            jsonrpc: '2.0',
            method: 'alchemy_getTokenMetadata',
            params: [tokenBalance.contractAddress],
            id: 1
          }).then(response => response.result).catch(() => null);

          const balance = new Decimal(tokenBalance.tokenBalance);
          const decimals = metadata?.decimals || 18;
          const symbol = metadata?.symbol || 'UNKNOWN';

          const adjustedBalance = balance.dividedBy(new Decimal(10).pow(decimals));

          balances.push({
            currency: symbol,
            balance: adjustedBalance.toNumber(),
            used: 0,
            total: adjustedBalance.toNumber(),
            contractAddress: tokenBalance.contractAddress
          });
        }
      }

      return balances;
    } catch (error) {
      logger.warn(`Failed to fetch token balances for ${address} - Error: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }


  private async timestampToBlockNumber(_timestamp: number): Promise<number | null> {
    try {
      // This is an approximation - Alchemy doesn't have a direct timestamp to block API
      // We could implement binary search here, but for now return null to get all history
      return null;
    } catch (error) {
      return null;
    }
  }

  private convertAssetTransfer(transfer: any, userAddress: string): BlockchainTransaction {
    const isFromUser = transfer.from.toLowerCase() === userAddress.toLowerCase();
    const isToUser = transfer.to.toLowerCase() === userAddress.toLowerCase();

    // Determine transaction type
    let type: 'transfer_in' | 'transfer_out' | 'token_transfer_in' | 'token_transfer_out';
    const isToken = transfer.category === 'token';

    if (isFromUser && isToUser) {
      type = isToken ? 'token_transfer_in' : 'transfer_in'; // Self-transfer, treat as incoming
    } else if (isFromUser) {
      type = isToken ? 'token_transfer_out' : 'transfer_out';
    } else {
      type = isToken ? 'token_transfer_in' : 'transfer_in';
    }

    // Handle different asset types
    let currency = 'ETH';
    let amount = new Decimal(transfer.value || 0);

    if (transfer.category === 'token') {
      currency = transfer.asset || 'UNKNOWN';
      if (transfer.rawContract?.decimal) {
        const decimals = parseInt(transfer.rawContract.decimal);
        amount = amount.dividedBy(new Decimal(10).pow(decimals));
      }
    } else {
      // ETH transfer - value is already in ETH, not wei for Alchemy
      currency = 'ETH';
    }

    const timestamp = transfer.metadata?.blockTimestamp ?
      new Date(transfer.metadata.blockTimestamp).getTime() :
      Date.now();

    return {
      hash: transfer.hash,
      blockNumber: parseInt(transfer.blockNum, 16),
      blockHash: '',
      timestamp,
      from: transfer.from,
      to: transfer.to,
      value: createMoney(amount.toNumber(), currency),
      fee: createMoney(0, 'ETH'),
      status: 'success' as const,
      type,
      tokenContract: transfer.rawContract?.address,
      tokenSymbol: currency !== 'ETH' ? currency : undefined
    };
  }

}