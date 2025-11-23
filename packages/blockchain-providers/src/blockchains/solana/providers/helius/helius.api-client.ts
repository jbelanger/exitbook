import type { CursorState, PaginationCursor, TokenMetadata } from '@exitbook/core';
import { getErrorMessage } from '@exitbook/core';
import { err, ok, type Result } from 'neverthrow';

import type {
  ProviderConfig,
  ProviderOperation,
  JsonRpcResponse,
  RawBalanceData,
  StreamingBatchResult,
  TransactionWithRawData,
} from '../../../../core/index.ts';
import { RegisterApiClient, BaseApiClient, maskAddress } from '../../../../core/index.ts';
import {
  createStreamingIterator,
  type StreamingPage,
  type StreamingPageContext,
} from '../../../../core/streaming/streaming-adapter.js';
import { transformSolBalance, transformTokenAccounts } from '../../balance-utils.ts';
import type { SolanaSignature, SolanaAccountBalance, SolanaTransaction } from '../../schemas.ts';
import type { SolanaTokenAccountsResponse } from '../../types.ts';
import { isValidSolanaAddress, deduplicateTransactionsBySignature } from '../../utils.ts';

import { mapHeliusTransaction } from './helius.mapper-utils.js';
import type { HeliusAssetResponse, HeliusTransaction } from './helius.schemas.js';
import {
  HeliusAssetJsonRpcResponseSchema,
  HeliusSignaturesJsonRpcResponseSchema,
  HeliusTransactionJsonRpcResponseSchema,
  HeliusBalanceJsonRpcResponseSchema,
  HeliusTokenAccountsJsonRpcResponseSchema,
} from './helius.schemas.js';

export interface SolanaRawBalanceData {
  lamports: number;
}

export interface SolanaRawTokenBalanceData {
  tokenAccounts: SolanaTokenAccountsResponse;
}

@RegisterApiClient({
  apiKeyEnvVar: 'HELIUS_API_KEY',
  baseUrl: 'https://rpc.helius.xyz',
  blockchain: 'solana',
  capabilities: {
    supportedOperations: [
      'getAddressTransactions',
      'getAddressBalances',
      'getAddressTokenBalances',
      'getAddressTokenTransactions',
      'getTokenMetadata',
    ],
    supportedCursorTypes: ['pageToken', 'blockNumber', 'timestamp'],
    preferredCursorType: 'pageToken',
  },
  defaultConfig: {
    rateLimit: {
      burstLimit: 10,
      requestsPerHour: 5000,
      requestsPerMinute: 500,
      requestsPerSecond: 5,
    },
    retries: 3,
    timeout: 30000,
  },
  description: 'High-performance Solana RPC API with comprehensive transaction data and token support',
  displayName: 'Helius RPC API',
  name: 'helius',
  requiresApiKey: true,
})
export class HeliusApiClient extends BaseApiClient {
  constructor(config: ProviderConfig) {
    super(config);

    if (this.apiKey && this.apiKey !== 'YourApiKeyToken') {
      const heliusUrl = `${this.baseUrl}/?api-key=${this.apiKey}`;
      this.reinitializeHttpClient({
        baseUrl: heliusUrl,
        defaultHeaders: {
          'Content-Type': 'application/json',
        },
      });
    }
  }

  extractCursors(transaction: SolanaTransaction): PaginationCursor[] {
    const cursors: PaginationCursor[] = [];

    // Primary cursor: signature (pageToken)
    if (transaction.id) {
      cursors.push({ type: 'pageToken', value: transaction.id, providerName: this.name });
    }

    if (transaction.timestamp) {
      cursors.push({ type: 'timestamp', value: transaction.timestamp });
    }

    if (transaction.blockHeight !== undefined) {
      cursors.push({ type: 'blockNumber', value: transaction.blockHeight });
    }

    return cursors;
  }

