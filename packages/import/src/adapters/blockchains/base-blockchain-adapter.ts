import type {
  BlockchainBalance,
  BlockchainInfo,
  BlockchainTransaction,
  CryptoTransaction,
  IBlockchainAdapter,
  RateLimitConfig,
  TransactionType
} from '@crypto/core';
import { Database } from '@crypto/data';

import { getLogger, type Logger } from '@crypto/shared-logger';



export abstract class BaseBlockchainAdapter implements IBlockchainAdapter {
  protected logger: Logger;
  protected blockchain: string;
  protected network: any; // Each blockchain has different network types
  protected rateLimitConfig: RateLimitConfig;
  protected lastRequestTime: number = 0;
  protected requestCount: { [key: string]: number } = {};
  protected database?: Database;

  constructor(blockchain: string, loggerName: string) {
    this.blockchain = blockchain;
    this.network = 'mainnet'; // Default to mainnet string, adapters can override
    this.logger = getLogger(loggerName);
    this.rateLimitConfig = {
      requestsPerSecond: 5,
      requestsPerMinute: 100,
      requestsPerHour: 1000
    };
  }

  // Abstract methods that must be implemented by specific blockchain adapters
  abstract getAddressTransactions(address: string, since?: number): Promise<BlockchainTransaction[]>;
  abstract getAddressBalance(address: string): Promise<BlockchainBalance[]>;
  abstract validateAddress(address: string): boolean;
  abstract testConnection(): Promise<boolean>;
  abstract getBlockchainInfo(): Promise<BlockchainInfo>;

  // Optional token methods - subclasses can override if they support tokens
  getTokenTransactions?(address: string, tokenContract?: string): Promise<BlockchainTransaction[]>;
  getTokenBalances?(address: string): Promise<BlockchainBalance[]>;

  /**
   * Convert blockchain transaction to standard crypto transaction format
   * Now accepts userAddress to determine transaction direction
   */
  convertToCryptoTransaction(blockchainTx: BlockchainTransaction, userAddress: string): CryptoTransaction {
    // Determine transaction type based on user's address
    let type: TransactionType;
    const normalizedUserAddress = userAddress.toLowerCase();
    const isIncoming = blockchainTx.to.toLowerCase() === normalizedUserAddress;
    const isOutgoing = blockchainTx.from.toLowerCase() === normalizedUserAddress;

    if (isIncoming && !isOutgoing) {
      type = 'deposit';
    } else if (isOutgoing && !isIncoming) {
      type = 'withdrawal';
    } else {
      // This shouldn't happen with proper filtering, but default to transfer
      type = 'transfer';
    }

    return {
      id: blockchainTx.hash,
      type,
      timestamp: blockchainTx.timestamp,
      datetime: new Date(blockchainTx.timestamp).toISOString(),
      symbol: blockchainTx.tokenSymbol || blockchainTx.value.currency,
      side: undefined,
      amount: blockchainTx.value,
      price: undefined,
      fee: blockchainTx.fee,
      status: blockchainTx.status === 'success' ? 'closed' :
        blockchainTx.status === 'pending' ? 'open' : 'canceled',
      info: {
        blockNumber: blockchainTx.blockNumber,
        blockHash: blockchainTx.blockHash,
        from: blockchainTx.from,
        to: blockchainTx.to,
        gasUsed: blockchainTx.gasUsed,
        gasPrice: blockchainTx.gasPrice,
        nonce: blockchainTx.nonce,
        confirmations: blockchainTx.confirmations,
        tokenContract: blockchainTx.tokenContract,
        transactionType: blockchainTx.type,
        originalTransaction: blockchainTx
      }
    };
  }

  async close(): Promise<void> {
    // Base implementation - adapters can override for cleanup
    this.logger.debug('Base blockchain adapter closed');
  }
}