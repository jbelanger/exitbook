import type { CursorState, PaginationCursor } from '@exitbook/foundation';
import { getErrorMessage } from '@exitbook/foundation';
import { err, ok, type Result } from '@exitbook/foundation';

import type {
  ProviderConfig,
  ProviderFactory,
  ProviderMetadata,
  ProviderOperation,
  JsonRpcResponse,
  RawBalanceData,
  StreamingBatchResult,
  NormalizedTransactionBase,
  OneShotOperation,
  OneShotOperationResult,
  StreamingOperation,
} from '../../../../contracts/index.js';
import { BaseApiClient } from '../../../../runtime/base-api-client.js';
import {
  createStreamingIterator,
  type StreamingPage,
  type StreamingPageContext,
} from '../../../../runtime/streaming/adapter.js';
import type { TokenMetadata } from '../../../../token-metadata/contracts.js';
import { transformSolBalance, transformStakeAccountBalance, transformTokenAccounts } from '../../balance-utils.js';
import type {
  SolanaAccountBalance,
  SolanaSignature,
  SolanaStakeActivation,
  SolanaStakeProgramAccount,
  SolanaTransaction,
} from '../../schemas.js';
import type { SolanaTokenAccountsResponse } from '../../types.js';
import { isValidSolanaAddress } from '../../utils.js';

import { mapHeliusTransaction } from './helius.mapper-utils.js';
import type { HeliusAssetResponse, HeliusTransaction } from './helius.schemas.js';
import {
  HeliusAssetJsonRpcResponseSchema,
  HeliusSignaturesJsonRpcResponseSchema,
  HeliusTransactionJsonRpcResponseSchema,
  HeliusBalanceJsonRpcResponseSchema,
  HeliusStakeActivationJsonRpcResponseSchema,
  HeliusStakeProgramAccountsJsonRpcResponseSchema,
  HeliusTokenAccountsJsonRpcResponseSchema,
} from './helius.schemas.js';

