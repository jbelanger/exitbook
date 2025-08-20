import { Decimal } from 'decimal.js';

import { AddressInfo, BlockchainTransaction, MempoolAddressInfo, MempoolTransaction, ProviderOperation } from '@crypto/core';
import { createMoney } from '@crypto/shared-utils';
import { BaseRegistryProvider } from '../registry/base-registry-provider.js';
import { RegisterProvider } from '../registry/decorators.js';


@RegisterProvider({
  name: 'mempool.space',
  blockchain: 'bitcoin',
  displayName: 'Mempool.space API',
  type: 'rest',
  requiresApiKey: false,
  description: 'Bitcoin blockchain explorer API with comprehensive transaction and balance data (no API key required)',
  capabilities: {
    supportedOperations: ['getAddressTransactions', 'getAddressBalance', 'getRawAddressTransactions', 'getAddressInfo', 'parseWalletTransaction'],
    maxBatchSize: 25,
    providesHistoricalData: true,
    supportsPagination: true,
    supportsRealTimeData: true,
    supportsTokenData: false
  },
  networks: {
    mainnet: {
      baseUrl: 'https://mempool.space/api'
    },
    testnet: {
      baseUrl: 'https://mempool.space/testnet/api'
    }
  },
  defaultConfig: {
    timeout: 10000,
    retries: 3,
    rateLimit: {
      requestsPerSecond: 0.25, // Conservative: 1 request per 4 seconds
      requestsPerMinute: 15,
      requestsPerHour: 600,
      burstLimit: 1
    }
  }
})
export class MempoolSpaceProvider extends BaseRegistryProvider {

  constructor() {
    super('bitcoin', 'mempool.space', 'mainnet');

    this.logger.info('Initialized MempoolSpaceProvider from registry metadata', {
      network: this.network,
      baseUrl: this.baseUrl
    });
  }

  async isHealthy(): Promise<boolean> {
    try {
      const response = await this.httpClient.get<number>('/blocks/tip/height');
      return typeof response === 'number' && response > 0;
    } catch (error) {
      this.logger.warn('Health check failed', { error: error instanceof Error ? error.message : String(error) });
      return false;
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      // Test with a simple endpoint that should always work
      const blockHeight = await this.httpClient.get<number>('/blocks/tip/height');
      this.logger.info('Connection test successful', { currentBlockHeight: blockHeight });
      return typeof blockHeight === 'number' && blockHeight > 0;
    } catch (error) {
      this.logger.error('Connection test failed', { error: error instanceof Error ? error.message : String(error) });
      return false;
    }
  }

