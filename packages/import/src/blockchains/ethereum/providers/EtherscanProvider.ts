import { Decimal } from 'decimal.js';

import type { Balance, BlockchainTransaction } from '@crypto/core';
import { ServiceError } from '@crypto/core';
import { createMoney } from '@crypto/shared-utils';
import { BaseRegistryProvider } from '../../shared/registry/base-registry-provider.ts';
import { RegisterProvider } from '../../shared/registry/index.ts';
import type { ProviderOperation } from '../../shared/types.ts';
import type { EtherscanInternalTransaction, EtherscanTokenTransfer, EtherscanTransaction } from '../types.ts';

@RegisterProvider({
  name: 'etherscan',
  blockchain: 'ethereum',
  displayName: 'Etherscan API',
  description: 'Official Ethereum blockchain explorer API with comprehensive transaction data',
  requiresApiKey: true,
  type: 'rest',
  apiKeyEnvVar: 'ETHERSCAN_API_KEY',
  capabilities: {
    supportedOperations: ['getAddressTransactions', 'getAddressBalance', 'getTokenTransactions', 'getTokenBalances'],
    maxBatchSize: 1, // Etherscan doesn't support batch operations
    supportsHistoricalData: true,
    supportsPagination: true,
    maxLookbackDays: undefined, // No limit
    supportsRealTimeData: true,
    supportsTokenData: true
  },
  defaultConfig: {
    timeout: 15000,
    retries: 3,
    rateLimit: {
      requestsPerSecond: 0.2,
      requestsPerMinute: 30,
      requestsPerHour: 100,
      burstLimit: 1
    }
  },
  networks: {
    mainnet: {
      baseUrl: 'https://api.etherscan.io/api'
    },
    testnet: {
      baseUrl: 'https://api-goerli.etherscan.io/api'
    }
  }
})
export class EtherscanProvider extends BaseRegistryProvider {
  constructor() {
    super('ethereum', 'etherscan', 'mainnet');
  }

