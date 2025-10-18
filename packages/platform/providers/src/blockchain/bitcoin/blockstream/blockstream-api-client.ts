import { getErrorMessage, type BlockchainBalanceSnapshot } from '@exitbook/core';
import { err, ok, type Result } from 'neverthrow';

import { BaseApiClient } from '../../../core/blockchain/base/api-client.ts';
import type { ProviderConfig } from '../../../core/blockchain/index.ts';
import { RegisterApiClient } from '../../../core/blockchain/index.ts';
import type { ProviderOperation, TransactionWithRawData } from '../../../core/blockchain/types/index.ts';
import { maskAddress } from '../../../core/blockchain/utils/address-utils.ts';
import type { BitcoinTransaction } from '../types.js';

import { BlockstreamTransactionMapper } from './blockstream.mapper.ts';
import type { BlockstreamAddressInfo, BlockstreamTransaction } from './blockstream.types.js';

@RegisterApiClient({
  apiKeyEnvVar: 'BLOCKSTREAM_API_KEY',
  baseUrl: 'https://blockstream.info/api',
  blockchain: 'bitcoin',
  capabilities: {
    supportedOperations: ['getAddressTransactions', 'getAddressBalances', 'hasAddressTransactions'],
  },
  defaultConfig: {
    rateLimit: {
      burstLimit: 15,
      requestsPerHour: 12960,
      requestsPerMinute: 216,
      requestsPerSecond: 4,
    },
    retries: 3,
    timeout: 10000,
  },
  description:
    'Bitcoin blockchain explorer API with comprehensive transaction data and pagination support (no API key required)',
  displayName: 'Blockstream.info API',
  name: 'blockstream.info',
  requiresApiKey: false,
})
export class BlockstreamApiClient extends BaseApiClient {
  private mapper: BlockstreamTransactionMapper;

  constructor(config: ProviderConfig) {
    super(config);
    this.mapper = new BlockstreamTransactionMapper();

    this.logger.debug(`Initialized BlockstreamApiClient from registry metadata - BaseUrl: ${this.baseUrl}`);
  }

  async execute<T>(operation: ProviderOperation): Promise<Result<T, Error>> {
    this.logger.debug(
      `Executing operation - Type: ${operation.type}, Address: ${'address' in operation ? maskAddress(operation.address) : 'N/A'}`
    );

    switch (operation.type) {
      case 'getAddressTransactions':
        return (await this.getAddressTransactions({
          address: operation.address,
          since: operation.since,
        })) as Result<T, Error>;
      case 'getAddressBalances':
        return (await this.getAddressBalances({
          address: operation.address,
        })) as Result<T, Error>;
      case 'hasAddressTransactions':
        return (await this.hasAddressTransactions({
          address: operation.address,
        })) as Result<T, Error>;
      default:
        return err(new Error(`Unsupported operation: ${operation.type}`));
    }
  }

  getHealthCheckConfig() {
    return {
      endpoint: '/blocks/tip/height',
      validate: (response: unknown) => {
        return typeof response === 'number' && response > 0;
      },
    };
  }

  /**
   * Check if address has any transactions
   */
  private async hasAddressTransactions(params: { address: string }): Promise<Result<boolean, Error>> {
    const { address } = params;

    this.logger.debug(`Checking if address has transactions - Address: ${maskAddress(address)}`);

    const result = await this.httpClient.get<BlockstreamAddressInfo>(`/address/${address}`);

    if (result.isErr()) {
      this.logger.error(
        `Failed to check address transactions - Address: ${maskAddress(address)}, Error: ${getErrorMessage(result.error)}`
      );
      return err(result.error);
    }

    const addressInfo = result.value;
    const txCount = addressInfo.chain_stats.tx_count + addressInfo.mempool_stats.tx_count;
    const hasTransactions = txCount > 0;

    this.logger.debug(
      `Address transaction check complete - Address: ${maskAddress(address)}, HasTransactions: ${hasTransactions}`
    );

    return ok(hasTransactions);
  }

