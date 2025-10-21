/**
 * BlockCypher Bitcoin API Client
 *
 * ⚠️ PERFORMANCE WARNING: This provider should be LOWER PRIORITY in the failover chain.
 *
 * BlockCypher's API design is inefficient for fetching address transactions:
 * - Initial call returns only transaction references (hashes)
 * - Requires separate API call for EACH transaction's full details
 * - Example: Genesis address with 50 transactions = 51 API requests (1 + 50)
 * - With 100 requests/hour limit, can only process ~2 high-transaction addresses per hour
 *
 * Prioritize mempool.space or blockchain.com which may offer more efficient batch endpoints.
 * Use BlockCypher as emergency fallback or for addresses with few transactions only.
 */

import { getErrorMessage, hasStringProperty, type BlockchainBalanceSnapshot } from '@exitbook/core';
import { err, ok, type Result } from 'neverthrow';

import { BaseApiClient } from '../../../core/blockchain/base/api-client.ts';
import type { ProviderConfig, ProviderOperation, TransactionWithRawData } from '../../../core/blockchain/index.ts';
import { RegisterApiClient } from '../../../core/blockchain/index.ts';
import { maskAddress } from '../../../core/blockchain/utils/address-utils.ts';
import type { BitcoinTransaction } from '../types.js';

import { BlockCypherTransactionMapper } from './blockcypher.mapper.ts';
import type { BlockCypherTransaction, BlockCypherAddress } from './blockcypher.types.js';

@RegisterApiClient({
  apiKeyEnvVar: 'BLOCKCYPHER_API_KEY',
  baseUrl: 'https://api.blockcypher.com/v1/btc/main',
  blockchain: 'bitcoin',
  capabilities: {
    supportedOperations: ['getAddressTransactions', 'getAddressBalances', 'hasAddressTransactions'],
  },
  defaultConfig: {
    rateLimit: {
      burstLimit: 5, // Allow short bursts
      requestsPerHour: 100, // Hard limit per BlockCypher docs
      requestsPerMinute: 100, // Spread out to ~600/hour equivalent, but capped by hourly limit
      requestsPerSecond: 3, // Conservative rate for sustained usage
    },
    retries: 3,
    timeout: 15000, // Longer timeout for BlockCypher
  },
  description:
    'Bitcoin blockchain API with high-performance transaction data and balance queries (API key optional for GET requests)',
  displayName: 'BlockCypher API',
  name: 'blockcypher',
  requiresApiKey: false,
})
export class BlockCypherApiClient extends BaseApiClient {
  private mapper: BlockCypherTransactionMapper;