export const heliusMetadata: ProviderMetadata = {
  apiKeyEnvName: 'HELIUS_API_KEY',
  baseUrl: 'https://rpc.helius.xyz',
  blockchain: 'solana',
  capabilities: {
    supportedOperations: [
      'getAddressTransactions',
      'getAddressBalances',
      'getAddressStakingBalances',
      'getAddressTokenBalances',
      'getTokenMetadata',
    ],
    supportedTransactionTypes: ['normal', 'stake', 'token'],
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
};

const STAKE_PROGRAM_ID = 'Stake11111111111111111111111111111111111111';
const STAKE_ACCOUNT_DATA_SIZE = 200;
const STAKER_AUTHORITY_OFFSET = 12;
const WITHDRAWER_AUTHORITY_OFFSET = 44;

function resolveStakeBalanceCategory(
  activation: SolanaStakeActivation
): Extract<RawBalanceData['balanceCategory'], 'staked' | 'unbonding'> {
  return activation.state === 'active' || activation.state === 'activating' ? 'staked' : 'unbonding';
}

export const heliusFactory: ProviderFactory = {
  create: (config: ProviderConfig) => new HeliusApiClient(config),
  metadata: heliusMetadata,
};

export class HeliusApiClient extends BaseApiClient {
  constructor(config: ProviderConfig) {
    super(config);
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

  async execute<TOperation extends OneShotOperation>(
    operation: TOperation
  ): Promise<Result<OneShotOperationResult<TOperation>, Error>> {
    this.logger.debug(`Executing operation - Type: ${operation.type}`);

    switch (operation.type) {
      case 'getAddressBalances':
        return (await this.getAddressBalances({
          address: operation.address,
        })) as Result<OneShotOperationResult<TOperation>, Error>;
      case 'getAddressTokenBalances':
        return (await this.getAddressTokenBalances({
          address: operation.address,
          contractAddresses: operation.contractAddresses,
        })) as Result<OneShotOperationResult<TOperation>, Error>;
      case 'getAddressStakingBalances':
        return (await this.getAddressStakingBalances({
          address: operation.address,
        })) as Result<OneShotOperationResult<TOperation>, Error>;
      case 'getTokenMetadata':
        return (await this.getTokenMetadata(operation.contractAddresses)) as Result<
          OneShotOperationResult<TOperation>,
          Error
        >;
      default:
        return err(new Error(`Unsupported operation: ${operation.type}`));
    }
  }

  async *executeStreaming<T extends NormalizedTransactionBase = NormalizedTransactionBase>(
    operation: StreamingOperation,
    resumeCursor?: CursorState
  ): AsyncIterableIterator<Result<StreamingBatchResult<T>, Error>> {
    if (operation.type !== 'getAddressTransactions') {
      yield err(new Error(`Streaming not yet implemented for operation: ${(operation as ProviderOperation).type}`));
      return;
    }

    // Route based on transaction type
    const streamType = operation.streamType || 'normal';
    switch (streamType) {
      case 'normal':
      case 'stake':
        yield* this.streamAddressTransactions(operation.address, resumeCursor) as AsyncIterableIterator<
          Result<StreamingBatchResult<T>, Error>
        >;
        break;
      case 'token':
        yield* this.streamAddressTokenTransactions(operation.address, resumeCursor) as AsyncIterableIterator<
          Result<StreamingBatchResult<T>, Error>
        >;
        break;
      default:
        yield err(new Error(`Unsupported transaction type: ${streamType}`));
    }
  }

  getHealthCheckConfig() {
    return {
      body: {
        id: 1,
        jsonrpc: '2.0',
        method: 'getHealth',
      },
      endpoint: this.rpcEndpoint(),
      method: 'POST' as const,
      validate: (response: unknown) => {
        const data = response as JsonRpcResponse<string>;
        return data?.result === 'ok';
      },
    };
  }

  async getTokenMetadata(mintAddresses: string[]): Promise<Result<TokenMetadata[], Error>> {
    if (mintAddresses.length === 0) {
      return ok([]);
    }

    // For batch requests, use getAssetBatch method
    if (mintAddresses.length > 1) {
      const result = await this.httpClient.post<JsonRpcResponse<HeliusAssetResponse[]>>(
        this.rpcEndpoint(),
        {
          id: 1,
          jsonrpc: '2.0',
          method: 'getAssetBatch',
          params: {
            displayOptions: {
              showFungible: true,
            },
            ids: mintAddresses,
          },
        },
        { schema: HeliusAssetJsonRpcResponseSchema }
      );

      if (result.isErr()) {
        return err(result.error);
      }

      const response = result.value;
      if (!response?.result) {
        return err(new Error(`Token metadata not found for ${mintAddresses.length} mint addresses`));
      }

      // Response.result should be an array for getAssetBatch
      const assets = Array.isArray(response.result) ? response.result : [response.result];
      const metadata = assets.map((asset, index) => this.extractTokenMetadata(asset, mintAddresses[index]!));
      return ok(metadata);
    }

    // Single address - use getAsset method
    const result = await this.httpClient.post<JsonRpcResponse<HeliusAssetResponse>>(
      this.rpcEndpoint(),
      {
        id: 1,
        jsonrpc: '2.0',
        method: 'getAsset',
        params: {
          displayOptions: {
            showFungible: true,
          },
          id: mintAddresses[0],
        },
      },
      { schema: HeliusAssetJsonRpcResponseSchema }
    );

    if (result.isErr()) {
      return err(result.error);
    }

    const response = result.value;
    if (!response?.result) {
      return err(new Error(`Token metadata not found for mint address: ${mintAddresses[0]}`));
    }

    const asset = response.result;
    return ok([this.extractTokenMetadata(asset, mintAddresses[0]!)]);
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

  private rpcEndpoint(): string {
    if (!this.apiKey || this.apiKey === 'YourApiKeyToken') {
      return '/';
    }

    return `/?api-key=${this.apiKey}`;
  }

  private async getAddressBalances(params: { address: string }): Promise<Result<RawBalanceData, Error>> {
    const { address } = params;

    if (!isValidSolanaAddress(address)) {
      return err(new Error(`Invalid Solana address: ${address}`));
    }

    this.logger.debug('Fetching raw address balance');

    const result = await this.httpClient.post<JsonRpcResponse<SolanaAccountBalance>>(
      this.rpcEndpoint(),
      {
        id: 1,
        jsonrpc: '2.0',
        method: 'getBalance',
        params: [address],
      },
      { schema: HeliusBalanceJsonRpcResponseSchema }
    );

    if (result.isErr()) {
      this.logger.error(`Failed to get raw address balance - Error: ${getErrorMessage(result.error)}`);
      return err(result.error);
    }

    const response = result.value;

    if (!response?.result || response.result.value === undefined) {
      return err(new Error('Failed to fetch balance from Helius RPC'));
    }

    const balanceData = transformSolBalance(response.result.value);

    this.logger.debug('Successfully retrieved raw address balance');

    return ok(balanceData);
  }

  private async getAddressTokenBalances(params: {
    address: string;
    contractAddresses?: string[] | undefined;
  }): Promise<Result<RawBalanceData[], Error>> {
    const { address } = params;

    if (!isValidSolanaAddress(address)) {
      return err(new Error(`Invalid Solana address: ${address}`));
    }

    this.logger.debug('Fetching raw token balances');

    const result = await this.httpClient.post<JsonRpcResponse<SolanaTokenAccountsResponse>>(
      this.rpcEndpoint(),
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
      this.logger.error(`Failed to get raw token balances - Error: ${getErrorMessage(result.error)}`);
      return err(result.error);
    }

    const tokenAccountsResponse = result.value;

    if (!tokenAccountsResponse?.result) {
      this.logger.debug('No raw token accounts found');
      return ok([]);
    }

    const balances = transformTokenAccounts(tokenAccountsResponse.result.value);

    this.logger.debug({ tokenAccountCount: balances.length }, 'Successfully retrieved raw token balances');

    return ok(balances);
  }

  private async getAddressStakingBalances(params: { address: string }): Promise<Result<RawBalanceData[], Error>> {
    const { address } = params;

    if (!isValidSolanaAddress(address)) {
      return err(new Error(`Invalid Solana address: ${address}`));
    }

    const stakeAccountsResult = await this.getStakeAccountsAuthorizedByAddress(address);
    if (stakeAccountsResult.isErr()) {
      return err(stakeAccountsResult.error);
    }

    const balances: RawBalanceData[] = [];
    for (const stakeAccount of stakeAccountsResult.value) {
      const activationResult = await this.getStakeActivation(stakeAccount.pubkey);
      if (activationResult.isErr()) {
        return err(activationResult.error);
      }

      balances.push(
        transformStakeAccountBalance({
          accountAddress: stakeAccount.pubkey,
          balanceCategory: resolveStakeBalanceCategory(activationResult.value),
          lamports: stakeAccount.account.lamports,
        })
      );
    }

    this.logger.debug({ stakeAccountCount: balances.length }, 'Successfully retrieved Solana stake-account balances');

    return ok(balances);
  }

  private async getStakeAccountsAuthorizedByAddress(
    address: string
  ): Promise<Result<SolanaStakeProgramAccount[], Error>> {
    const accountsByPubkey = new Map<string, SolanaStakeProgramAccount>();

    for (const offset of [STAKER_AUTHORITY_OFFSET, WITHDRAWER_AUTHORITY_OFFSET]) {
      const accountsResult = await this.getStakeAccountsByAuthorityOffset(address, offset);
      if (accountsResult.isErr()) {
        return err(accountsResult.error);
      }

      for (const account of accountsResult.value) {
        accountsByPubkey.set(account.pubkey, account);
      }
    }

    return ok([...accountsByPubkey.values()]);
  }

  private async getStakeAccountsByAuthorityOffset(
    address: string,
    offset: number
  ): Promise<Result<SolanaStakeProgramAccount[], Error>> {
    const result = await this.httpClient.post<JsonRpcResponse<SolanaStakeProgramAccount[]>>(
      this.rpcEndpoint(),
      {
        id: 1,
        jsonrpc: '2.0',
        method: 'getProgramAccounts',
        params: [
          STAKE_PROGRAM_ID,
          {
            encoding: 'jsonParsed',
            filters: [
              { dataSize: STAKE_ACCOUNT_DATA_SIZE },
              {
                memcmp: {
                  bytes: address,
                  offset,
                },
              },
            ],
          },
        ],
      },
      { schema: HeliusStakeProgramAccountsJsonRpcResponseSchema }
    );

    if (result.isErr()) {
      this.logger.error(`Failed to get Solana stake accounts - Error: ${getErrorMessage(result.error)}`);
      return err(result.error);
    }

    return ok(result.value.result ?? []);
  }

  private async getStakeActivation(stakeAccountAddress: string): Promise<Result<SolanaStakeActivation, Error>> {
    const result = await this.httpClient.post<JsonRpcResponse<SolanaStakeActivation>>(
      this.rpcEndpoint(),
      {
        id: 1,
        jsonrpc: '2.0',
        method: 'getStakeActivation',
        params: [stakeAccountAddress],
      },
      { schema: HeliusStakeActivationJsonRpcResponseSchema }
    );

    if (result.isErr()) {
      this.logger.error(`Failed to get Solana stake activation - Error: ${getErrorMessage(result.error)}`);
      return err(result.error);
    }

    if (!result.value.result) {
      return err(new Error(`Failed to fetch stake activation for ${stakeAccountAddress}`));
    }

    return ok(result.value.result);
  }

  private async getTokenAccountsOwnedByAddress(address: string): Promise<Result<string[], Error>> {
    const result = await this.httpClient.post<JsonRpcResponse<SolanaTokenAccountsResponse>>(
      this.rpcEndpoint(),
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
      this.logger.warn(`Failed to get token accounts - Error: ${getErrorMessage(result.error)}`);
      return ok([]);
    }

    const tokenAccountsResponse = result.value;

    if (!tokenAccountsResponse?.result?.value) {
      this.logger.debug('No token accounts found');
      return ok([]);
    }

    const tokenAccountAddresses = tokenAccountsResponse.result.value.map(
      (account: { pubkey: string }) => account.pubkey
    );

    this.logger.debug({ tokenAccountCount: tokenAccountAddresses.length }, 'Found token accounts for owner');

    return ok(tokenAccountAddresses);
  }

  private streamAddressTransactions(
    address: string,
    resumeCursor?: CursorState
  ): AsyncIterableIterator<Result<StreamingBatchResult<SolanaTransaction>, Error>> {
    const fetchPage = async (ctx: StreamingPageContext): Promise<Result<StreamingPage<HeliusTransaction>, Error>> => {
      const limit = 100;
      const options: { before?: string; limit: number; sortDirection?: string } = {
        limit,
        sortDirection: 'asc', // Fetch oldest to newest for proper cursor resume
      };

      // Use pageToken as the 'before' cursor for pagination
      if (ctx.pageToken) {
        options.before = ctx.pageToken;
      }

      const params = [address, options];

      // Fetch signatures for main address
      const signaturesResult = await this.httpClient.post<JsonRpcResponse<SolanaSignature[]>>(
        this.rpcEndpoint(),
        {
          id: 1,
          jsonrpc: '2.0',
          method: 'getSignaturesForAddress',
          params,
        },
        { schema: HeliusSignaturesJsonRpcResponseSchema }
      );

      if (signaturesResult.isErr()) {
        this.logger.error(`Failed to fetch signatures - Error: ${getErrorMessage(signaturesResult.error)}`);
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
          this.rpcEndpoint(),
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
        const mapped = mapHeliusTransaction(raw);
        if (mapped.isErr()) {
          const errorMessage = mapped.error.type === 'error' ? mapped.error.message : mapped.error.reason;
          this.logger.error(`Provider data validation failed - Error: ${errorMessage}`);
          return err(new Error(`Provider data validation failed: ${errorMessage}`));
        }
        return ok([{ raw, normalized: mapped.value }]);
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
        const customMeta = ctx.resumeCursor?.metadata?.['custom'] as Record<string, unknown> | undefined;

        // If resuming, restore token accounts list to ensure consistency
        if (customMeta?.['tokenAccounts']) {
          tokenAccounts = customMeta['tokenAccounts'] as string[];
        } else {
          const tokenAccountsResult = await this.getTokenAccountsOwnedByAddress(address);
          if (tokenAccountsResult.isErr()) {
            return err(tokenAccountsResult.error);
          }
          tokenAccounts = tokenAccountsResult.value;

          this.logger.info(`Found ${tokenAccounts.length} token accounts for transaction hydration`);
        }

        // If resuming, restore the account index from metadata
        if (customMeta?.['tokenAccountIndex'] !== undefined) {
          currentAccountIndex = customMeta['tokenAccountIndex'] as number;
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
      const options: { before?: string; limit: number; sortDirection?: string } = {
        limit,
        sortDirection: 'asc', // Fetch oldest to newest for proper cursor resume
      };

      // Use pageToken for current account pagination
      if (ctx.pageToken) {
        options.before = ctx.pageToken;
      }

      // Fetch signatures for current token account
      const signaturesResult = await this.httpClient.post<JsonRpcResponse<SolanaSignature[]>>(
        this.rpcEndpoint(),
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
          this.rpcEndpoint(),
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
        metadata['tokenAccountIndex'] = currentAccountIndex;
      } else {
        nextPageToken = lastSignature;
      }

      const isComplete = currentAccountIndex >= tokenAccounts.length && isCurrentAccountComplete;

      return ok({
        items: transactions,
        nextPageToken,
        isComplete,
        customMetadata: metadata,
      });
    };

    return createStreamingIterator<HeliusTransaction, SolanaTransaction>({
      providerName: this.name,
      operation: { type: 'getAddressTransactions', streamType: 'token', address },
      resumeCursor,
      fetchPage,
      mapItem: (raw) => {
        const mapped = mapHeliusTransaction(raw);
        if (mapped.isErr()) {
          const errorMessage = mapped.error.type === 'error' ? mapped.error.message : mapped.error.reason;
          this.logger.error(`Provider data validation failed - Error: ${errorMessage}`);
          return err(new Error(`Provider data validation failed: ${errorMessage}`));
        }
        return ok([{ raw, normalized: mapped.value }]);
      },
      extractCursors: (tx) => this.extractCursors(tx),
      applyReplayWindow: (cursor) => this.applyReplayWindow(cursor),
      dedupWindowSize: 200,
      logger: this.logger,
    });
  }
}
