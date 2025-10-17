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

import { getErrorMessage, hasStringProperty } from '@exitbook/core';
import { err, ok, type Result } from 'neverthrow';

import { BaseApiClient } from '../../../core/blockchain/base/api-client.ts';
import type { ProviderConfig, ProviderOperation } from '../../../core/blockchain/index.ts';
import { RegisterApiClient } from '../../../core/blockchain/index.ts';
import { maskAddress } from '../../../core/blockchain/utils/address-utils.ts';
import type { AddressInfo } from '../types.js';

import type { BlockCypherTransaction, BlockCypherAddress } from './blockcypher.types.js';

@RegisterApiClient({
  apiKeyEnvVar: 'BLOCKCYPHER_API_KEY',
  baseUrl: 'https://api.blockcypher.com/v1/btc/main',
  blockchain: 'bitcoin',
  capabilities: {
    supportedOperations: ['getRawAddressTransactions', 'getAddressBalances'],
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
  constructor(config: ProviderConfig) {
    super(config);

    this.logger.debug(
      `Initialized BlockCypherApiClient from registry metadata - BaseUrl: ${this.baseUrl}, HasApiKey: ${this.apiKey !== 'YourApiKeyToken'}`
    );
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
    // First, fetch transaction with higher limit to reduce pagination
    const initialResult = await this.httpClient.get<BlockCypherTransaction>(
      this.buildEndpoint(`/txs/${txHash}?limit=100`)
    );

    if (initialResult.isErr()) {
      return err(initialResult.error);
    }

    // Handle paginated outputs if needed
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
   * Get raw address info
   */
  private async getAddressBalances(params: { address: string }): Promise<Result<AddressInfo, Error>> {
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

    // Get transaction count (final_n_tx includes confirmed transactions)
    const txCount = addressInfo.final_n_tx;

    // Get balance in BTC (BlockCypher returns in satoshis)
    const balanceBTC = (addressInfo.final_balance / 100000000).toString();

    this.logger.debug(
      `Successfully retrieved raw address info - Address: ${maskAddress(address)}, TxCount: ${txCount}, Balance: ${addressInfo.final_balance}`
    );

    return ok({
      balance: balanceBTC,
      txCount,
    });
  }

  /**
   * Get raw transaction data without transformation for wallet-aware parsing
   */
  private async getRawAddressTransactions(params: {
    address: string;
    since?: number | undefined;
  }): Promise<Result<BlockCypherTransaction[], Error>> {
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
    const uniqueTxHashes = Array.from(new Set(addressInfo.txrefs.map((ref) => ref.tx_hash)));

    // Fetch detailed raw transaction data sequentially
    // Rate limiting is handled by the provider manager's rate limiter
    const rawTransactions: BlockCypherTransaction[] = [];

    for (const txHash of uniqueTxHashes) {
      const txResult = await this.fetchCompleteTransaction(txHash);

      if (txResult.isErr()) {
        this.logger.warn(
          `Failed to fetch raw transaction details - TxHash: ${txHash}, Error: ${getErrorMessage(txResult.error)}`
        );
        continue;
      }

      rawTransactions.push(txResult.value);
    }

    // Filter by timestamp if 'since' is provided
    let filteredRawTransactions = rawTransactions;
    if (since) {
      filteredRawTransactions = rawTransactions.filter((tx) => {
        const confirmedTime = tx.confirmed ? new Date(tx.confirmed).getTime() : Date.now();
        return confirmedTime >= since;
      });
      this.logger.debug(
        `Filtered raw transactions by timestamp - OriginalCount: ${rawTransactions.length}, FilteredCount: ${filteredRawTransactions.length}, Since: ${since}`
      );
    }

    // Sort by timestamp (newest first)
    filteredRawTransactions.sort((a, b) => {
      const aTime = a.confirmed ? new Date(a.confirmed).getTime() : 0;
      const bTime = b.confirmed ? new Date(b.confirmed).getTime() : 0;
      return bTime - aTime;
    });

    this.logger.debug(
      `Successfully retrieved raw address transactions - Address: ${maskAddress(address)}, TotalRawTransactions: ${filteredRawTransactions.length}`
    );

    return ok(filteredRawTransactions);
  }
}
