import { getErrorMessage } from '@exitbook/core';
import { err, ok, type Result } from 'neverthrow';

import { BaseApiClient } from '../../../core/blockchain/base/api-client.ts';
import type { ProviderConfig, ProviderOperation, TransactionWithRawData } from '../../../core/blockchain/index.ts';
import { RegisterApiClient } from '../../../core/blockchain/index.ts';
import { maskAddress } from '../../../core/blockchain/utils/address-utils.ts';
import type { AddressInfo, BitcoinTransaction } from '../types.js';

import { BlockchainComTransactionMapper } from './blockchain-com.mapper.ts';
import type { BlockchainComAddressResponse } from './blockchain-com.types.js';

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
  private mapper: BlockchainComTransactionMapper;

  constructor(config: ProviderConfig) {
    super(config);
    this.mapper = new BlockchainComTransactionMapper();

    this.logger.debug(`Initialized BlockchainComApiClient from registry metadata - BaseUrl: ${this.baseUrl}`);
  }

  async execute<T>(operation: ProviderOperation): Promise<Result<T, Error>> {
    this.logger.debug(
      `Executing operation - Type: ${operation.type}, Address: ${'address' in operation ? maskAddress(operation.address as string) : 'N/A'}`
    );

    switch (operation.type) {
      case 'getRawAddressTransactions':
        return (await this.getRawAddressTransactions({
          address: operation.address,
          since: operation.since,
        })) as Result<T, Error>;
      case 'getAddressBalances':
        return (await this.getAddressBalances({
          address: operation.address,
        })) as Result<T, Error>;
      default:
        return err(new Error(`Unsupported operation: ${operation.type}`));
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
  private async getAddressBalances(params: { address: string }): Promise<Result<AddressInfo, Error>> {
    const { address } = params;

    this.logger.debug(`Fetching raw address info - Address: ${maskAddress(address)}`);

    const result = await this.httpClient.get<BlockchainComAddressResponse>(`/rawaddr/${address}?limit=0`);

    if (result.isErr()) {
      this.logger.error(
        `Failed to get raw address info - Address: ${maskAddress(address)}, Error: ${getErrorMessage(result.error)}`
      );
      return err(result.error);
    }

    const addressInfo = result.value;

    const balanceBTC = (addressInfo.final_balance / 100000000).toString();

    this.logger.debug(`Successfully retrieved raw address info - Address: ${maskAddress(address)}`);

    return ok({
      balance: balanceBTC,
      txCount: addressInfo.n_tx,
    });
  }

  /**
   * Get raw transaction data without transformation for wallet-aware parsing
   */
  private async getRawAddressTransactions(params: {
    address: string;
    since?: number | undefined;
  }): Promise<Result<TransactionWithRawData<BitcoinTransaction>[], Error>> {
    const { address, since } = params;

    this.logger.debug(`Fetching raw address transactions - Address: ${maskAddress(address)}`);

    const result = await this.httpClient.get<BlockchainComAddressResponse>(`/rawaddr/${address}?limit=50`);

    if (result.isErr()) {
      this.logger.error(
        `Failed to get raw address transactions - Address: ${maskAddress(address)}, Error: ${getErrorMessage(result.error)}`
      );
      return err(result.error);
    }

    const addressData = result.value;

    if (!addressData.txs || addressData.txs.length === 0) {
      this.logger.debug(`No raw transactions found - Address: ${maskAddress(address)}`);
      return ok([]);
    }

    let filteredRawTransactions = addressData.txs;

    // Filter by timestamp if 'since' is provided
    if (since) {
      filteredRawTransactions = addressData.txs.filter((tx) => {
        const timestamp = tx.time * 1000; // Convert to milliseconds
        return timestamp >= since;
      });

      this.logger.debug(
        `Filtered raw transactions by timestamp - OriginalCount: ${addressData.txs.length}, FilteredCount: ${filteredRawTransactions.length}`
      );
    }

    // Sort by timestamp (newest first)
    filteredRawTransactions.sort((a, b) => b.time - a.time);

    // Normalize transactions immediately using mapper
    const transactions: TransactionWithRawData<BitcoinTransaction>[] = [];
    for (const rawTx of filteredRawTransactions) {
      const mapResult = this.mapper.map(rawTx, { providerId: 'blockchain.com', sourceAddress: address }, {});

      if (mapResult.isErr()) {
        const errorMessage = mapResult.error.type === 'error' ? mapResult.error.message : mapResult.error.reason;
        this.logger.error(`Provider data validation failed - Address: ${maskAddress(address)}, Error: ${errorMessage}`);
        return err(new Error(`Provider data validation failed: ${errorMessage}`));
      }

      transactions.push({
        raw: rawTx,
        normalized: mapResult.value,
      });
    }

    this.logger.debug(
      `Successfully retrieved and normalized address transactions - Address: ${maskAddress(address)}, TotalTransactions: ${transactions.length}`
    );

    return ok(transactions);
  }
}