  async isHealthy(): Promise<boolean> {
    try {
      // Test with a simple API call to check chain status
      const response = await this.httpClient.get(`?module=proxy&action=eth_blockNumber&apikey=${this.apiKey}`);
      this.logger.debug(`Health check response`);

      // For proxy calls, success is indicated by having a result, not status='1'
      return response && response.result;
    } catch (error) {
      this.logger.warn(`Health check failed - Error: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  async execute<T>(operation: ProviderOperation<T>): Promise<T> {
    switch (operation.type) {
      case 'getAddressTransactions':
        return this.getAddressTransactions(operation.params as { address: string; since?: number }) as Promise<T>;
      case 'getAddressBalance':
        return this.getAddressBalance(operation.params as { address: string }) as Promise<T>;
      case 'getTokenTransactions':
        return this.getTokenTransactions(operation.params as { address: string; contractAddress?: string; since?: number }) as Promise<T>;
      case 'getTokenBalances':
        return this.getTokenBalances(operation.params as { address: string; contractAddresses?: string[] }) as Promise<T>;
      default:
        throw new ServiceError(`Unsupported operation: ${operation.type}`, 'EtherscanProvider', operation.type);
    }
  }

  private async getAddressTransactions(params: { address: string; since?: number }): Promise<BlockchainTransaction[]> {
    const { address, since } = params;

    this.validateApiKey();

    try {
      // Fetch only regular transactions (normal + internal)
      // Token transactions are handled separately via getTokenTransactions
      const normalTxs = await this.fetchNormalTransactions(address, since);

      const internalTxs = await this.fetchInternalTransactions(address, since);

      this.logger.debug(`Regular transaction breakdown for ${address} - Normal: ${normalTxs.length}, Internal: ${internalTxs.length}, Total: ${normalTxs.length + internalTxs.length}`);

      const allTransactions = [...normalTxs, ...internalTxs];

      // Sort by timestamp
      allTransactions.sort((a, b) => a.timestamp - b.timestamp);

      // Filter to only include transactions relevant to this address
      const relevantTransactions = allTransactions.filter(tx =>
        this.isTransactionRelevant(tx, address)
      );

      this.logger.debug(`Found ${relevantTransactions.length} relevant regular transactions for ${address}`);
      return relevantTransactions;

    } catch (error) {
      this.logger.error(`Failed to fetch regular transactions for ${address}`);
      throw error;
    }
  }

  private async getAddressBalance(params: { address: string }): Promise<Balance[]> {
    const { address } = params;

    // Get ETH balance
    const ethBalance = await this.getEthBalance(address);

    // Note: Getting all token balances requires knowing which tokens to check
    // For now, just return ETH balance
    return [ethBalance];
  }

  private async getTokenTransactions(params: { address: string; contractAddress?: string; since?: number }): Promise<BlockchainTransaction[]> {
    const { address, contractAddress, since } = params;
    return this.fetchTokenTransfers(address, since, contractAddress);
  }

  private async getTokenBalances(_params: { address: string; contractAddresses?: string[] }): Promise<Balance[]> {
    // This would require specific token contract addresses
    // For now, return empty array as this is typically used with specific tokens
    return [];
  }

  private async fetchNormalTransactions(address: string, since?: number): Promise<BlockchainTransaction[]> {
    const startblock = since ? Math.floor(since / 1000) : 0;
    const url = `?module=account&action=txlist&address=${address}&startblock=${startblock}&endblock=99999999&page=1&offset=10000&sort=asc&apikey=${this.apiKey}`;

    const response = await this.httpClient.get(url);

    if (response.status !== '1') {
      if (response.message === 'No transactions found') {
        return [];
      }
      throw new ServiceError(`Etherscan API error: ${response.message}`, 'EtherscanProvider', 'fetchNormalTransactions');
    }

    return response.result.map((tx: EtherscanTransaction) => this.convertNormalTransaction(tx, address));
  }

  private async fetchInternalTransactions(address: string, since?: number): Promise<BlockchainTransaction[]> {
    const startblock = since ? Math.floor(since / 1000) : 0;
    const url = `?module=account&action=txlistinternal&address=${address}&startblock=${startblock}&endblock=99999999&page=1&offset=10000&sort=asc&apikey=${this.apiKey}`;

    const response = await this.httpClient.get(url);

    if (response.status !== '1') {
      this.logger.debug(`Internal transactions response not OK: - Status: ${response.status}, Message: ${response.message}`);
      if (response.message === 'No transactions found' || response.message === 'NOTOK') {
        this.logger.debug(`No internal transactions found: ${response.message}`);
        return [];
      }
      throw new ServiceError(`Etherscan API error: ${response.message}`, 'EtherscanProvider', 'fetchInternalTransactions');
    }

    return response.result.map((tx: EtherscanInternalTransaction) => this.convertInternalTransaction(tx, address));
  }

  private async fetchTokenTransfers(address: string, since?: number, contractAddress?: string): Promise<BlockchainTransaction[]> {
    let url = `?module=account&action=tokentx&address=${address}`;

    if (contractAddress) {
      url += `&contractaddress=${contractAddress}`;
    }

    const startblock = since ? Math.floor(since / 1000) : 0;
    url += `&startblock=${startblock}&endblock=99999999&page=1&offset=10000&sort=asc&apikey=${this.apiKey}`;

    const response = await this.httpClient.get(url);

    if (response.status !== '1') {
      this.logger.debug(`Token transfers response not OK: - Status: ${response.status}, Message: ${response.message}`);
      if (response.message === 'No transactions found' || response.message === 'NOTOK') {
        this.logger.debug(`No token transfers found: ${response.message}`);
        return [];
      }
      throw new ServiceError(`Etherscan API error: ${response.message}`, 'EtherscanProvider', 'fetchTokenTransfers');
    }

    return response.result.map((tx: EtherscanTokenTransfer) => this.convertTokenTransfer(tx, address));
  }

  private async getEthBalance(address: string): Promise<Balance> {
    const url = `?module=account&action=balance&address=${address}&tag=latest&apikey=${this.apiKey}`;
    const response = await this.httpClient.get(url);

    if (response.status !== '1') {
      throw new ServiceError(`Etherscan API error: ${response.message}`, 'EtherscanProvider', 'getEthBalance');
    }

    // Convert from wei to ETH
    const balanceWei = new Decimal(response.result);
    const balanceEth = balanceWei.dividedBy(new Decimal(10).pow(18));

    return {
      currency: 'ETH',
      balance: balanceEth.toNumber(),
      used: 0,
      total: balanceEth.toNumber()
    };
  }

  private convertNormalTransaction(tx: EtherscanTransaction, userAddress: string): BlockchainTransaction {
    const isFromUser = tx.from.toLowerCase() === userAddress.toLowerCase();
    const isToUser = tx.to.toLowerCase() === userAddress.toLowerCase();

    // Determine transaction type
    let type: 'transfer_in' | 'transfer_out' | 'internal_transfer_in' | 'internal_transfer_out';
    if (isFromUser && isToUser) {
      type = 'internal_transfer_in'; // Self-transfer, treat as internal
    } else if (isFromUser) {
      type = 'transfer_out';
    } else {
      type = 'transfer_in';
    }

    // Convert value from wei to ETH
    const valueWei = new Decimal(tx.value);
    const valueEth = valueWei.dividedBy(new Decimal(10).pow(18));

    // Calculate fee
    const gasUsed = new Decimal(tx.gasUsed);
    const gasPrice = new Decimal(tx.gasPrice);
    const feeWei = gasUsed.mul(gasPrice);
    const feeEth = feeWei.dividedBy(new Decimal(10).pow(18));

    return {
      hash: tx.hash,
      blockNumber: parseInt(tx.blockNumber),
      blockHash: '',
      timestamp: parseInt(tx.timeStamp) * 1000,
      from: tx.from,
      to: tx.to,
      value: createMoney(valueEth.toString(), 'ETH'),
      fee: createMoney(feeEth.toString(), 'ETH'),
      gasUsed: parseInt(tx.gasUsed),
      gasPrice: parseInt(gasPrice.toString()),
      status: tx.isError === '0' ? 'success' : 'failed',
      type,
      confirmations: parseInt(tx.confirmations)
    };
  }

  private convertInternalTransaction(tx: EtherscanInternalTransaction, userAddress: string): BlockchainTransaction {
    const isFromUser = tx.from.toLowerCase() === userAddress.toLowerCase();
    const isToUser = tx.to.toLowerCase() === userAddress.toLowerCase();

    // Determine transaction type
    let type: 'transfer_in' | 'transfer_out' | 'internal_transfer_in' | 'internal_transfer_out';
    if (isFromUser && isToUser) {
      type = 'internal_transfer_in'; // Self-transfer, treat as internal
    } else if (isFromUser) {
      type = 'transfer_out';
    } else {
      type = 'transfer_in';
    }

    // Convert value from wei to ETH
    const valueWei = new Decimal(tx.value);
    const valueEth = valueWei.dividedBy(new Decimal(10).pow(18));

    return {
      hash: `${tx.hash}-internal-${tx.traceId || '0'}`,
      blockNumber: parseInt(tx.blockNumber),
      blockHash: '',
      timestamp: parseInt(tx.timeStamp) * 1000,
      from: tx.from,
      to: tx.to,
      value: createMoney(valueEth.toString(), 'ETH'),
      fee: createMoney('0', 'ETH'), // Internal transactions don't have separate fees
      gasUsed: parseInt(tx.gasUsed),
      gasPrice: parseInt(tx.gas),
      status: tx.isError === '0' ? 'success' : 'failed',
      type
    };
  }

  private convertTokenTransfer(tx: EtherscanTokenTransfer, userAddress: string): BlockchainTransaction {
    const isFromUser = tx.from.toLowerCase() === userAddress.toLowerCase();
    const isToUser = tx.to.toLowerCase() === userAddress.toLowerCase();

    // Note: Transaction direction is determined by from/to addresses but not used in this method

    // Convert value using token decimals
    const decimals = parseInt(tx.tokenDecimal);
    const valueRaw = new Decimal(tx.value);
    const value = valueRaw.dividedBy(new Decimal(10).pow(decimals));

    return {
      hash: `${tx.hash}-token-${tx.tokenSymbol}`,
      blockNumber: parseInt(tx.blockNumber),
      blockHash: '',
      timestamp: parseInt(tx.timeStamp) * 1000,
      from: tx.from,
      to: tx.to,
      value: createMoney(value.toString(), tx.tokenSymbol),
      fee: createMoney('0', 'ETH'), // Token transfers use ETH for gas but that's in main tx
      gasUsed: parseInt(tx.gasUsed),
      gasPrice: parseInt(new Decimal(tx.gasPrice).toString()),
      status: 'success', // Token transfers don't have error status in this API
      type: 'token_transfer',
      tokenContract: tx.contractAddress,
      tokenSymbol: tx.tokenSymbol
    };
  }

  private isTransactionRelevant(tx: BlockchainTransaction, userAddress: string): boolean {
    const targetAddress = userAddress.toLowerCase();
    const fromAddress = tx.from.toLowerCase();
    const toAddress = tx.to.toLowerCase();

    // Include if our address is involved and there's actual value transfer
    const isInvolved = fromAddress === targetAddress || toAddress === targetAddress;
    const hasValue = tx.value.amount.greaterThan(0);

    return isInvolved && hasValue;
  }
}