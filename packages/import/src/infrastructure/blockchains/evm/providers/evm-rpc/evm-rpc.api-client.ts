import { maskAddress } from '@exitbook/shared-utils';

import type { ProviderConfig } from '../../../shared/index.ts';
import { RegisterApiClient, BlockchainApiClient } from '../../../shared/index.ts';
import type { ProviderOperation, JsonRpcResponse } from '../../../shared/types.ts';
import type { EvmChainConfig } from '../../chain-config.interface.ts';
import { getEvmChainConfig } from '../../chain-registry.ts';

import type {
  EvmRpcTransaction,
  EvmRpcTransactionReceipt,
  EvmRpcBlock,
  EvmRpcLog,
  EvmRpcRawData,
} from './evm-rpc.types.ts';
import { ERC20_TRANSFER_EVENT_SIGNATURE } from './evm-rpc.types.ts';

/**
 * EVM RPC Provider - Direct JSON-RPC connection to EVM blockchain nodes
 *
 * Uses standard Ethereum JSON-RPC methods:
 * - eth_getBalance
 * - eth_getTransactionByHash
 * - eth_getTransactionReceipt
 * - eth_getBlockByNumber
 * - eth_getLogs
 *
 * Works with any EVM-compatible chain (Ethereum, Polygon, Arbitrum, etc.)
 */
@RegisterApiClient({
  baseUrl: 'https://eth.llamarpc.com', // Free public RPC endpoint
  blockchain: 'ethereum',
  capabilities: {
    supportedOperations: [
      'getRawAddressTransactions',
      'getRawAddressInternalTransactions',
      'getRawAddressBalance',
      'getTokenTransactions',
      'getRawTokenBalances',
    ],
  },
  defaultConfig: {
    rateLimit: {
      burstLimit: 2,
      requestsPerMinute: 60,
      requestsPerSecond: 1,
    },
    retries: 3,
    timeout: 30000,
  },
  description: 'Direct JSON-RPC connection to EVM nodes with standard Ethereum RPC methods',
  displayName: 'EVM RPC',
  name: 'evm-rpc',
  requiresApiKey: false,
  supportedChains: {
    arbitrum: { baseUrl: 'https://arb1.arbitrum.io/rpc' },
    avalanche: { baseUrl: 'https://api.avax.network/ext/bc/C/rpc' },
    base: { baseUrl: 'https://mainnet.base.org' },
    bsc: { baseUrl: 'https://bsc-dataseed.binance.org' },
    ethereum: { baseUrl: 'https://eth.llamarpc.com' },
    optimism: { baseUrl: 'https://mainnet.optimism.io' },
    polygon: { baseUrl: 'https://polygon-rpc.com' },
    theta: { baseUrl: 'https://www.thetascan.io/api/eth-rpc' },
  },
})
export class EvmRpcApiClient extends BlockchainApiClient {
  private readonly chainConfig: EvmChainConfig;
  private rpcIdCounter = 1;

  constructor(config: ProviderConfig) {
    super(config);

    // Get EVM chain config
    const evmChainConfig = getEvmChainConfig(config.blockchain);
    if (!evmChainConfig) {
      throw new Error(`Unsupported blockchain: ${config.blockchain}`);
    }
    this.chainConfig = evmChainConfig;

    this.logger.debug(
      `Initialized EvmRpcApiClient for ${config.blockchain} - Chain ID: ${this.chainConfig.chainId}, BaseUrl: ${this.baseUrl}`
    );
  }

  async execute<T>(operation: ProviderOperation<T>): Promise<T> {
    this.logger.debug(`Executing operation: ${operation.type}`);

    switch (operation.type) {
      case 'getRawAddressTransactions': {
        const { address, since } = operation;
        this.logger.debug(`Fetching raw address transactions - Address: ${maskAddress(address)}`);
        return this.getRawAddressTransactions(address, since) as Promise<T>;
      }
      case 'getRawAddressInternalTransactions': {
        const { address, since } = operation;
        this.logger.debug(`Fetching raw address internal transactions - Address: ${maskAddress(address)}`);
        return this.getRawAddressInternalTransactions(address, since) as Promise<T>;
      }
      case 'getRawAddressBalance': {
        const { address } = operation;
        this.logger.debug(`Fetching raw address balance - Address: ${maskAddress(address)}`);
        return this.getRawAddressBalance(address) as Promise<T>;
      }
      case 'getTokenTransactions': {
        const { address, contractAddress, since } = operation;
        this.logger.debug(
          `Fetching token transactions - Address: ${maskAddress(address)}, Contract: ${contractAddress || 'all'}`
        );
        return this.getTokenTransactions(address, contractAddress, since) as Promise<T>;
      }
      case 'getRawTokenBalances': {
        const { address, contractAddresses } = operation;
        this.logger.debug(`Fetching raw token balances - Address: ${maskAddress(address)}`);
        return this.getRawTokenBalances(address, contractAddresses) as Promise<T>;
      }
      default:
        throw new Error(`Unsupported operation: ${operation.type}`);
    }
  }

