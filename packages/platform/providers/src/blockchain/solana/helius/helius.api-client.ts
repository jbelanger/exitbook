import { getErrorMessage, parseDecimal, type BlockchainBalanceSnapshot } from '@exitbook/core';
import { err, ok, type Result } from 'neverthrow';

import { BaseApiClient } from '../../../shared/blockchain/base/api-client.ts';
import type { JsonRpcResponse, ProviderConfig, ProviderOperation } from '../../../shared/blockchain/index.ts';
import { RegisterApiClient } from '../../../shared/blockchain/index.ts';
import type { TransactionWithRawData } from '../../../shared/blockchain/types/index.ts';
import { maskAddress } from '../../../shared/blockchain/utils/address-utils.ts';
import type { TokenMetadata } from '../../../shared/token-metadata/index.ts';
import { getTokenMetadataWithCache } from '../../../shared/token-metadata/index.ts';
import type {
  SolanaAccountBalance,
  SolanaSignature,
  SolanaTokenAccountsResponse,
  SolanaTransaction,
} from '../types.js';
import { isValidSolanaAddress } from '../utils.js';

import { HeliusTransactionMapper } from './helius.mapper.ts';
import type { HeliusAssetResponse, HeliusTransaction } from './helius.schemas.js';

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
    supportedOperations: ['getAddressTransactions', 'getAddressBalances', 'getAddressTokenBalances'],
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
  private mapper: HeliusTransactionMapper;

  constructor(config: ProviderConfig) {
    super(config);
    this.mapper = new HeliusTransactionMapper();

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

  async execute<T>(operation: ProviderOperation, _config?: Record<string, unknown>): Promise<Result<T, Error>> {
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
      case 'getAddressTokenBalances':
        return (await this.getAddressTokenBalances({
          address: operation.address,
          contractAddresses: operation.contractAddresses,
        })) as Result<T, Error>;
      default:
        return err(new Error(`Unsupported operation: ${operation.type}`));
    }
  }

  async getTokenMetadata(mintAddress: string): Promise<Result<TokenMetadata, Error>> {
    return await getTokenMetadataWithCache(
      'solana',
      mintAddress,
      async () => {
        const result = await this.httpClient.post<JsonRpcResponse<HeliusAssetResponse>>('/', {
          id: 1,
          jsonrpc: '2.0',
          method: 'getAsset',
          params: {
            displayOptions: {
              showFungible: true,
            },
            id: mintAddress,
          },
        });

        if (result.isErr()) {
          return err(result.error);
        }

        const response = result.value;
        const apiMetadata = response?.result?.content?.metadata;

        if (!apiMetadata) {
          return err(new Error(`No metadata found for mint address: ${mintAddress}`));
        }

        return ok({
          symbol: apiMetadata.symbol ?? undefined,
          name: apiMetadata.name ?? undefined,
          logoUrl: undefined,
        });
      },
      'helius'
    );
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

  private async getDirectAddressTransactions(address: string): Promise<Result<HeliusTransaction[], Error>> {
    const signaturesResult = await this.httpClient.post<JsonRpcResponse<SolanaSignature[]>>('/', {
      id: 1,
      jsonrpc: '2.0',
      method: 'getSignaturesForAddress',
      params: [
        address,
        {
          limit: 1000, // Get full transaction history
        },
      ],
    });

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
      const txResult = await this.httpClient.post<JsonRpcResponse<HeliusTransaction>>('/', {
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
      });

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

  private async getAddressBalances(params: { address: string }): Promise<Result<BlockchainBalanceSnapshot, Error>> {
    const { address } = params;

    if (!isValidSolanaAddress(address)) {
      return err(new Error(`Invalid Solana address: ${address}`));
    }

    this.logger.debug(`Fetching raw address balance - Address: ${maskAddress(address)}`);

    const result = await this.httpClient.post<JsonRpcResponse<SolanaAccountBalance>>('/', {
      id: 1,
      jsonrpc: '2.0',
      method: 'getBalance',
      params: [address],
    });

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

    // Convert from lamports to SOL (1 SOL = 10^9 lamports)
    const balanceSOL = parseDecimal(response.result.value?.toString() || '0')
      .div(parseDecimal('10').pow(9))
      .toString();

    this.logger.debug(
      `Successfully retrieved raw address balance - Address: ${maskAddress(address)}, SOL: ${balanceSOL}`
    );

    return ok({ total: balanceSOL, asset: 'SOL' });
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
    const uniqueTransactions = new Map<string, HeliusTransaction>();
    for (const tx of allRawTransactions) {
      const signature = tx.transaction.signatures?.[0] ?? tx.signature;
      if (signature && !uniqueTransactions.has(signature)) {
        uniqueTransactions.set(signature, tx);
      }
    }

    this.logger.debug(
      `Deduplicated transactions - Address: ${maskAddress(address)}, Total: ${allRawTransactions.length}, Unique: ${uniqueTransactions.size}`
    );

    // Extract all unique mint addresses and fetch their symbols using the cache
    const mintAddresses = new Set<string>();
    for (const tx of uniqueTransactions.values()) {
      tx.meta.preTokenBalances?.forEach((b) => mintAddresses.add(b.mint));
      tx.meta.postTokenBalances?.forEach((b) => mintAddresses.add(b.mint));
    }

    // Fetch metadata for all mints - getTokenMetadata uses the cache automatically
    const tokenSymbols: Record<string, string> = {};
    for (const mint of mintAddresses) {
      const metadataResult = await this.getTokenMetadata(mint);
      if (metadataResult.isOk() && metadataResult.value.symbol) {
        tokenSymbols[mint] = metadataResult.value.symbol;
      }
    }

    const transactions: TransactionWithRawData<SolanaTransaction>[] = [];
    for (const rawTx of uniqueTransactions.values()) {
      const mapResult = this.mapper.map(rawTx, { tokenSymbols });

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

  private async getAddressTokenBalances(params: {
    address: string;
    contractAddresses?: string[] | undefined;
  }): Promise<Result<BlockchainBalanceSnapshot[], Error>> {
    const { address } = params;

    if (!isValidSolanaAddress(address)) {
      return err(new Error(`Invalid Solana address: ${address}`));
    }

    this.logger.debug(`Fetching raw token balances - Address: ${maskAddress(address)}`);

    const result = await this.httpClient.post<JsonRpcResponse<SolanaTokenAccountsResponse>>('/', {
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
    });

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

    // Convert to BlockchainBalanceSnapshot format with symbols
    const balances: BlockchainBalanceSnapshot[] = [];
    for (const account of tokenAccountsResponse.result.value) {
      const tokenInfo = account.account.data.parsed.info;
      const mintAddress = tokenInfo.mint;

      // Fetch token metadata to get symbol
      const metadataResult = await this.getTokenMetadata(mintAddress);
      const symbol = metadataResult.isOk() && metadataResult.value.symbol ? metadataResult.value.symbol : mintAddress; // Fallback to mint address if symbol not found

      balances.push({
        asset: symbol,
        total: tokenInfo.tokenAmount.uiAmountString,
      });
    }

    this.logger.debug(
      `Successfully retrieved raw token balances - Address: ${maskAddress(address)}, TokenAccountCount: ${balances.length}`
    );

    return ok(balances);
  }

  private async getTokenAccountsOwnedByAddress(address: string): Promise<Result<string[], Error>> {
    const result = await this.httpClient.post<JsonRpcResponse<SolanaTokenAccountsResponse>>('/', {
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
    });

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
      const signaturesResult = await this.httpClient.post<JsonRpcResponse<SolanaSignature[]>>('/', {
        id: 1,
        jsonrpc: '2.0',
        method: 'getSignaturesForAddress',
        params: [
          account,
          {
            limit: 50,
          },
        ],
      });

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
          const txResult = await this.httpClient.post<JsonRpcResponse<HeliusTransaction>>('/', {
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
          });

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
}