  applyReplayWindow(cursor: PaginationCursor): PaginationCursor {
    // Signature-based pagination is precise, no replay window needed
    return cursor;
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
      case 'getAddressTokenTransactions':
        return (await this.getAddressTokenTransactions({
          address: operation.address,
        })) as Result<T, Error>;
      case 'getAddressBalances':
        return (await this.getAddressBalances({
          address: operation.address,
        })) as Result<T, Error>;
      case 'getAddressTokenBalances':
        return (await this.getAddressTokenBalances({
          address: operation.address,
          contractAddresses: operation.contractAddresses,
        })) as Result<T, Error>;
      case 'getTokenMetadata':
        return (await this.getTokenMetadata(operation.contractAddress)) as Result<T, Error>;
      default:
        return err(new Error(`Unsupported operation: ${operation.type}`));
    }
  }

  async *executeStreaming<T>(
    operation: ProviderOperation,
    resumeCursor?: CursorState
  ): AsyncIterableIterator<Result<StreamingBatchResult<T>, Error>> {
    switch (operation.type) {
      case 'getAddressTransactions':
        yield* this.streamAddressTransactions(operation.address, resumeCursor) as AsyncIterableIterator<
          Result<StreamingBatchResult<T>, Error>
        >;
        break;
      case 'getAddressTokenTransactions':
        yield* this.streamAddressTokenTransactions(operation.address, resumeCursor) as AsyncIterableIterator<
          Result<StreamingBatchResult<T>, Error>
        >;
        break;
      default:
        yield err(new Error(`Streaming not yet implemented for operation: ${operation.type}`));
    }
  }

  getHealthCheckConfig() {
    return {
      body: {
        id: 1,
        jsonrpc: '2.0',
        method: 'getHealth',
      },
      endpoint: '/',
      method: 'POST' as const,
      validate: (response: unknown) => {
        const data = response as JsonRpcResponse<string>;
        return data?.result === 'ok';
      },
    };
  }

  async getTokenMetadata(mintAddress: string): Promise<Result<TokenMetadata, Error>> {
    const result = await this.httpClient.post<JsonRpcResponse<HeliusAssetResponse>>(
      '/',
      {
        id: 1,
        jsonrpc: '2.0',
        method: 'getAsset',
        params: {
          displayOptions: {
            showFungible: true,
          },
          id: mintAddress,
        },
      },
      { schema: HeliusAssetJsonRpcResponseSchema }
    );

    if (result.isErr()) {
      return err(result.error);
    }

    const response = result.value;
    if (!response?.result) {
      return err(new Error(`Token metadata not found for mint address: ${mintAddress}`));
    }

    const asset = response.result;
    return ok(this.extractTokenMetadata(asset, mintAddress));
  }

  private extractTokenMetadata(asset: HeliusAssetResponse, mintAddress: string): TokenMetadata {
    const metadata = asset.content?.metadata;
    const tokenInfo = asset.token_info;
    const links = asset.content?.links;

    return {
      contractAddress: mintAddress,
      decimals: tokenInfo?.decimals ?? undefined,
      logoUrl: links?.image ?? undefined,
      name: metadata?.name ?? undefined,
      symbol: metadata?.symbol ?? undefined,
    };
  }

  private async getDirectAddressTransactions(address: string): Promise<Result<HeliusTransaction[], Error>> {
    const signaturesResult = await this.httpClient.post<JsonRpcResponse<SolanaSignature[]>>(
      '/',
      {
        id: 1,
        jsonrpc: '2.0',
        method: 'getSignaturesForAddress',
        params: [
          address,
          {
            limit: 1000, // Get full transaction history
          },
        ],
      },
      { schema: HeliusSignaturesJsonRpcResponseSchema }
    );

    if (signaturesResult.isErr()) {
      this.logger.error(
        `Failed to get direct signatures - Address: ${maskAddress(address)}, Error: ${getErrorMessage(signaturesResult.error)}`
      );
      return err(signaturesResult.error);
    }

    const signaturesResponse = signaturesResult.value;

    if (!signaturesResponse?.result) {
      this.logger.debug(`No direct signatures found - Address: ${maskAddress(address)}`);
      return ok([]);
    }

    const transactions: HeliusTransaction[] = [];
    const signatures = signaturesResponse.result.slice(0, 200); // Process more historical transactions

    this.logger.debug(`Retrieved direct signatures - Address: ${maskAddress(address)}, Count: ${signatures.length}`);

    for (const sig of signatures) {
      const txResult = await this.httpClient.post<JsonRpcResponse<HeliusTransaction>>(
        '/',
        {
          id: 1,
          jsonrpc: '2.0',
          method: 'getTransaction',
          params: [
            sig.signature,
            {
              encoding: 'json',
              maxSupportedTransactionVersion: 0,
            },
          ],
        },
        { schema: HeliusTransactionJsonRpcResponseSchema }
      );

      if (txResult.isErr()) {
        this.logger.debug(
          `Failed to fetch transaction details - Signature: ${sig.signature}, Error: ${getErrorMessage(txResult.error)}`
        );
        continue;
      }

      const txResponse = txResult.value;

      if (txResponse?.result) {
        transactions.push(txResponse.result);
      }
    }

    return ok(transactions);
  }

  private async getAddressBalances(params: { address: string }): Promise<Result<RawBalanceData, Error>> {
    const { address } = params;

    if (!isValidSolanaAddress(address)) {
      return err(new Error(`Invalid Solana address: ${address}`));
    }

    this.logger.debug(`Fetching raw address balance - Address: ${maskAddress(address)}`);

    const result = await this.httpClient.post<JsonRpcResponse<SolanaAccountBalance>>(
      '/',
      {
        id: 1,
        jsonrpc: '2.0',
        method: 'getBalance',
        params: [address],
      },
      { schema: HeliusBalanceJsonRpcResponseSchema }
    );

    if (result.isErr()) {
      this.logger.error(
        `Failed to get raw address balance - Address: ${maskAddress(address)}, Error: ${getErrorMessage(result.error)}`
      );
      return err(result.error);
    }

    const response = result.value;

    if (!response?.result || response.result.value === undefined) {
      return err(new Error('Failed to fetch balance from Helius RPC'));
    }

    const balanceData = transformSolBalance(response.result.value);

    this.logger.debug(
      `Successfully retrieved raw address balance - Address: ${maskAddress(address)}, SOL: ${balanceData.decimalAmount}`
    );

    return ok(balanceData);
  }

  private async getAddressTransactions(params: {
    address: string;
  }): Promise<Result<TransactionWithRawData<SolanaTransaction>[], Error>> {
    const { address } = params;

    if (!isValidSolanaAddress(address)) {
      return err(new Error(`Invalid Solana address: ${address}`));
    }

    this.logger.debug(`Fetching raw address transactions - Address: ${maskAddress(address)}`);

    const directResult = await this.getDirectAddressTransactions(address);
    if (directResult.isErr()) {
      this.logger.error(
        `Failed to get raw address transactions - Address: ${maskAddress(address)}, Error: ${getErrorMessage(directResult.error)}`
      );
      return err(directResult.error);
    }

    const tokenResult = await this.getTokenAccountTransactions(address);
    if (tokenResult.isErr()) {
      this.logger.error(
        `Failed to get token account transactions - Address: ${maskAddress(address)}, Error: ${getErrorMessage(tokenResult.error)}`
      );
      return err(tokenResult.error);
    }

    const directTransactions = directResult.value;
    const tokenAccountTransactions = tokenResult.value;

    const allRawTransactions = [...directTransactions, ...tokenAccountTransactions];

    // Deduplicate transactions by signature (same tx can appear in both direct and token account lists)
    const uniqueTransactions = deduplicateTransactionsBySignature(allRawTransactions);

    this.logger.debug(
      `Deduplicated transactions - Address: ${maskAddress(address)}, Total: ${allRawTransactions.length}, Unique: ${uniqueTransactions.size}`
    );

    const transactions: TransactionWithRawData<SolanaTransaction>[] = [];
    for (const rawTx of uniqueTransactions.values()) {
      const mapResult = mapHeliusTransaction(rawTx, {});

      if (mapResult.isErr()) {
        const errorMessage = mapResult.error.type === 'error' ? mapResult.error.message : mapResult.error.reason;
        this.logger.error(`Provider data validation failed - Address: ${maskAddress(address)}, Error: ${errorMessage}`);
        return err(new Error(`Provider data validation failed: ${errorMessage}`));
      }

      transactions.push({
        normalized: mapResult.value,
        raw: rawTx,
      });
    }

    this.logger.debug(
      `Successfully retrieved and normalized transactions - Address: ${maskAddress(address)}, Count: ${transactions.length}`
    );

    return ok(transactions);
  }

  private async getAddressTokenTransactions(params: {
    address: string;
  }): Promise<Result<TransactionWithRawData<SolanaTransaction>[], Error>> {
    const { address } = params;

    if (!isValidSolanaAddress(address)) {
      return err(new Error(`Invalid Solana address: ${address}`));
    }

    this.logger.debug(`Fetching raw token address transactions - Address: ${maskAddress(address)}`);

    const tokenResult = await this.getTokenAccountTransactions(address);
    if (tokenResult.isErr()) {
      this.logger.error(
        `Failed to get raw token address transactions - Address: ${maskAddress(address)}, Error: ${getErrorMessage(tokenResult.error)}`
      );
      return err(tokenResult.error);
    }

    const transactions: TransactionWithRawData<SolanaTransaction>[] = [];
    for (const rawTx of tokenResult.value) {
      const mapResult = mapHeliusTransaction(rawTx, {});

      if (mapResult.isErr()) {
        const errorMessage = mapResult.error.type === 'error' ? mapResult.error.message : mapResult.error.reason;
        this.logger.error(`Provider data validation failed - Address: ${maskAddress(address)}, Error: ${errorMessage}`);
        return err(new Error(`Provider data validation failed: ${errorMessage}`));
      }

      transactions.push({
        normalized: mapResult.value,
        raw: rawTx,
      });
    }

    this.logger.debug(
      `Successfully retrieved and normalized token transactions - Address: ${maskAddress(address)}, Count: ${transactions.length}`
    );

    return ok(transactions);
  }

  private async getAddressTokenBalances(params: {
    address: string;
    contractAddresses?: string[] | undefined;
  }): Promise<Result<RawBalanceData[], Error>> {
    const { address } = params;

    if (!isValidSolanaAddress(address)) {
      return err(new Error(`Invalid Solana address: ${address}`));
    }

    this.logger.debug(`Fetching raw token balances - Address: ${maskAddress(address)}`);

    const result = await this.httpClient.post<JsonRpcResponse<SolanaTokenAccountsResponse>>(
      '/',
      {
        id: 1,
        jsonrpc: '2.0',
        method: 'getTokenAccountsByOwner',
        params: [
          address,
          {
            programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
          },
          {
            encoding: 'jsonParsed',
          },
        ],
      },
      { schema: HeliusTokenAccountsJsonRpcResponseSchema }
    );

    if (result.isErr()) {
      this.logger.error(
        `Failed to get raw token balances - Address: ${maskAddress(address)}, Error: ${getErrorMessage(result.error)}`
      );
      return err(result.error);
    }

    const tokenAccountsResponse = result.value;

    if (!tokenAccountsResponse?.result) {
      this.logger.debug(`No raw token accounts found - Address: ${maskAddress(address)}`);
      return ok([]);
    }

    const balances = transformTokenAccounts(tokenAccountsResponse.result.value);

    this.logger.debug(
      `Successfully retrieved raw token balances - Address: ${maskAddress(address)}, TokenAccountCount: ${balances.length}`
    );

    return ok(balances);
  }

  private async getTokenAccountsOwnedByAddress(address: string): Promise<Result<string[], Error>> {
    const result = await this.httpClient.post<JsonRpcResponse<SolanaTokenAccountsResponse>>(
      '/',
      {
        id: 1,
        jsonrpc: '2.0',
        method: 'getTokenAccountsByOwner',
        params: [
          address,
          {
            programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
          },
          {
            encoding: 'jsonParsed',
          },
        ],
      },
      { schema: HeliusTokenAccountsJsonRpcResponseSchema }
    );

    if (result.isErr()) {
      this.logger.warn(
        `Failed to get token accounts - Address: ${maskAddress(address)}, Error: ${getErrorMessage(result.error)}`
      );
      return ok([]);
    }

    const tokenAccountsResponse = result.value;

    if (!tokenAccountsResponse?.result?.value) {
      this.logger.debug(`No token accounts found - Address: ${maskAddress(address)}`);
      return ok([]);
    }

    const tokenAccountAddresses = tokenAccountsResponse.result.value.map(
      (account: { pubkey: string }) => account.pubkey
    );

    this.logger.debug(
      `Found token accounts owned by address - Address: ${maskAddress(address)}, TokenAccountCount: ${tokenAccountAddresses.length}`
    );

    return ok(tokenAccountAddresses);
  }

  private async getTokenAccountTransactions(address: string): Promise<Result<HeliusTransaction[], Error>> {
    this.logger.debug(`Fetching token account transactions - Address: ${maskAddress(address)}`);

    const tokenAccountsResult = await this.getTokenAccountsOwnedByAddress(address);
    if (tokenAccountsResult.isErr()) {
      this.logger.warn(
        `Failed to get token account transactions - Address: ${maskAddress(address)}, Error: ${getErrorMessage(tokenAccountsResult.error)}`
      );
      return ok([]);
    }

    const tokenAccountAddresses = tokenAccountsResult.value;
    const tokenTransactions: HeliusTransaction[] = [];

    const maxTokenAccounts = 20;
    const accountsToProcess = tokenAccountAddresses.slice(0, maxTokenAccounts);

    this.logger.debug(`Processing ${accountsToProcess.length} token accounts for address ${maskAddress(address)}`);

    for (const account of accountsToProcess) {
      const signaturesResult = await this.httpClient.post<JsonRpcResponse<SolanaSignature[]>>(
        '/',
        {
          id: 1,
          jsonrpc: '2.0',
          method: 'getSignaturesForAddress',
          params: [
            account,
            {
              limit: 50,
            },
          ],
        },
        { schema: HeliusSignaturesJsonRpcResponseSchema }
      );

      if (signaturesResult.isErr()) {
        this.logger.debug(
          `Failed to fetch signatures for token account ${account} - Error: ${getErrorMessage(signaturesResult.error)}`
        );
        continue;
      }

      const signaturesResponse = signaturesResult.value;

      if (signaturesResponse?.result) {
        const signatures = signaturesResponse.result.slice(0, 20);

        for (const sig of signatures) {
          const txResult = await this.httpClient.post<JsonRpcResponse<HeliusTransaction>>(
            '/',
            {
              id: 1,
              jsonrpc: '2.0',
              method: 'getTransaction',
              params: [
                sig.signature,
                {
                  encoding: 'json',
                  maxSupportedTransactionVersion: 0,
                },
              ],
            },
            { schema: HeliusTransactionJsonRpcResponseSchema }
          );

          if (txResult.isErr()) {
            this.logger.debug(
              `Failed to fetch transaction for signature ${sig.signature} - Error: ${getErrorMessage(txResult.error)}`
            );
            continue;
          }

          const txResponse = txResult.value;

          if (txResponse?.result) {
            tokenTransactions.push(txResponse.result);
          }
        }
      }
    }

    this.logger.debug(
      `Retrieved token account transactions - Address: ${maskAddress(address)}, TokenAccounts: ${accountsToProcess.length}, Transactions: ${tokenTransactions.length}`
    );

    return ok(tokenTransactions);
  }

  private streamAddressTransactions(
    address: string,
    resumeCursor?: CursorState
  ): AsyncIterableIterator<Result<StreamingBatchResult<SolanaTransaction>, Error>> {
    const fetchPage = async (ctx: StreamingPageContext): Promise<Result<StreamingPage<HeliusTransaction>, Error>> => {
      const limit = 100;
      const options: { before?: string; limit: number } = { limit };

      // Use pageToken as the 'before' cursor for pagination
      if (ctx.pageToken) {
        options.before = ctx.pageToken;
      }

      const params = [address, options];

      // Fetch signatures for main address
      const signaturesResult = await this.httpClient.post<JsonRpcResponse<SolanaSignature[]>>(
        '/',
        {
          id: 1,
          jsonrpc: '2.0',
          method: 'getSignaturesForAddress',
          params,
        },
        { schema: HeliusSignaturesJsonRpcResponseSchema }
      );

      if (signaturesResult.isErr()) {
        this.logger.error(
          `Failed to fetch signatures - Address: ${maskAddress(address)}, Error: ${getErrorMessage(signaturesResult.error)}`
        );
        return err(signaturesResult.error);
      }

      const signatures = signaturesResult.value?.result || [];

      if (signatures.length === 0) {
        return ok({ items: [], isComplete: true });
      }

      // Fetch transaction details for each signature
      const transactions: HeliusTransaction[] = [];
      for (const sig of signatures) {
        const txResult = await this.httpClient.post<JsonRpcResponse<HeliusTransaction>>(
          '/',
          {
            id: 1,
            jsonrpc: '2.0',
            method: 'getTransaction',
            params: [
              sig.signature,
              {
                encoding: 'json',
                maxSupportedTransactionVersion: 0,
              },
            ],
          },
          { schema: HeliusTransactionJsonRpcResponseSchema }
        );

        if (txResult.isOk() && txResult.value?.result) {
          transactions.push(txResult.value.result);
        }
      }

      // Use the last signature as the next page token
      const lastSignature = signatures[signatures.length - 1]?.signature;

      return ok({
        items: transactions,
        nextPageToken: lastSignature,
        isComplete: signatures.length < limit,
      });
    };

    return createStreamingIterator<HeliusTransaction, SolanaTransaction>({
      providerName: this.name,
      operation: { type: 'getAddressTransactions', address },
      resumeCursor,
      fetchPage,
      mapItem: (raw) => {
        const mapped = mapHeliusTransaction(raw, {});
        if (mapped.isErr()) {
          const errorMessage = mapped.error.type === 'error' ? mapped.error.message : mapped.error.reason;
          this.logger.error(
            `Provider data validation failed - Address: ${maskAddress(address)}, Error: ${errorMessage}`
          );
          return err(new Error(`Provider data validation failed: ${errorMessage}`));
        }
        return ok({ raw, normalized: mapped.value });
      },
      extractCursors: (tx) => this.extractCursors(tx),
      applyReplayWindow: (cursor) => this.applyReplayWindow(cursor),
      dedupWindowSize: 200,
      logger: this.logger,
    });
  }

  private streamAddressTokenTransactions(
    address: string,
    resumeCursor?: CursorState
  ): AsyncIterableIterator<Result<StreamingBatchResult<SolanaTransaction>, Error>> {
    // State to track token accounts and current streaming position
    let tokenAccounts: string[] = [];
    let currentAccountIndex = 0;
    let isInitialized = false;

    const fetchPage = async (ctx: StreamingPageContext): Promise<Result<StreamingPage<HeliusTransaction>, Error>> => {
      // Initialize: fetch token accounts list
      if (!isInitialized) {
        const tokenAccountsResult = await this.getTokenAccountsOwnedByAddress(address);
        if (tokenAccountsResult.isErr()) {
          return err(tokenAccountsResult.error);
        }
        tokenAccounts = tokenAccountsResult.value.slice(0, 20); // Limit to 20

        // If resuming, restore the account index and cursor from metadata
        if (ctx.resumeCursor?.metadata?.tokenAccountIndex !== undefined) {
          currentAccountIndex = ctx.resumeCursor.metadata.tokenAccountIndex as number;
        }

        isInitialized = true;

        // Store token accounts in metadata for future reference
        if (tokenAccounts.length === 0) {
          return ok({ items: [], isComplete: true });
        }
      }

      // If we've exhausted all token accounts
      if (currentAccountIndex >= tokenAccounts.length) {
        return ok({ items: [], isComplete: true });
      }

      const currentAccount = tokenAccounts[currentAccountIndex]!;
      const limit = 50;
      const options: { before?: string; limit: number } = { limit };

      // Use pageToken for current account pagination
      if (ctx.pageToken) {
        options.before = ctx.pageToken;
      }

      // Fetch signatures for current token account
      const signaturesResult = await this.httpClient.post<JsonRpcResponse<SolanaSignature[]>>(
        '/',
        {
          id: 1,
          jsonrpc: '2.0',
          method: 'getSignaturesForAddress',
          params: [currentAccount, options],
        },
        { schema: HeliusSignaturesJsonRpcResponseSchema }
      );

      if (signaturesResult.isErr()) {
        // Move to next account on error
        currentAccountIndex++;
        return fetchPage({ ...ctx, pageToken: undefined });
      }

      const signatures = signaturesResult.value?.result || [];

      // If no more signatures for this account, move to next
      if (signatures.length === 0) {
        currentAccountIndex++;
        // Recursively fetch from next account
        return fetchPage({ ...ctx, pageToken: undefined });
      }

      // Fetch transaction details
      const transactions: HeliusTransaction[] = [];
      for (const sig of signatures) {
        const txResult = await this.httpClient.post<JsonRpcResponse<HeliusTransaction>>(
          '/',
          {
            id: 1,
            jsonrpc: '2.0',
            method: 'getTransaction',
            params: [
              sig.signature,
              {
                encoding: 'json',
                maxSupportedTransactionVersion: 0,
              },
            ],
          },
          { schema: HeliusTransactionJsonRpcResponseSchema }
        );

        if (txResult.isOk() && txResult.value?.result) {
          transactions.push(txResult.value.result);
        }
      }

      const lastSignature = signatures[signatures.length - 1]?.signature;
      const isCurrentAccountComplete = signatures.length < limit;

      // Prepare next page token and metadata
      let nextPageToken: string | undefined;
      const metadata: Record<string, unknown> = {
        tokenAccountIndex: currentAccountIndex,
        tokenAccounts,
      };

      if (isCurrentAccountComplete) {
        // Move to next account
        currentAccountIndex++;
        nextPageToken = undefined; // Reset cursor for next account
        metadata.tokenAccountIndex = currentAccountIndex;
      } else {
        nextPageToken = lastSignature;
      }

      const isComplete = currentAccountIndex >= tokenAccounts.length && isCurrentAccountComplete;

      return ok({
        items: transactions,
        nextPageToken,
        isComplete,
      });
    };

    return createStreamingIterator<HeliusTransaction, SolanaTransaction>({
      providerName: this.name,
      operation: { type: 'getAddressTokenTransactions', address },
      resumeCursor,
      fetchPage,
      mapItem: (raw) => {
        const mapped = mapHeliusTransaction(raw, {});
        if (mapped.isErr()) {
          const errorMessage = mapped.error.type === 'error' ? mapped.error.message : mapped.error.reason;
          this.logger.error(
            `Provider data validation failed - Address: ${maskAddress(address)}, Error: ${errorMessage}`
          );
          return err(new Error(`Provider data validation failed: ${errorMessage}`));
        }
        return ok({ raw, normalized: mapped.value });
      },
      extractCursors: (tx) => this.extractCursors(tx),
      applyReplayWindow: (cursor) => this.applyReplayWindow(cursor),
      dedupWindowSize: 200,
      logger: this.logger,
    });
  }
}