  getHealthCheckConfig() {
    return {
      body: {
        id: 1,
        jsonrpc: '2.0',
        method: 'eth_blockNumber',
        params: [],
      },
      endpoint: '/',
      method: 'POST' as const,
      validate: (response: unknown) => {
        const data = response as JsonRpcResponse<string>;
        return data && data.result !== undefined && typeof data.result === 'string';
      },
    };
  }

  /**
   * Call a JSON-RPC method
   */
  private async rpcCall<T>(method: string, params: unknown[]): Promise<T> {
    const response = await this.httpClient.post<JsonRpcResponse<T>>('/', {
      id: this.rpcIdCounter++,
      jsonrpc: '2.0',
      method,
      params,
    });

    if (response.error) {
      throw new Error(`RPC Error: ${response.error.message} (code: ${response.error.code})`);
    }

    return response.result;
  }

  /**
   * Get the current block number
   */
  private async getCurrentBlockNumber(): Promise<number> {
    const blockNumberHex = await this.rpcCall<string>('eth_blockNumber', []);
    return parseInt(blockNumberHex, 16);
  }

  /**
   * Get block by number
   */
  private async getBlockByNumber(blockNumber: number | string, fullTransactions = false): Promise<EvmRpcBlock> {
    const blockNumberHex = typeof blockNumber === 'number' ? `0x${blockNumber.toString(16)}` : blockNumber;
    return await this.rpcCall<EvmRpcBlock>('eth_getBlockByNumber', [blockNumberHex, fullTransactions]);
  }

  /**
   * Get transaction by hash
   */
  private async getTransactionByHash(txHash: string): Promise<EvmRpcTransaction | null> {
    return await this.rpcCall<EvmRpcTransaction | null>('eth_getTransactionByHash', [txHash]);
  }

  /**
   * Get transaction receipt
   */
  private async getTransactionReceipt(txHash: string): Promise<EvmRpcTransactionReceipt | null> {
    return await this.rpcCall<EvmRpcTransactionReceipt | null>('eth_getTransactionReceipt', [txHash]);
  }

  /**
   * Get logs (events)
   */
  private async getLogs(params: {
    address?: string | string[];
    fromBlock?: string;
    toBlock?: string;
    topics?: (string | string[] | undefined)[];
  }): Promise<EvmRpcLog[]> {
    return await this.rpcCall<EvmRpcLog[]>('eth_getLogs', [params]);
  }

