import { getErrorMessage } from '@exitbook/core';
import { err, ok, type Result } from 'neverthrow';

import { BaseApiClient } from '../../../shared/blockchain/base/api-client.js';
import type { ProviderConfig } from '../../../shared/blockchain/index.js';
import { RegisterApiClient } from '../../../shared/blockchain/index.js';
import type { ProviderOperation, TransactionWithRawData } from '../../../shared/blockchain/types/index.js';
import { maskAddress } from '../../../shared/blockchain/utils/address-utils.js';
import type { CardanoTransaction } from '../schemas.js';

import { BlockfrostTransactionMapper } from './blockfrost.mapper.js';
import type { BlockfrostTransactionHash, BlockfrostTransactionWithMetadata } from './blockfrost.schemas.js';
import { BlockfrostTransactionDetailsSchema, BlockfrostTransactionUtxosSchema } from './blockfrost.schemas.js';

/**
 * Blockfrost API client for Cardano blockchain data.
 *
 * Implements a three-call pattern to fetch complete transaction data:
 * 1. GET /addresses/{address}/transactions - Fetches transaction hashes with basic metadata
 * 2. GET /txs/{hash} - Fetches complete transaction details including fees and block info
 * 3. GET /txs/{hash}/utxos - Fetches detailed UTXO data for each transaction
 *
 * Blockfrost requires an API key provided via the BLOCKFROST_API_KEY environment variable.
 * The API key is sent in the "project_id" header for authentication.
 *
 * Rate limits: Default 10 req/sec with burst limit of 500 req/min.
 */
@RegisterApiClient({
  apiKeyEnvVar: 'BLOCKFROST_API_KEY',
  baseUrl: 'https://cardano-mainnet.blockfrost.io/api/v0',
  blockchain: 'cardano',
  capabilities: {
    supportedOperations: ['getAddressTransactions', 'getAddressBalances'],
  },
  defaultConfig: {
    rateLimit: {
      burstLimit: 500,
      requestsPerHour: 36000,
      requestsPerMinute: 600,
      requestsPerSecond: 10,
    },
    retries: 3,
    timeout: 15000,
  },
  description: 'Cardano blockchain API with comprehensive transaction and UTXO data',
  displayName: 'Blockfrost Cardano API',
  name: 'blockfrost',
  requiresApiKey: true,
})
export class BlockfrostApiClient extends BaseApiClient {
  private mapper: BlockfrostTransactionMapper;

  constructor(config: ProviderConfig) {
    super(config);
    this.mapper = new BlockfrostTransactionMapper();

    this.logger.debug(`Initialized BlockfrostApiClient from registry metadata - BaseUrl: ${this.baseUrl}`);
  }

  async execute<T>(operation: ProviderOperation): Promise<Result<T, Error>> {
    this.logger.debug(
      `Executing operation - Type: ${operation.type}, Address: ${'address' in operation ? maskAddress(operation.address) : 'N/A'}`
    );

    switch (operation.type) {
      case 'getAddressTransactions':
        return (await this.getAddressTransactions({
          address: operation.address,
          limit: 'limit' in operation ? (operation.limit as number) : undefined,
        })) as Result<T, Error>;
      case 'getAddressBalances':
        return err(new Error('getAddressBalances not yet implemented for Blockfrost')) as Result<T, Error>;
      default:
        return err(new Error(`Unsupported operation: ${operation.type}`));
    }
  }

  getHealthCheckConfig() {
    return {
      endpoint: '/health',
      validate: (response: unknown) => {
        return typeof response === 'object' && response !== null && 'is_healthy' in response;
      },
    };
  }

