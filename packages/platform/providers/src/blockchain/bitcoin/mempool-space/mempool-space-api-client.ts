import { getErrorMessage } from '@exitbook/core';
import { err, ok, type Result } from 'neverthrow';

import { BaseApiClient } from '../../../shared/blockchain/base/api-client.ts';
import type { ProviderConfig } from '../../../shared/blockchain/index.ts';
import { RegisterApiClient } from '../../../shared/blockchain/index.ts';
import type {
  ProviderOperation,
  RawBalanceData,
  TransactionWithRawData,
} from '../../../shared/blockchain/types/index.ts';
import { maskAddress } from '../../../shared/blockchain/utils/address-utils.ts';
import type { BitcoinTransaction } from '../schemas.js';

import { MempoolSpaceTransactionMapper } from './mempool-space.mapper.ts';
import type { MempoolAddressInfo, MempoolTransaction } from './mempool-space.schemas.js';

@RegisterApiClient({
  baseUrl: 'https://mempool.space/api',
  blockchain: 'bitcoin',
  capabilities: {
    supportedOperations: ['getAddressTransactions', 'getAddressBalances', 'hasAddressTransactions'],
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
  description: 'Bitcoin blockchain explorer API with comprehensive transaction and balance data (no API key required)',
  displayName: 'Mempool.space API',
  name: 'mempool.space',
  requiresApiKey: false,
})
export class MempoolSpaceApiClient extends BaseApiClient {
  private mapper: MempoolSpaceTransactionMapper;

  constructor(config: ProviderConfig) {
    super(config);
    this.mapper = new MempoolSpaceTransactionMapper();

    this.logger.debug(`Initialized MempoolSpaceApiClient from registry metadata - BaseUrl: ${this.baseUrl}`);
  }

  async execute<T>(operation: ProviderOperation): Promise<Result<T, Error>> {
    this.logger.debug(
      `Executing operation - Type: ${operation.type}, Address: ${'address' in operation ? maskAddress(operation.address) : 'N/A'}`
    );

    switch (operation.type) {
      case 'getAddressTransactions':
        return (await this.getAddressTransactions({
          address: operation.address,
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

    const result = await this.httpClient.get<MempoolAddressInfo>(`/address/${address}`);

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
  private async getAddressBalances(params: { address: string }): Promise<Result<RawBalanceData, Error>> {
    const { address } = params;

    this.logger.debug(`Fetching lightweight address info - Address: ${maskAddress(address)}`);

    const result = await this.httpClient.get<MempoolAddressInfo>(`/address/${address}`);

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
      rawAmount: totalBalanceSats.toString(),
      symbol: 'BTC',
      decimals: 8,
      decimalAmount: balanceBTC,
    } as RawBalanceData);
  }

  private async getAddressTransactions(params: {
    address: string;
  }): Promise<Result<TransactionWithRawData<BitcoinTransaction>[], Error>> {
    const { address } = params;

    this.logger.debug(`Fetching raw address transactions - Address: ${maskAddress(address)}`);

    const result = await this.httpClient.get<MempoolTransaction[]>(`/address/${address}/txs`);

    if (result.isErr()) {
      this.logger.error(
        `Failed to get raw address transactions - Address: ${maskAddress(address)}, Error: ${getErrorMessage(result.error)}`
      );
      return err(result.error);
    }

    const rawTransactions = result.value;

    if (!Array.isArray(rawTransactions) || rawTransactions.length === 0) {
      this.logger.debug(`No raw transactions found - Address: ${maskAddress(address)}`);
      return ok([]);
    }

    const transactions: TransactionWithRawData<BitcoinTransaction>[] = [];
    for (const rawTx of rawTransactions) {
      const mapResult = this.mapper.map(rawTx, {});

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
      `Successfully retrieved and normalized transactions - Address: ${maskAddress(address)}, Count: ${transactions.length}`
    );

    return ok(transactions);
  }
}