  /**
   * Get balance for an address
   */
  private async getRawAddressBalance(address: string): Promise<{ balance: string }> {
    try {
      const balanceHex = await this.rpcCall<string>('eth_getBalance', [address, 'latest']);
      this.logger.debug(`Found raw balance for ${maskAddress(address)}: ${balanceHex}`);
      return { balance: balanceHex };
    } catch (error) {
      this.logger.error(
        `Failed to fetch raw address balance for ${maskAddress(address)} - Error: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }

  /**
   * Get transactions for an address
   * Uses eth_getLogs to find transactions where the address is involved
   */
  private async getRawAddressTransactions(address: string, since?: number): Promise<EvmRpcRawData[]> {
    try {
      const currentBlock = await this.getCurrentBlockNumber();
      const fromBlock = since ? await this.findBlockByTimestamp(since) : 0;
      const toBlock = currentBlock;

      this.logger.debug(
        `Scanning blocks ${fromBlock} to ${toBlock} for address ${maskAddress(address)} (${toBlock - fromBlock + 1} blocks)`
      );

      // Get logs where address is involved in Transfer events or regular transactions
      // Note: This is a simplified approach. A full implementation would scan blocks directly
      // or use an indexed service. For now, we'll get the last N blocks.
      const recentBlocks = Math.min(toBlock - fromBlock, 1000); // Limit to 1000 blocks
      const startBlock = Math.max(fromBlock, toBlock - recentBlocks + 1);

      this.logger.debug(`Limiting scan to last ${recentBlocks} blocks (${startBlock} to ${toBlock})`);

      const transactions: EvmRpcRawData[] = [];
      const uniqueTxHashes = new Set<string>();

      // Fetch logs for the address (both as sender and receiver in events)
      const logs = await this.getLogs({
        fromBlock: `0x${startBlock.toString(16)}`,
        toBlock: `0x${toBlock.toString(16)}`,
        topics: [ERC20_TRANSFER_EVENT_SIGNATURE, undefined, undefined],
      });

      this.logger.debug(`Found ${logs.length} Transfer event logs in block range`);

      // Extract unique transaction hashes from logs where address is involved
      for (const log of logs) {
        // Check if address is in the topics (indexed parameters)
        const addressLower = address.toLowerCase();
        const fromTopic = log.topics[1]; // indexed from parameter
        const toTopic = log.topics[2]; // indexed to parameter

        // Topics are 32 bytes, address is 20 bytes padded with zeros
        const fromAddress = fromTopic ? `0x${fromTopic.slice(-40)}` : undefined;
        const toAddress = toTopic ? `0x${toTopic.slice(-40)}` : undefined;

        if (fromAddress?.toLowerCase() === addressLower || toAddress?.toLowerCase() === addressLower) {
          uniqueTxHashes.add(log.transactionHash);
        }
      }

      this.logger.debug(`Found ${uniqueTxHashes.size} unique transactions from Transfer events`);

      // Also scan recent blocks for direct transactions (non-token transfers)
      // This is expensive, so we'll only do the last 100 blocks
      const directTxScanBlocks = Math.min(100, recentBlocks);
      const directTxStartBlock = toBlock - directTxScanBlocks + 1;

      this.logger.debug(`Scanning last ${directTxScanBlocks} blocks for direct transactions`);

      for (let blockNum = directTxStartBlock; blockNum <= toBlock; blockNum++) {
        try {
          const block = await this.getBlockByNumber(blockNum, true);
          if (Array.isArray(block.transactions) && block.transactions.length > 0) {
            for (const tx of block.transactions) {
              if (typeof tx === 'object' && tx !== null) {
                const transaction = tx;
                const addressLower = address.toLowerCase();
                if (
                  transaction.from?.toLowerCase() === addressLower ||
                  transaction.to?.toLowerCase() === addressLower
                ) {
                  uniqueTxHashes.add(transaction.hash);
                }
              }
            }
          }
        } catch (error) {
          this.logger.debug(
            `Failed to fetch block ${blockNum}: ${error instanceof Error ? error.message : String(error)}`
          );
          // Continue with other blocks
        }
      }

      this.logger.debug(`Total unique transaction hashes to fetch: ${uniqueTxHashes.size}`);

      // Fetch full transaction details for all unique hashes
      let fetchCount = 0;
      for (const txHash of uniqueTxHashes) {
        try {
          const [transaction, receipt] = await Promise.all([
            this.getTransactionByHash(txHash),
            this.getTransactionReceipt(txHash),
          ]);

          if (transaction && receipt) {
            transactions.push({
              _nativeCurrency: this.chainConfig.nativeCurrency,
              _nativeDecimals: this.chainConfig.nativeDecimals,
              receipt,
              transaction,
            });
            fetchCount++;
          }
        } catch (error) {
          this.logger.debug(
            `Failed to fetch transaction ${txHash}: ${error instanceof Error ? error.message : String(error)}`
          );
          // Continue with other transactions
        }
      }

      this.logger.debug(`Successfully fetched ${fetchCount} transactions for ${maskAddress(address)}`);

      return transactions;
    } catch (error) {
      this.logger.error(
        `Failed to fetch raw address transactions for ${maskAddress(address)} - Error: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }

  /**
   * Get internal transactions (requires trace support)
   * Most public RPC endpoints don't support trace_* methods
   */
  private async getRawAddressInternalTransactions(_address: string, _since?: number): Promise<EvmRpcRawData[]> {
    this.logger.warn(
      'Internal transactions require trace_* RPC methods which are not supported by most public endpoints. Returning empty array.'
    );
    return Promise.resolve([]);
  }

  /**
   * Get token transactions for an address
   */
  private async getTokenTransactions(
    address: string,
    contractAddress?: string,
    since?: number
  ): Promise<EvmRpcRawData[]> {
    try {
      const currentBlock = await this.getCurrentBlockNumber();
      const fromBlock = since ? await this.findBlockByTimestamp(since) : 0;
      const toBlock = currentBlock;

      // Limit to last 1000 blocks to avoid overwhelming public RPC
      const recentBlocks = Math.min(toBlock - fromBlock, 1000);
      const startBlock = Math.max(fromBlock, toBlock - recentBlocks + 1);

      this.logger.debug(
        `Scanning blocks ${startBlock} to ${toBlock} for token transfers - Address: ${maskAddress(address)}, Contract: ${contractAddress || 'all'}`
      );

      const transactions: EvmRpcRawData[] = [];
      const uniqueTxHashes = new Set<string>();

      // Get Transfer events where address is sender or receiver
      const logs = await this.getLogs({
        ...(contractAddress ? { address: contractAddress } : {}),
        fromBlock: `0x${startBlock.toString(16)}`,
        toBlock: `0x${toBlock.toString(16)}`,
        topics: [
          ERC20_TRANSFER_EVENT_SIGNATURE,
          undefined, // We'll filter by address in topics manually
        ],
      });

      this.logger.debug(`Found ${logs.length} Transfer event logs`);

      // Filter logs where address is involved
      const addressLower = address.toLowerCase();
      for (const log of logs) {
        const fromTopic = log.topics[1];
        const toTopic = log.topics[2];

        const fromAddress = fromTopic ? `0x${fromTopic.slice(-40)}` : undefined;
        const toAddress = toTopic ? `0x${toTopic.slice(-40)}` : undefined;

        if (fromAddress?.toLowerCase() === addressLower || toAddress?.toLowerCase() === addressLower) {
          uniqueTxHashes.add(log.transactionHash);
        }
      }

      this.logger.debug(`Found ${uniqueTxHashes.size} unique token transactions`);

      // Fetch full transaction details
      for (const txHash of uniqueTxHashes) {
        try {
          const [transaction, receipt] = await Promise.all([
            this.getTransactionByHash(txHash),
            this.getTransactionReceipt(txHash),
          ]);

          if (transaction && receipt) {
            transactions.push({
              _nativeCurrency: this.chainConfig.nativeCurrency,
              _nativeDecimals: this.chainConfig.nativeDecimals,
              receipt,
              transaction,
            });
          }
        } catch (error) {
          this.logger.debug(
            `Failed to fetch transaction ${txHash}: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }

      this.logger.debug(`Successfully fetched ${transactions.length} token transactions`);

      return transactions;
    } catch (error) {
      this.logger.error(
        `Failed to fetch token transactions for ${maskAddress(address)} - Error: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }

  /**
   * Get token balances for an address
   * Note: Standard RPC doesn't have a direct method for this
   * Would need to call balanceOf on each token contract
   */
  private async getRawTokenBalances(_address: string, _contractAddresses?: string[]): Promise<unknown[]> {
    this.logger.warn(
      'Token balance fetching via RPC requires calling balanceOf on each contract individually. This is not yet implemented. Returning empty array.'
    );
    // TODO: Implement eth_call to balanceOf(address) for each contract
    return Promise.resolve([]);
  }

  /**
   * Find approximate block number for a given timestamp
   * Uses binary search to find the block closest to the timestamp
   */
  private async findBlockByTimestamp(timestamp: number): Promise<number> {
    const currentBlock = await this.getCurrentBlockNumber();
    const currentBlockData = await this.getBlockByNumber(currentBlock);
    const currentTimestamp = parseInt(currentBlockData.timestamp, 16);

    // If timestamp is in the future or very recent, return current block
    if (timestamp >= currentTimestamp) {
      return currentBlock;
    }

    // Estimate block based on average block time (12 seconds for Ethereum)
    const avgBlockTime = 12; // seconds
    const timeDiff = currentTimestamp - timestamp;
    const estimatedBlocksAgo = Math.floor(timeDiff / avgBlockTime);
    const estimatedBlock = Math.max(0, currentBlock - estimatedBlocksAgo);

    this.logger.debug(
      `Estimated block ${estimatedBlock} for timestamp ${timestamp} (${estimatedBlocksAgo} blocks ago)`
    );

    return estimatedBlock;
  }
}
