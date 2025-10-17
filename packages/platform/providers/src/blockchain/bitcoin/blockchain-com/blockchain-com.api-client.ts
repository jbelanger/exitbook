import { getErrorMessage } from '@exitbook/core';

import { BaseApiClient } from '../../../core/blockchain/base/api-client.ts';
import type { ProviderConfig, ProviderOperation } from '../../../core/blockchain/index.ts';
import { RegisterApiClient } from '../../../core/blockchain/index.ts';
import { maskAddress } from '../../../core/blockchain/utils/address-utils.ts';
import type { AddressInfo } from '../types.js';

import type { BlockchainComAddressResponse, BlockchainComTransaction } from './blockchain-com.types.js';

@RegisterApiClient({
  apiKeyEnvVar: 'BLOCKCHAIN_COM_API_KEY',
  baseUrl: 'https://blockchain.info',
  blockchain: 'bitcoin',
  capabilities: {
    supportedOperations: ['getRawAddressTransactions', 'getAddressBalances'],
  },
  defaultConfig: {
    rateLimit: {
      burstLimit: 8,
      requestsPerHour: 12960,
      requestsPerMinute: 120,
      requestsPerSecond: 0.4,
    },
    retries: 3,
    timeout: 10000,
  },
  description: 'Blockchain.com Bitcoin explorer API with transaction and balance data (no API key required)',
  displayName: 'Blockchain.com API',
  name: 'blockchain.com',
  requiresApiKey: false,
})
export class BlockchainComApiClient extends BaseApiClient {
  constructor(config: ProviderConfig) {
    super(config);

    this.logger.debug(`Initialized BlockchainComApiClient from registry metadata - BaseUrl: ${this.baseUrl}`);
  }

  async execute<T>(operation: ProviderOperation): Promise<T> {
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
        case 'getAddressBalances':
          return (await this.getAddressBalances({
            address: operation.address,
          })) as T;
        default:
          throw new Error(`Unsupported operation: ${operation.type}`);
      }
    } catch (error) {
      this.logger.error(
        `Operation execution failed - Type: ${operation.type}, Params: ${JSON.stringify(operation)}, Error: ${getErrorMessage(error)}, Stack: ${error instanceof Error ? error.stack : undefined}`
      );
      throw error;
    }
  }

  getHealthCheckConfig() {
    return {
      endpoint: '/latestblock',
      validate: (response: unknown) => {
        const data = response as { height?: number };
        return typeof data.height === 'number' && data.height > 0;
      },
    };
  }

  /**
   * Get raw address info for efficient gap scanning
   */
  private async getAddressBalances(params: { address: string }): Promise<AddressInfo> {
    const { address } = params;

    this.logger.debug(`Fetching raw address info - Address: ${maskAddress(address)}`);

    try {
      const addressInfo = await this.httpClient.get<BlockchainComAddressResponse>(`/rawaddr/${address}?limit=0`);

      // Convert satoshis to BTC
      const balanceBTC = (addressInfo.final_balance / 100000000).toString();

      this.logger.debug(`Successfully retrieved raw address info - Address: ${maskAddress(address)}`);

      return {
        balance: balanceBTC,
        txCount: addressInfo.n_tx,
      };
    } catch (error) {
      this.logger.error(
        `Failed to get raw address info - Address: ${maskAddress(address)}, Error: ${getErrorMessage(error)}`
      );
      throw error;
    }
  }

  /**
   * Get raw transaction data without transformation for wallet-aware parsing
   */
  private async getRawAddressTransactions(params: {
    address: string;
    since?: number | undefined;
  }): Promise<BlockchainComTransaction[]> {
    const { address, since } = params;

    this.logger.debug(`Fetching raw address transactions - Address: ${maskAddress(address)}`);

    try {
      // Use limit=50 to get the maximum transactions per request
      const addressData = await this.httpClient.get<BlockchainComAddressResponse>(`/rawaddr/${address}?limit=50`);

      if (!addressData.txs || addressData.txs.length === 0) {
        this.logger.debug(`No raw transactions found - Address: ${maskAddress(address)}`);
        return [];
      }

      let filteredTransactions = addressData.txs;

      // Filter by timestamp if 'since' is provided
      if (since) {
        filteredTransactions = addressData.txs.filter((tx) => {
          const timestamp = tx.time * 1000; // Convert to milliseconds
          return timestamp >= since;
        });

        this.logger.debug(
          `Filtered raw transactions by timestamp - OriginalCount: ${addressData.txs.length}, FilteredCount: ${filteredTransactions.length}`
        );
      }

      // Sort by timestamp (newest first)
      filteredTransactions.sort((a, b) => b.time - a.time);

      this.logger.debug(
        `Successfully retrieved raw address transactions - Address: ${maskAddress(address)}, TotalTransactions: ${filteredTransactions.length}`
      );

      return filteredTransactions;
    } catch (error) {
      this.logger.error(
        `Failed to get raw address transactions - Address: ${maskAddress(address)}, Error: ${getErrorMessage(error)}`
      );
      throw error;
    }
  }
}