  /**
   * Get raw transaction data for an address using three-call pattern.
   *
   * Step 1: Fetch transaction hashes from /addresses/{address}/transactions
   * Step 2: For each transaction hash, fetch complete transaction details from /txs/{hash}
   * Step 3: For each transaction hash, fetch detailed UTXO data from /txs/{hash}/utxos
   *
   * Handles pagination automatically (100 transactions per page).
   * Combines transaction details and UTXO data before passing to mapper for normalization.
   *
   * @param params - Parameters containing the Cardano address and optional limit
   * @returns Result containing array of transactions with raw and normalized data
   */
  private async getAddressTransactions(params: {
    address: string;
    limit?: number | undefined;
  }): Promise<Result<TransactionWithRawData<CardanoTransaction>[], Error>> {
    const { address, limit } = params;

    this.logger.debug(
      `Fetching raw address transactions - Address: ${maskAddress(address)}, Limit: ${limit ?? 'none'}`
    );

    // Step 1: Fetch all transaction hashes for the address
    const txHashesResult = await this.fetchTransactionHashes(address, limit);

    if (txHashesResult.isErr()) {
      this.logger.error(
        `Failed to fetch transaction hashes - Address: ${maskAddress(address)}, Error: ${getErrorMessage(txHashesResult.error)}`
      );
      return err(txHashesResult.error);
    }

    const txHashes = txHashesResult.value;

    if (txHashes.length === 0) {
      this.logger.debug(`No transactions found for address - Address: ${maskAddress(address)}`);
      return ok([]);
    }

    this.logger.debug(
      `Retrieved ${txHashes.length} transaction hashes - Address: ${maskAddress(address)}, fetching transaction details and UTXO data...`
    );

    // Step 2 & 3: Fetch transaction details and UTXO data for each transaction
    const allTransactions: TransactionWithRawData<CardanoTransaction>[] = [];

    for (const txHashEntry of txHashes) {
      const txHash = txHashEntry.tx_hash;

      // Fetch complete transaction details (including fees, block hash, status)
      const detailsResult = await this.httpClient.get<unknown>(`/txs/${txHash}`, {
        headers: { project_id: this.apiKey },
      });

      if (detailsResult.isErr()) {
        this.logger.error(
          `Failed to fetch transaction details - TxHash: ${txHash}, Address: ${maskAddress(address)}, Error: ${getErrorMessage(detailsResult.error)}`
        );
        return err(detailsResult.error);
      }

      // Validate the transaction details response
      const parseResult = BlockfrostTransactionDetailsSchema.safeParse(detailsResult.value);
      if (!parseResult.success) {
        const errorMsg = `Invalid transaction details response: ${parseResult.error.message}`;
        this.logger.error(`${errorMsg} - TxHash: ${txHash}`);
        return err(new Error(errorMsg));
      }

      const txDetails = parseResult.data;

      // Fetch UTXO details for this transaction
      const utxoResult = await this.httpClient.get<unknown>(`/txs/${txHash}/utxos`, {
        headers: { project_id: this.apiKey },
      });

      if (utxoResult.isErr()) {
        this.logger.error(
          `Failed to fetch UTXO data for transaction - TxHash: ${txHash}, Address: ${maskAddress(address)}, Error: ${getErrorMessage(utxoResult.error)}`
        );
        return err(utxoResult.error);
      }

      // Validate the UTXO response
      const utxoParseResult = BlockfrostTransactionUtxosSchema.safeParse(utxoResult.value);
      if (!utxoParseResult.success) {
        const errorMsg = `Invalid UTXO response: ${utxoParseResult.error.message}`;
        this.logger.error(`${errorMsg} - TxHash: ${txHash}`);
        return err(new Error(errorMsg));
      }

      const rawUtxo = utxoParseResult.data;

      // Combine UTXO data with transaction metadata
      const combinedData: BlockfrostTransactionWithMetadata = {
        ...rawUtxo,
        block_height: txDetails.block_height,
        block_time: txDetails.block_time,
        block_hash: txDetails.block,
        fees: txDetails.fees,
        tx_index: txHashEntry.tx_index,
        valid_contract: txDetails.valid_contract,
      };

      // Map and validate the combined data
      const mapResult = this.mapper.map(combinedData, {});

      if (mapResult.isErr()) {
        const errorMessage = mapResult.error.type === 'error' ? mapResult.error.message : mapResult.error.reason;
        this.logger.error(
          `Provider data validation failed - TxHash: ${txHash}, Address: ${maskAddress(address)}, Error: ${errorMessage}`
        );
        return err(new Error(`Provider data validation failed: ${errorMessage}`));
      }

      allTransactions.push({
        raw: combinedData,
        normalized: mapResult.value,
      });
    }

    this.logger.debug(
      `Successfully retrieved and normalized address transactions - Address: ${maskAddress(address)}, TotalTransactions: ${allTransactions.length}`
    );

    return ok(allTransactions);
  }

  /**
   * Fetch all transaction hashes for an address with pagination.
   *
   * Blockfrost returns up to 100 transactions per page in descending order (newest first).
   * This method handles pagination automatically to fetch all transactions.
   *
   * @param address - Cardano address to fetch transactions for
   * @param limit - Optional maximum number of transactions to fetch
   * @returns Result containing array of transaction hash entries
   */
  private async fetchTransactionHashes(
    address: string,
    limit?: number
  ): Promise<Result<BlockfrostTransactionHash[], Error>> {
    const allTxHashes: BlockfrostTransactionHash[] = [];
    let page = 1;
    let hasMore = true;
    const maxPages = 100; // Safety limit to prevent infinite loops

    while (hasMore && page <= maxPages) {
      // If a limit is specified, adjust the count to fetch only what's needed
      const remainingToFetch = limit !== undefined ? limit - allTxHashes.length : 100;
      const count = Math.min(remainingToFetch, 100);

      if (count <= 0) {
        break;
      }

      const endpoint = `/addresses/${address}/transactions?order=desc&count=${count}&page=${page}`;

      const result = await this.httpClient.get<BlockfrostTransactionHash[]>(endpoint, {
        headers: { project_id: this.apiKey },
      });

      if (result.isErr()) {
        this.logger.error(
          `Failed to fetch transaction hashes page - Address: ${maskAddress(address)}, Page: ${page}, Error: ${getErrorMessage(result.error)}`
        );
        return err(result.error);
      }

      const txHashes = result.value;

      if (!Array.isArray(txHashes) || txHashes.length === 0) {
        hasMore = false;
        break;
      }

      this.logger.debug(
        `Retrieved transaction hash batch - Address: ${maskAddress(address)}, Page: ${page}, BatchSize: ${txHashes.length}`
      );

      allTxHashes.push(...txHashes);

      // Stop if we've reached the limit
      if (limit !== undefined && allTxHashes.length >= limit) {
        break;
      }

      // If we got less than the requested count, we've reached the end
      hasMore = txHashes.length === count;
      page++;
    }

    if (page > maxPages) {
      this.logger.warn(
        `Reached maximum page limit - Address: ${maskAddress(address)}, Pages: ${maxPages}, Transactions: ${allTxHashes.length}`
      );
    }

    return ok(allTxHashes);
  }
}