  /**
   * Get lightweight address info for efficient gap scanning
   */
  private async getAddressBalances(params: { address: string }): Promise<Result<BlockchainBalanceSnapshot, Error>> {
    const { address } = params;

    this.logger.debug(`Fetching lightweight address info - Address: ${maskAddress(address)}`);

    const result = await this.httpClient.get<BlockstreamAddressInfo>(`/address/${address}`);

    if (result.isErr()) {
      this.logger.error(
        `Failed to get address info - Address: ${maskAddress(address)}, Error: ${getErrorMessage(result.error)}`
      );
      return err(result.error);
    }

    const addressInfo = result.value;

    const chainBalance = addressInfo.chain_stats.funded_txo_sum - addressInfo.chain_stats.spent_txo_sum;
    const mempoolBalance = addressInfo.mempool_stats.funded_txo_sum - addressInfo.mempool_stats.spent_txo_sum;
    const totalBalanceSats = chainBalance + mempoolBalance;

    const balanceBTC = (totalBalanceSats / 100000000).toString();

    this.logger.debug(
      `Successfully retrieved lightweight address info - Address: ${maskAddress(address)}, BalanceBTC: ${balanceBTC}`
    );

    return ok({
      total: balanceBTC,
      symbol: 'BTC',
    });
  }

  /**
   * Get raw transaction data without transformation for wallet-aware parsing
   */
  private async getAddressTransactions(params: {
    address: string;
    since?: number | undefined;
  }): Promise<Result<TransactionWithRawData<BitcoinTransaction>[], Error>> {
    const { address, since } = params;

    this.logger.debug(`Fetching raw address transactions - Address: ${maskAddress(address)}, Since: ${since}`);

    const addressInfoResult = await this.httpClient.get<BlockstreamAddressInfo>(`/address/${address}`);

    if (addressInfoResult.isErr()) {
      this.logger.error(
        `Failed to get raw address transactions - Address: ${maskAddress(address)}, Error: ${getErrorMessage(addressInfoResult.error)}`
      );
      return err(addressInfoResult.error);
    }

    const addressInfo = addressInfoResult.value;

    if (addressInfo.chain_stats.tx_count === 0 && addressInfo.mempool_stats.tx_count === 0) {
      this.logger.debug(`No raw transactions found for address - Address: ${maskAddress(address)}`);
      return ok([]);
    }

    const allTransactions: TransactionWithRawData<BitcoinTransaction>[] = [];
    let lastSeenTxid: string | undefined;
    let hasMore = true;
    let batchCount = 0;
    const maxBatches = 50;

    while (hasMore && batchCount < maxBatches) {
      const endpoint = lastSeenTxid ? `/address/${address}/txs/chain/${lastSeenTxid}` : `/address/${address}/txs`;

      const txResult = await this.httpClient.get<BlockstreamTransaction[]>(endpoint);

      if (txResult.isErr()) {
        this.logger.error(
          `Failed to get raw address transactions batch - Address: ${maskAddress(address)}, Error: ${getErrorMessage(txResult.error)}`
        );
        return err(txResult.error);
      }

      const rawTransactions = txResult.value;

      if (!Array.isArray(rawTransactions) || rawTransactions.length === 0) {
        hasMore = false;
        break;
      }

      this.logger.debug(
        `Retrieved raw transaction batch - Address: ${maskAddress(address)}, BatchSize: ${rawTransactions.length}, Batch: ${batchCount + 1}`
      );

      const validRawTransactions = rawTransactions.filter((tx): tx is BlockstreamTransaction => tx !== null);
      for (const rawTx of validRawTransactions) {
        const mapResult = this.mapper.map(rawTx, { providerId: 'blockstream.info', sourceAddress: address }, {});

        if (mapResult.isErr()) {
          const errorMessage = mapResult.error.type === 'error' ? mapResult.error.message : mapResult.error.reason;
          this.logger.error(
            `Provider data validation failed - Address: ${maskAddress(address)}, Error: ${errorMessage}`
          );
          return err(new Error(`Provider data validation failed: ${errorMessage}`));
        }

        allTransactions.push({
          raw: rawTx,
          normalized: mapResult.value,
        });
      }

      lastSeenTxid = rawTransactions.length > 0 ? rawTransactions[rawTransactions.length - 1]?.txid : undefined;
      hasMore = rawTransactions.length === 25;
      batchCount++;
    }

    this.logger.debug(
      `Successfully retrieved and normalized address transactions - Address: ${maskAddress(address)}, TotalTransactions: ${allTransactions.length}, BatchesProcessed: ${batchCount}`
    );

    return ok(allTransactions);
  }
}
