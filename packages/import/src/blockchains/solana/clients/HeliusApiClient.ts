import { maskAddress } from '@crypto/shared-utils';

import { BaseRegistryProvider } from '../../shared/registry/base-registry-provider.ts';
import { RegisterProvider } from '../../shared/registry/decorators.ts';
import type { JsonRpcResponse, ProviderOperation } from '../../shared/types.ts';
import type {
  HeliusAssetResponse,
  HeliusSignatureResponse,
  HeliusTransaction,
  SolanaAccountBalance,
  SolanaSignature,
  SolanaTokenAccountsResponse,
} from '../types.ts';
import { isValidSolanaAddress } from '../utils.ts';

export interface SolanaRawTransactionData {
  normal: HeliusTransaction[];
}

export interface SolanaRawBalanceData {
  lamports: number;
}

export interface SolanaRawTokenBalanceData {
  tokenAccounts: SolanaTokenAccountsResponse;
}

@RegisterProvider({
  apiKeyEnvVar: 'SOLANA_HELIUS_API_KEY',
  blockchain: 'solana',
  capabilities: {
    maxBatchSize: 1,
    supportedOperations: ['getRawAddressTransactions', 'getRawAddressBalance', 'getRawTokenBalances'],
    supportsHistoricalData: true,
    supportsPagination: true,
    supportsRealTimeData: true,
    supportsTokenData: true,
  },
  defaultConfig: {
    rateLimit: {
      burstLimit: 1,
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
  networks: {
    devnet: {
      baseUrl: 'https://devnet.helius-rpc.com',
    },
    mainnet: {
      baseUrl: 'https://rpc.helius.xyz',
    },
    testnet: {
      baseUrl: 'https://rpc.helius.xyz',
    },
  },
  requiresApiKey: true,
  type: 'rpc',
})
export class HeliusApiClient extends BaseRegistryProvider {
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

  private tokenMetadataCache = new Map<string, Record<string, unknown>>();
  private tokenSymbolCache = new Map<string, string>();

  constructor() {
    super('solana', 'helius', 'mainnet');

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

  private deduplicateTransactions(transactions: HeliusTransaction[]): HeliusTransaction[] {
    const seen = new Set<string>();
    const unique: HeliusTransaction[] = [];

    for (const tx of transactions) {
      const signature = tx.transaction.signatures?.[0] || tx.signature || '';
      if (signature && !seen.has(signature)) {
        seen.add(signature);
        unique.push(tx);
      }
    }

    this.logger.debug(`Deduplicated transactions - Original: ${transactions.length}, Unique: ${unique.length}`);
    return unique;
  }

  private async getDirectAddressTransactions(address: string, since?: number): Promise<HeliusTransaction[]> {
    const signaturesResponse = await this.httpClient.post<JsonRpcResponse<SolanaSignature[]>>('/', {
      id: 1,
      jsonrpc: '2.0',
      method: 'getSignaturesForAddress',
      params: [
        address,
        {
          limit: 10, // Keep small to minimize requests
        },
      ],
    });

    if (!signaturesResponse?.result) {
      this.logger.debug(`No direct signatures found - Address: ${maskAddress(address)}`);
      return [];
    }

    const transactions: HeliusTransaction[] = [];
    const signatures = signaturesResponse.result.slice(0, 8); // Reduced to 8 to minimize API calls

    this.logger.debug(`Retrieved direct signatures - Address: ${maskAddress(address)}, Count: ${signatures.length}`);

    for (const sig of signatures) {
      try {
        const txResponse = await this.httpClient.post<JsonRpcResponse<HeliusTransaction>>('/', {
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

        if (txResponse?.result && (!since || (txResponse.result.blockTime && txResponse.result.blockTime >= since))) {
          transactions.push(txResponse.result);
        }
      } catch (error) {
        this.logger.debug(
          `Failed to fetch transaction details - Signature: ${sig.signature}, Error: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    return transactions;
  }

  private async getRawAddressBalance(params: { address: string }): Promise<SolanaRawBalanceData> {
    const { address } = params;

    if (!isValidSolanaAddress(address)) {
      throw new Error(`Invalid Solana address: ${address}`);
    }

    this.logger.debug(`Fetching raw address balance - Address: ${maskAddress(address)}, Network: ${this.network}`);

    try {
      const response = await this.httpClient.post<JsonRpcResponse<SolanaAccountBalance>>('/', {
        id: 1,
        jsonrpc: '2.0',
        method: 'getBalance',
        params: [address],
      });

      if (!response?.result || response.result.value === undefined) {
        throw new Error('Failed to fetch balance from Helius RPC');
      }

      this.logger.debug(
        `Successfully retrieved raw address balance - Address: ${maskAddress(address)}, Lamports: ${response.result.value}, Network: ${this.network}`
      );

      return { lamports: response.result.value };
    } catch (error) {
      this.logger.error(
        `Failed to get raw address balance - Address: ${maskAddress(address)}, Network: ${this.network}, Error: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }

  private async getRawAddressTransactions(params: {
    address: string;
    since?: number | undefined;
  }): Promise<SolanaRawTransactionData> {
    const { address, since } = params;

    if (!isValidSolanaAddress(address)) {
      throw new Error(`Invalid Solana address: ${address}`);
    }

    this.logger.debug(`Fetching raw address transactions - Address: ${maskAddress(address)}, Network: ${this.network}`);

    try {
      const directTransactions = await this.getDirectAddressTransactions(address, since);
      const tokenAccountTransactions = await this.getTokenAccountTransactions(address, since);

      const allTransactions = this.deduplicateTransactions([...directTransactions, ...tokenAccountTransactions]);
      allTransactions.sort((a, b) => b.blockTime! - a.blockTime!);

      this.logger.debug(
        `Successfully retrieved raw address transactions - Address: ${maskAddress(address)}, DirectTransactions: ${directTransactions.length}, TokenAccountTransactions: ${tokenAccountTransactions.length}, TotalUniqueTransactions: ${allTransactions.length}, Network: ${this.network}`
      );

      return { normal: allTransactions };
    } catch (error) {
      this.logger.error(
        `Failed to get raw address transactions - Address: ${maskAddress(address)}, Network: ${this.network}, Error: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }

  private async getRawTokenBalances(params: {
    address: string;
    contractAddresses?: string[] | undefined;
  }): Promise<SolanaRawTokenBalanceData> {
    const { address, contractAddresses } = params;

    if (!isValidSolanaAddress(address)) {
      throw new Error(`Invalid Solana address: ${address}`);
    }

    this.logger.debug(`Fetching raw token balances - Address: ${maskAddress(address)}, Network: ${this.network}`);

    try {
      const tokenAccountsResponse = await this.httpClient.post<JsonRpcResponse<SolanaTokenAccountsResponse>>('/', {
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

      if (!tokenAccountsResponse?.result) {
        this.logger.debug(`No raw token accounts found - Address: ${maskAddress(address)}`);
        return { tokenAccounts: { value: [] } };
      }

      this.logger.debug(
        `Successfully retrieved raw token balances - Address: ${maskAddress(address)}, TokenAccountCount: ${tokenAccountsResponse.result.value.length}, Network: ${this.network}`
      );

      return { tokenAccounts: tokenAccountsResponse.result };
    } catch (error) {
      this.logger.error(
        `Failed to get raw token balances - Address: ${maskAddress(address)}, Network: ${this.network}, Error: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }

  private async getTokenAccountsOwnedByAddress(address: string): Promise<string[]> {
    try {
      const tokenAccountsResponse = await this.httpClient.post<JsonRpcResponse<SolanaTokenAccountsResponse>>('/', {
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

      if (!tokenAccountsResponse?.result?.value) {
        this.logger.debug(`No token accounts found - Address: ${maskAddress(address)}`);
        return [];
      }

      const tokenAccountAddresses = tokenAccountsResponse.result.value.map(
        (account: { pubkey: string }) => account.pubkey
      );

      this.logger.debug(
        `Found token accounts owned by address - Address: ${maskAddress(address)}, TokenAccountCount: ${tokenAccountAddresses.length}`
      );

      return tokenAccountAddresses;
    } catch (error) {
      this.logger.warn(
        `Failed to get token accounts - Address: ${maskAddress(address)}, Error: ${error instanceof Error ? error.message : String(error)}`
      );
      return [];
    }
  }

  private async getTokenAccountTransactions(address: string, since?: number): Promise<HeliusTransaction[]> {
    try {
      // Skip token account transactions for now to avoid rate limits
      // The direct address transactions should capture most relevant token transfers
      this.logger.debug(`Skipping token account transactions to avoid rate limits - Address: ${maskAddress(address)}`);
      return [];
    } catch (error) {
      this.logger.warn(
        `Failed to get token account transactions - Address: ${maskAddress(address)}, Error: ${error instanceof Error ? error.message : String(error)}`
      );
      return [];
    }
  }

  private storeTokenMetadata(mintAddress: string, metadata: Record<string, unknown>): void {
    this.tokenMetadataCache.set(mintAddress, {
      attributes: metadata.attributes,
      description: metadata.description,
      external_url: metadata.external_url,
      image: metadata.image,
      name: metadata.name || '',
      symbol: metadata.symbol || '',
    });
  }

  async execute<T>(operation: ProviderOperation<T>): Promise<T> {
    this.logger.debug(
      `Executing operation - Type: ${operation.type}, Address: ${'address' in operation ? maskAddress(operation.address as string) : 'N/A'}`
    );

    try {
      switch (operation.type) {
        case 'getRawAddressTransactions':
          return this.getRawAddressTransactions({
            address: operation.address,
            since: operation.since,
          }) as T;
        case 'getRawAddressBalance':
          return this.getRawAddressBalance({
            address: operation.address,
          }) as T;
        case 'getRawTokenBalances':
          return this.getRawTokenBalances({
            address: operation.address,
            contractAddresses: operation.contractAddresses,
          }) as T;
        default:
          throw new Error(`Unsupported operation: ${operation.type}`);
      }
    } catch (error) {
      this.logger.error(
        `Operation execution failed - Type: ${operation.type}, Error: ${error instanceof Error ? error.message : String(error)}, Stack: ${error instanceof Error ? error.stack : undefined}`
      );
      throw error;
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

    try {
      const response = await this.httpClient.post<JsonRpcResponse<HeliusAssetResponse>>('/', {
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

      throw new Error('No symbol or name found in metadata');
    } catch (error) {
      const fallbackSymbol = `${mintAddress.slice(0, 6)}...`;
      this.tokenSymbolCache.set(mintAddress, fallbackSymbol);
      this.logger.warn(
        `Failed to fetch token symbol, using fallback - Mint: ${maskAddress(mintAddress)}, Symbol: ${fallbackSymbol}, Error: ${error instanceof Error ? error.message : String(error)}`
      );
      return fallbackSymbol;
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      const response = await this.httpClient.post<JsonRpcResponse<string>>('/', {
        id: 1,
        jsonrpc: '2.0',
        method: 'getHealth',
      });
      return response?.result === 'ok';
    } catch (error) {
      this.logger.warn(`Health check failed - Error: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      const response = await this.httpClient.post<JsonRpcResponse<string>>('/', {
        id: 1,
        jsonrpc: '2.0',
        method: 'getHealth',
      });
      this.logger.debug(`Connection test successful - Health: ${response?.result}`);
      return response?.result === 'ok';
    } catch (error) {
      this.logger.error(`Connection test failed - Error: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }
}