  async execute<T>(operation: ProviderOperation<T>): Promise<T> {
    this.logger.debug('Executing operation', {
      type: operation.type,
      address: operation.params?.address ? this.maskAddress(operation.params.address) : 'N/A'
    });

    try {
      switch (operation.type) {
        case 'getAddressTransactions':
          return this.getAddressTransactions(operation.params as { address: string; since?: number }) as T;
        case 'getRawAddressTransactions':
          return this.getRawAddressTransactions(operation.params as { address: string; since?: number }) as T;
        case 'getAddressBalance':
          return this.getAddressBalance(operation.params as { address: string }) as T;
        case 'getAddressInfo':
          return this.getAddressInfo(operation.params as { address: string }) as T;
        case 'parseWalletTransaction':
          return this.parseWalletTransaction(operation.params as { tx: any; walletAddresses: string[] }) as T;
        default:
          throw new Error(`Unsupported operation: ${operation.type}`);
      }
    } catch (error) {
      this.logger.error('Operation execution failed', {
        type: operation.type,
        params: operation.params,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      throw error;
    }
  }

  private async getAddressTransactions(params: { address: string; since?: number }): Promise<BlockchainTransaction[]> {
    const { address, since } = params;

    this.logger.debug('Fetching address transactions', { address: this.maskAddress(address), since });

    try {
      // Get transaction list directly - mempool.space returns full transaction objects, not just IDs
      // No need to check address info first as empty addresses will just return empty array
      const rawTransactions = await this.httpClient.get<MempoolTransaction[]>(`/address/${address}/txs`);

      if (!Array.isArray(rawTransactions) || rawTransactions.length === 0) {
        this.logger.debug('No transactions found', { address: this.maskAddress(address) });
        return [];
      }

      this.logger.debug('Retrieved transactions', {
        address: this.maskAddress(address),
        count: rawTransactions.length
      });

      // Transform the transactions directly since we already have the full data
      const transactions: BlockchainTransaction[] = [];

      for (const tx of rawTransactions) {
        try {
          const blockchainTx = this.transformTransaction(tx, address);
          transactions.push(blockchainTx);
        } catch (error) {
          this.logger.warn('Failed to transform transaction', {
            txid: tx.txid,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

      // Filter by timestamp if 'since' is provided
      let filteredTransactions = transactions;
      if (since) {
        filteredTransactions = transactions.filter(tx => tx.timestamp >= since);
        this.logger.debug('Filtered transactions by timestamp', {
          originalCount: transactions.length,
          filteredCount: filteredTransactions.length,
          since
        });
      }

      // Sort by timestamp (newest first)
      filteredTransactions.sort((a, b) => b.timestamp - a.timestamp);

      this.logger.info('Successfully retrieved address transactions', {
        address: this.maskAddress(address),
        totalTransactions: filteredTransactions.length
      });

      return filteredTransactions;

    } catch (error) {
      this.logger.error('Failed to get address transactions', {
        address: this.maskAddress(address),
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Get raw transaction data without transformation for wallet-aware parsing
   */
  private async getRawAddressTransactions(params: { address: string; since?: number }): Promise<MempoolTransaction[]> {
    const { address, since } = params;

    this.logger.debug('Fetching raw address transactions', { address: this.maskAddress(address), since });

    try {
      // Get raw transaction list directly - mempool.space returns full transaction objects
      // No need to check address info first as empty addresses will just return empty array
      const rawTransactions = await this.httpClient.get<MempoolTransaction[]>(`/address/${address}/txs`);

      if (!Array.isArray(rawTransactions) || rawTransactions.length === 0) {
        this.logger.debug('No raw transactions found', { address: this.maskAddress(address) });
        return [];
      }

      this.logger.debug('Retrieved raw transactions', {
        address: this.maskAddress(address),
        count: rawTransactions.length
      });

      // Filter by timestamp if 'since' is provided
      let filteredTransactions = rawTransactions;
      if (since) {
        filteredTransactions = rawTransactions.filter(tx => {
          const timestamp = tx.status.confirmed && tx.status.block_time
            ? tx.status.block_time * 1000
            : Date.now();
          return timestamp >= since;
        });

        this.logger.debug('Filtered raw transactions by timestamp', {
          originalCount: rawTransactions.length,
          filteredCount: filteredTransactions.length,
          since
        });
      }

      // Sort by timestamp (newest first)
      filteredTransactions.sort((a, b) => {
        const timestampA = a.status.confirmed && a.status.block_time ? a.status.block_time : 0;
        const timestampB = b.status.confirmed && b.status.block_time ? b.status.block_time : 0;
        return timestampB - timestampA;
      });

      this.logger.info('Successfully retrieved raw address transactions', {
        address: this.maskAddress(address),
        totalTransactions: filteredTransactions.length
      });

      return filteredTransactions;

    } catch (error) {
      this.logger.error('Failed to get raw address transactions', {
        address: this.maskAddress(address),
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  private async getAddressBalance(params: { address: string }): Promise<{ balance: string; token: string }> {
    const { address } = params;

    this.logger.debug('Fetching address balance', { address: this.maskAddress(address) });

    try {
      const addressInfo = await this.httpClient.get<MempoolAddressInfo>(`/address/${address}`);

      // Calculate current balance: funded amount - spent amount
      const chainBalance = addressInfo.chain_stats.funded_txo_sum - addressInfo.chain_stats.spent_txo_sum;
      const mempoolBalance = addressInfo.mempool_stats.funded_txo_sum - addressInfo.mempool_stats.spent_txo_sum;
      const totalBalanceSats = chainBalance + mempoolBalance;

      // Convert satoshis to BTC
      const balanceBTC = (totalBalanceSats / 100000000).toString();

      this.logger.info('Successfully retrieved address balance', {
        address: this.maskAddress(address),
        balanceBTC,
        balanceSats: totalBalanceSats
      });

      return {
        balance: balanceBTC,
        token: 'BTC'
      };

    } catch (error) {
      this.logger.error('Failed to get address balance', {
        address: this.maskAddress(address),
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Parse a mempool transaction considering multiple wallet addresses (for xpub scenarios)
   */
  private parseWalletTransaction(params: { tx: any; walletAddresses: string[] }): BlockchainTransaction {
    const { tx, walletAddresses } = params;

    try {
      const timestamp = tx.status.confirmed && tx.status.block_time
        ? tx.status.block_time * 1000
        : Date.now();

      // Calculate transaction value considering all wallet addresses
      let totalValueChange = 0;
      let isIncoming = false;
      let isOutgoing = false;
      const relevantAddresses = new Set(walletAddresses);

      // Check inputs - money going out of our wallet
      for (const input of tx.vin) {
        if (input.prevout?.scriptpubkey_address && relevantAddresses.has(input.prevout.scriptpubkey_address)) {
          isOutgoing = true;
          if (input.prevout?.value) {
            totalValueChange -= input.prevout.value;
          }
        }
      }

      // Check outputs - money coming into our wallet
      for (const output of tx.vout) {
        if (output.scriptpubkey_address && relevantAddresses.has(output.scriptpubkey_address)) {
          isIncoming = true;
          totalValueChange += output.value;
        }
      }

      // Determine transaction type
      let type: 'transfer_in' | 'transfer_out' | 'internal_transfer_in' | 'internal_transfer_out';

      if (isIncoming && !isOutgoing) {
        type = 'transfer_in';
      } else if (isOutgoing && !isIncoming) {
        type = 'transfer_out';
      } else if (isIncoming && isOutgoing) {
        // Internal transfer within our wallet - treat based on net change
        type = totalValueChange >= 0 ? 'internal_transfer_in' : 'internal_transfer_out';
      } else {
        // Neither incoming nor outgoing (shouldn't happen with proper filtering)
        type = 'transfer_out';
      }

      const totalValue = Math.abs(totalValueChange);
      const fee = isOutgoing ? tx.fee : 0;

      // Determine from/to addresses (first relevant address found)
      let fromAddress = '';
      let toAddress = '';

      // For from address, look for wallet addresses in inputs
      for (const input of tx.vin) {
        if (input.prevout?.scriptpubkey_address && relevantAddresses.has(input.prevout.scriptpubkey_address)) {
          fromAddress = input.prevout.scriptpubkey_address;
          break;
        }
      }

      // For to address, look for wallet addresses in outputs
      for (const output of tx.vout) {
        if (output.scriptpubkey_address && relevantAddresses.has(output.scriptpubkey_address)) {
          toAddress = output.scriptpubkey_address;
          break;
        }
      }

      // Fallback to first addresses if no wallet addresses found
      if (!fromAddress && tx.vin.length > 0 && tx.vin[0]?.prevout?.scriptpubkey_address) {
        fromAddress = tx.vin[0].prevout.scriptpubkey_address;
      }

      if (!toAddress && tx.vout.length > 0 && tx.vout[0]?.scriptpubkey_address) {
        toAddress = tx.vout[0].scriptpubkey_address;
      }

      return {
        hash: tx.txid,
        blockNumber: tx.status.block_height || 0,
        blockHash: tx.status.block_hash || '',
        timestamp,
        from: fromAddress,
        to: toAddress,
        value: createMoney(totalValue / 100000000, 'BTC'),
        fee: createMoney(fee / 100000000, 'BTC'),
        gasUsed: undefined,
        gasPrice: undefined,
        status: tx.status.confirmed ? 'success' : 'pending',
        type,
        tokenContract: undefined,
        tokenSymbol: 'BTC',
        nonce: undefined,
        confirmations: tx.status.confirmed ? 1 : 0
      };
    } catch (error) {
      this.logger.error(`Failed to parse wallet transaction ${tx.txid}`, {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        txData: JSON.stringify(tx, null, 2)
      });
      throw error;
    }
  }

  /**
   * Get lightweight address info for efficient gap scanning
   */
  private async getAddressInfo(params: { address: string }): Promise<AddressInfo> {
    const { address } = params;

    this.logger.debug('Fetching address info', { address: this.maskAddress(address) });

    try {
      const addressInfo = await this.httpClient.get<MempoolAddressInfo>(`/address/${address}`);

      // Calculate transaction count
      const txCount = addressInfo.chain_stats.tx_count + addressInfo.mempool_stats.tx_count;

      // Calculate current balance: funded amount - spent amount
      const chainBalance = addressInfo.chain_stats.funded_txo_sum - addressInfo.chain_stats.spent_txo_sum;
      const mempoolBalance = addressInfo.mempool_stats.funded_txo_sum - addressInfo.mempool_stats.spent_txo_sum;
      const totalBalanceSats = chainBalance + mempoolBalance;

      // Convert satoshis to BTC
      const balanceBTC = (totalBalanceSats / 100000000).toString();

      this.logger.debug('Successfully retrieved address info', {
        address: this.maskAddress(address),
        txCount,
        balanceBTC
      });

      return {
        txCount,
        balance: balanceBTC
      };

    } catch (error) {
      this.logger.error('Failed to get address info', {
        address: this.maskAddress(address),
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }


  private transformTransaction(tx: MempoolTransaction, userAddress?: string): BlockchainTransaction {
    // Calculate transaction value and determine type
    let valueAmount = new Decimal(0);
    let type: BlockchainTransaction['type'] = 'transfer_in';

    if (userAddress) {
      let inputValue = 0;
      let outputValue = 0;

      // Check inputs for user address
      for (const input of tx.vin) {
        if (input.prevout?.scriptpubkey_address === userAddress) {
          inputValue += input.prevout.value;
        }
      }

      // Check outputs for user address
      for (const output of tx.vout) {
        if (output.scriptpubkey_address === userAddress) {
          outputValue += output.value;
        }
      }

      // Determine transaction type and value
      if (inputValue > 0 && outputValue === 0) {
        // Pure withdrawal: user sent money
        type = 'transfer_out';
        valueAmount = new Decimal(inputValue).div(100000000);
      } else if (inputValue === 0 && outputValue > 0) {
        // Pure deposit: user received money
        type = 'transfer_in';
        valueAmount = new Decimal(outputValue).div(100000000);
      } else if (inputValue > 0 && outputValue > 0) {
        // Mixed transaction: calculate net effect
        const netValue = outputValue - inputValue;
        if (netValue > 0) {
          type = 'transfer_in';
          valueAmount = new Decimal(netValue).div(100000000);
        } else {
          type = 'transfer_out';
          valueAmount = new Decimal(Math.abs(netValue)).div(100000000);
        }
      }
    } else {
      // Without user address context, just sum all outputs
      const totalValue = tx.vout.reduce((sum, output) => sum + output.value, 0);
      valueAmount = new Decimal(totalValue).div(100000000);
    }

    // Extract addresses
    const fromAddresses = tx.vin
      .map(input => input.prevout?.scriptpubkey_address)
      .filter((addr): addr is string => addr !== undefined);
    const toAddresses = tx.vout
      .map(output => output.scriptpubkey_address)
      .filter((addr): addr is string => addr !== undefined);

    return {
      hash: tx.txid,
      blockNumber: tx.status.block_height || 0,
      blockHash: tx.status.block_hash || '',
      timestamp: tx.status.block_time || Math.floor(Date.now() / 1000),
      from: fromAddresses[0] || '',
      to: toAddresses[0] || '',
      value: { amount: valueAmount, currency: 'BTC' },
      fee: { amount: new Decimal(tx.fee).div(100000000), currency: 'BTC' },
      status: tx.status.confirmed ? 'success' : 'pending',
      type
    };
  }



  private maskAddress(address: string): string {
    if (!address || address.length <= 8) return address;
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
  }
}