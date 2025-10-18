import { getErrorMessage, type BlockchainBalanceSnapshot, type BlockchainTokenBalanceSnapshot } from '@exitbook/core';
import { Decimal } from 'decimal.js';
import { err, ok, type Result } from 'neverthrow';

import { BaseApiClient } from '../../../core/blockchain/base/api-client.ts';
import type { JsonRpcResponse, ProviderConfig, ProviderOperation } from '../../../core/blockchain/index.ts';
import { RegisterApiClient } from '../../../core/blockchain/index.ts';
import type { TransactionWithRawData } from '../../../core/blockchain/types/index.ts';
import { maskAddress } from '../../../core/blockchain/utils/address-utils.ts';
import type {
  SolanaAccountBalance,
  SolanaSignature,
  SolanaTokenAccountsResponse,
  SolanaTransaction,
} from '../types.js';
import { isValidSolanaAddress } from '../utils.js';

import { HeliusTransactionMapper } from './helius.mapper.ts';
import type { HeliusAssetResponse, HeliusTransaction } from './helius.types.js';

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
  /**
   * Static token registry for common Solana tokens
   */
  private static readonly KNOWN_TOKENS = new Map<string, string>([
    ['rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof', 'RENDER'],
    ['hntyVP6YFm1Hg25TN9WGLqM12b8TQmcknKrdu1oxWux', 'HNT'],
    ['4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', 'RAY'],
    ['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'USDC'],
    ['Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', 'USDT'],
    ['mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', 'mSOL'],
    ['7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj', 'stSOL'],
    ['J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn', 'jitoSOL'],
    ['bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1', 'bSOL'],
    ['DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', 'BONK'],
    ['5oVNBeEEQvYi1cX3ir8Dx5n1P7pdxydbGF2X4TxVusJm', 'INF'],
    ['7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs', 'ETH'],
    ['9n4nbM75f5Ui33ZbPYXn59EwSgE8CGsHtAeTH5YFeJ9E', 'BTC'],
  ]);

  private mapper: HeliusTransactionMapper;
  private tokenMetadataCache = new Map<string, Record<string, unknown>>();
  private tokenSymbolCache = new Map<string, string>();

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
          since: operation.since,
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

  async getTokenSymbol(mintAddress: string): Promise<string> {
    if (this.tokenSymbolCache.has(mintAddress)) {
      return this.tokenSymbolCache.get(mintAddress)!;
    }

    const knownSymbol = HeliusApiClient.KNOWN_TOKENS.get(mintAddress);
    if (knownSymbol) {
      this.tokenSymbolCache.set(mintAddress, knownSymbol);
      this.logger.debug(
        `Found token symbol in static registry - Mint: ${maskAddress(mintAddress)}, Symbol: ${knownSymbol}`
      );
      return knownSymbol;
    }

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
      const fallbackSymbol = `${mintAddress.slice(0, 6)}...`;
      this.tokenSymbolCache.set(mintAddress, fallbackSymbol);
      this.logger.warn(
        `Failed to fetch token symbol, using fallback - Mint: ${maskAddress(mintAddress)}, Symbol: ${fallbackSymbol}, Error: ${getErrorMessage(result.error)}`
      );
      return fallbackSymbol;
    }

    const response = result.value;

    if (response?.result?.content?.metadata?.symbol) {
      const metadata = response.result.content.metadata;
      const symbol = metadata.symbol;
      if (symbol) {
        this.storeTokenMetadata(mintAddress, metadata);
        this.tokenSymbolCache.set(mintAddress, symbol);
        return symbol;
      }
    }

    if (response?.result?.content?.metadata?.name) {
      const metadata = response.result.content.metadata;
      const name = metadata.name;
      if (name) {
        this.storeTokenMetadata(mintAddress, metadata);
        this.tokenSymbolCache.set(mintAddress, name);
        return name;
      }
    }

    const fallbackSymbol = `${mintAddress.slice(0, 6)}...`;
    this.tokenSymbolCache.set(mintAddress, fallbackSymbol);
    this.logger.warn(
      `No symbol or name found in metadata, using fallback - Mint: ${maskAddress(mintAddress)}, Symbol: ${fallbackSymbol}`
    );
    return fallbackSymbol;
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

  private async getDirectAddressTransactions(
    address: string,
    since?: number
  ): Promise<Result<HeliusTransaction[], Error>> {
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

      if (
        txResponse?.result &&
        (!since ||
          (txResponse.result.blockTime &&
            (typeof txResponse.result.blockTime === 'number'
              ? txResponse.result.blockTime * 1000 >= since
              : txResponse.result.blockTime.getTime() >= since)))
      ) {
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
    const balanceSOL = new Decimal(response.result.value).div(new Decimal(10).pow(9)).toString();

    this.logger.debug(
      `Successfully retrieved raw address balance - Address: ${maskAddress(address)}, SOL: ${balanceSOL}`
    );

    return ok({ total: balanceSOL });
  }

  private async getAddressTransactions(params: {
    address: string;
    since?: number | undefined;
  }): Promise<Result<TransactionWithRawData<SolanaTransaction>[], Error>> {
    const { address, since } = params;

    if (!isValidSolanaAddress(address)) {
      return err(new Error(`Invalid Solana address: ${address}`));
    }

    this.logger.debug(`Fetching raw address transactions - Address: ${maskAddress(address)}`);

    const directResult = await this.getDirectAddressTransactions(address, since);
    if (directResult.isErr()) {
      this.logger.error(
        `Failed to get raw address transactions - Address: ${maskAddress(address)}, Error: ${getErrorMessage(directResult.error)}`
      );
      return err(directResult.error);
    }

    const tokenResult = await this.getTokenAccountTransactions(address, since);
    if (tokenResult.isErr()) {
      this.logger.error(
        `Failed to get token account transactions - Address: ${maskAddress(address)}, Error: ${getErrorMessage(tokenResult.error)}`
      );
      return err(tokenResult.error);
    }

    const directTransactions = directResult.value;
    const tokenAccountTransactions = tokenResult.value;

    const allRawTransactions = [...directTransactions, ...tokenAccountTransactions];

    const transactions: TransactionWithRawData<SolanaTransaction>[] = [];
    for (const rawTx of allRawTransactions) {
      const mapResult = this.mapper.map(rawTx, { providerId: 'helius', sourceAddress: address }, {});

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
  }): Promise<Result<BlockchainTokenBalanceSnapshot[], Error>> {
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

    // Convert to BlockchainTokenBalanceSnapshot format
    const balances: BlockchainTokenBalanceSnapshot[] = tokenAccountsResponse.result.value.map((account) => {
      const tokenInfo = account.account.data.parsed.info;
      return {
        token: tokenInfo.mint,
        total: tokenInfo.tokenAmount.uiAmountString,
      };
    });

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

  private async getTokenAccountTransactions(
    address: string,
    since?: number
  ): Promise<Result<HeliusTransaction[], Error>> {
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

          if (
            txResponse?.result &&
            (!since ||
              (txResponse.result.blockTime &&
                (typeof txResponse.result.blockTime === 'number'
                  ? txResponse.result.blockTime * 1000 >= since
                  : txResponse.result.blockTime.getTime() >= since)))
          ) {
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

  private storeTokenMetadata(mintAddress: string, metadata: Record<string, unknown>): void {
    this.tokenMetadataCache.set(mintAddress, {
      attributes: metadata['attributes'],
      description: metadata['description'],
      external_url: metadata['external_url'],
      image: metadata['image'],
      name: metadata['name'] || '',
      symbol: metadata['symbol'] || '',
    });
  }
}