  constructor(config: ProviderConfig) {
    super(config);
    this.mapper = new BlockCypherTransactionMapper();

    this.logger.debug(
      `Initialized BlockCypherApiClient from registry metadata - BaseUrl: ${this.baseUrl}, HasApiKey: ${this.apiKey !== 'YourApiKeyToken'}`
    );
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
      endpoint: '/',
      validate: (response: unknown) => {
        const data = response as { name?: string };
        return hasStringProperty(data, 'name');
      },
    };
  }

  private buildEndpoint(endpoint: string): string {
    if (this.apiKey) {
      const separator = endpoint.includes('?') ? '&' : '?';
      return `${endpoint}${separator}token=${this.apiKey}`;
    }
    return endpoint;
  }

  /**
   * Fetch a complete transaction with all inputs and outputs (handles pagination)
   */
  private async fetchCompleteTransaction(txHash: string): Promise<Result<BlockCypherTransaction, Error>> {
    const initialResult = await this.httpClient.get<BlockCypherTransaction>(
      this.buildEndpoint(`/txs/${txHash}?limit=100`)
    );

    if (initialResult.isErr()) {
      return err(initialResult.error);
    }

    const transaction = { ...initialResult.value };
    while (transaction.next_outputs) {
      this.logger.debug(`Fetching next outputs for transaction ${txHash}: ${transaction.next_outputs}`);

      const nextOutputsResult = await this.httpClient.get<{
        next_outputs?: string | undefined;
        outputs: BlockCypherTransaction['outputs'];
      }>(transaction.next_outputs.replace('https://api.blockcypher.com/v1/btc/main', ''));

      if (nextOutputsResult.isErr()) {
        this.logger.warn(
          `Failed to fetch paginated outputs for transaction ${txHash}: ${getErrorMessage(nextOutputsResult.error)}`
        );
        break; // Don't fail the entire transaction for pagination issues
      }

      const nextOutputsResponse = nextOutputsResult.value;
      transaction.outputs.push(...nextOutputsResponse.outputs);
      transaction.next_outputs = nextOutputsResponse.next_outputs;

      // Update output count
      if (transaction.vout_sz) {
        transaction.vout_sz = transaction.outputs.length;
      }
    }

    // Handle paginated inputs if needed (less common but possible)
    while (transaction.next_inputs) {
      this.logger.debug(`Fetching next inputs for transaction ${txHash}: ${transaction.next_inputs}`);

      const nextInputsResult = await this.httpClient.get<{
        inputs: BlockCypherTransaction['inputs'];
        next_inputs?: string | undefined;
      }>(transaction.next_inputs.replace('https://api.blockcypher.com/v1/btc/main', ''));

      if (nextInputsResult.isErr()) {
        this.logger.warn(
          `Failed to fetch paginated inputs for transaction ${txHash}: ${getErrorMessage(nextInputsResult.error)}`
        );
        break; // Don't fail the entire transaction for pagination issues
      }

      const nextInputsResponse = nextInputsResult.value;
      transaction.inputs.push(...nextInputsResponse.inputs);
      transaction.next_inputs = nextInputsResponse.next_inputs;

      // Update input count
      if (transaction.vin_sz) {
        transaction.vin_sz = transaction.inputs.length;
      }
    }

    this.logger.debug(
      `Complete transaction fetched - TxHash: ${txHash}, Inputs: ${transaction.inputs.length}, Outputs: ${transaction.outputs.length}${transaction.next_outputs || transaction.next_inputs ? ' (had pagination)' : ''}`
    );

    return ok(transaction);
  }

  /**
   * Check if address has any transactions
   */
  private async hasAddressTransactions(params: { address: string }): Promise<Result<boolean, Error>> {
    const { address } = params;

    this.logger.debug(`Checking if address has transactions - Address: ${maskAddress(address)}`);

    const result = await this.httpClient.get<BlockCypherAddress>(this.buildEndpoint(`/addrs/${address}/balance`));

    if (result.isErr()) {
      this.logger.error(
        `Failed to check address transactions - Address: ${maskAddress(address)}, Error: ${getErrorMessage(result.error)}`
      );
      return err(result.error);
    }

    const addressInfo = result.value;
    const hasTransactions = addressInfo.final_n_tx > 0;

    this.logger.debug(
      `Address transaction check complete - Address: ${maskAddress(address)}, HasTransactions: ${hasTransactions}`
    );

    return ok(hasTransactions);
  }

  /**
   * Get raw address info
   */
  private async getAddressBalances(params: { address: string }): Promise<Result<BlockchainBalanceSnapshot, Error>> {
    const { address } = params;

    this.logger.debug(`Fetching raw address info - Address: ${maskAddress(address)}`);

    const result = await this.httpClient.get<BlockCypherAddress>(this.buildEndpoint(`/addrs/${address}/balance`));

    if (result.isErr()) {
      this.logger.error(
        `Failed to get raw address info - Address: ${maskAddress(address)}, Error: ${getErrorMessage(result.error)}`
      );
      return err(result.error);
    }

    const addressInfo = result.value;

    const balanceBTC = (addressInfo.final_balance / 100000000).toString();

    this.logger.debug(
      `Successfully retrieved raw address info - Address: ${maskAddress(address)}, Balance: ${addressInfo.final_balance}`
    );

    return ok({
      total: balanceBTC,
      asset: 'BTC',
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

    const result = await this.httpClient.get<BlockCypherAddress>(this.buildEndpoint(`/addrs/${address}?limit=50`));

    if (result.isErr()) {
      this.logger.error(
        `Failed to get raw address transactions - Address: ${maskAddress(address)}, Error: ${getErrorMessage(result.error)}`
      );
      return err(result.error);
    }

    const addressInfo = result.value;

    if (!addressInfo.txrefs || addressInfo.txrefs.length === 0) {
      this.logger.debug(`No raw transactions found for address - Address: ${maskAddress(address)}`);
      return ok([]);
    }

    this.logger.debug(
      `Retrieved transaction references - Address: ${maskAddress(address)}, Count: ${addressInfo.txrefs.length}`
    );

    // Extract unique transaction hashes
    const uniqueTxHashes = [...new Set(addressInfo.txrefs?.map((ref) => ref.tx_hash) ?? [])];

    // Fetch detailed raw transaction data sequentially and normalize immediately
    // Rate limiting is handled by the provider manager's rate limiter
    const transactions: TransactionWithRawData<BitcoinTransaction>[] = [];

    for (const txHash of uniqueTxHashes) {
      const txResult = await this.fetchCompleteTransaction(txHash);

      if (txResult.isErr()) {
        this.logger.warn(
          `Failed to fetch raw transaction details - TxHash: ${txHash}, Error: ${getErrorMessage(txResult.error)}`
        );
        continue;
      }

      const rawTx = txResult.value;

      // Normalize transaction immediately using mapper
      const mapResult = this.mapper.map(rawTx, {});

      if (mapResult.isErr()) {
        // Fail fast - provider returned invalid data
        const errorMessage = mapResult.error.type === 'error' ? mapResult.error.message : mapResult.error.reason;
        this.logger.error(`Provider data validation failed - Address: ${maskAddress(address)}, Error: ${errorMessage}`);
        return err(new Error(`Provider data validation failed: ${errorMessage}`));
      }

      transactions.push({
        raw: rawTx,
        normalized: mapResult.value,
      });
    }

    // Filter by timestamp if 'since' is provided
    let filteredTransactions: TransactionWithRawData<BitcoinTransaction>[] = transactions;
    if (since) {
      filteredTransactions = transactions.filter((tx) => {
        return tx.normalized.timestamp >= since;
      });
      this.logger.debug(
        `Filtered transactions by timestamp - OriginalCount: ${transactions.length}, FilteredCount: ${filteredTransactions.length}, Since: ${since}`
      );
    }

    // Sort by timestamp (newest first)
    filteredTransactions.sort((a, b) => b.normalized.timestamp - a.normalized.timestamp);

    this.logger.debug(
      `Successfully retrieved and normalized address transactions - Address: ${maskAddress(address)}, TotalTransactions: ${filteredTransactions.length}`
    );

    return ok(filteredTransactions);
  }
}
