import type { Balance, BlockchainTransaction } from '@crypto/core';
import { createMoney, maskAddress } from '@crypto/shared-utils';
import { Decimal } from 'decimal.js';

import { BaseRegistryProvider } from '../../shared/registry/base-registry-provider.ts';
import { RegisterProvider } from '../../shared/registry/decorators.ts';
import { JsonRpcResponse, ProviderOperation } from '../../shared/types.ts';
import type {
  HeliusAssetResponse,
  HeliusSignatureResponse,
  HeliusTransaction,
  SolanaAccountBalance,
  SolanaSignature,
  SolanaTokenAccountsResponse,
} from '../types.ts';
import { isValidSolanaAddress, lamportsToSol } from '../utils.ts';

@RegisterProvider({
  apiKeyEnvVar: 'SOLANA_HELIUS_API_KEY',
  blockchain: 'solana',
  capabilities: {
    maxBatchSize: 1,
    supportedOperations: ['getAddressTransactions', 'getAddressBalance', 'getTokenTransactions', 'getTokenBalances'],
    supportsHistoricalData: true,
    supportsPagination: true,
    supportsRealTimeData: true,
    supportsTokenData: true,
  },
  defaultConfig: {
    rateLimit: {
      burstLimit: 20,
      requestsPerHour: 5000,
      requestsPerMinute: 500,
      requestsPerSecond: 10, // Helius has generous rate limits
    },
    retries: 3,
    timeout: 30000,
  },
  description: 'High-performance Solana RPC API with comprehensive transaction data and token support',
  displayName: 'Helius RPC API',
  name: 'helius',
  networks: {
    devnet: {
      baseUrl: 'https://rpc.helius.xyz',
    },
    mainnet: {
      baseUrl: 'https://mainnet.helius-rpc.com',
    },
    testnet: {
      baseUrl: 'https://rpc.helius.xyz',
    },
  },
  requiresApiKey: true,
  type: 'rpc',
})
export class HeliusProvider extends BaseRegistryProvider {
  /**
   * Static token registry for common Solana tokens
   * This provides fast lookups for well-known tokens
   */
  private static readonly KNOWN_TOKENS = new Map<string, string>([
    // Popular SPL Tokens
    ['rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof', 'RENDER'], // Render Network
    ['hntyVP6YFm1Hg25TN9WGLqM12b8TQmcknKrdu1oxWux', 'HNT'], // Helium Network Token
    ['4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', 'RAY'], // Raydium
    ['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'USDC'], // USD Coin (official)
    ['Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', 'USDT'], // Tether USD
    ['mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', 'mSOL'], // Marinade Staked SOL
    ['7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj', 'stSOL'], // Lido Staked SOL
    ['J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn', 'jitoSOL'], // Jito Staked SOL
    ['bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1', 'bSOL'], // BlazeStake Staked SOL
    ['DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', 'BONK'], // Bonk
    ['5oVNBeEEQvYi1cX3ir8Dx5n1P7pdxydbGF2X4TxVusJm', 'INF'], // Infinity Protocol
    ['7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs', 'ETH'], // Wrapped Ethereum
    ['9n4nbM75f5Ui33ZbPYXn59EwSgE8CGsHtAeTH5YFeJ9E', 'BTC'], // Wrapped Bitcoin
    // ['BvkjtktEZyjix9rSKEiA3ftMU1UCS61XEERFxtMqN1zd', 'UNKNOWN'] // Remove to test API fallback for scam token
  ]);

  /**
   * Store token metadata for scam detection
   */
  private tokenMetadataCache = new Map<string, Record<string, unknown>>();

  private tokenSymbolCache = new Map<string, string>();

  constructor() {
    super('solana', 'helius', 'mainnet');

    // Helius needs API key in URL, so reinitialize HTTP client
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

  private deduplicateTransactions(transactions: BlockchainTransaction[]): BlockchainTransaction[] {
    const seen = new Set<string>();
    const unique: BlockchainTransaction[] = [];

    for (const tx of transactions) {
      if (!seen.has(tx.hash)) {
        seen.add(tx.hash);
        unique.push(tx);
      }
    }

    this.logger.debug(`Deduplicated transactions - Original: ${transactions.length}, Unique: ${unique.length}`);

    return unique;
  }

  private async extractTokenTransaction(
    tx: HeliusTransaction,
    userAddress: string,
    targetContract?: string
  ): Promise<BlockchainTransaction | null> {
    try {
      // Look for token balance changes in preTokenBalances and postTokenBalances
      const preTokenBalances = tx.meta.preTokenBalances || [];
      const postTokenBalances = tx.meta.postTokenBalances || [];

      // Find changes for token accounts owned by the user
      for (const postBalance of postTokenBalances) {
        // Check if this token account is owned by the user
        if (postBalance.owner !== userAddress) {
          continue;
        }

        const preBalance = preTokenBalances.find(
          pre => pre.accountIndex === postBalance.accountIndex && pre.mint === postBalance.mint
        );

        const preAmount = preBalance ? parseFloat(preBalance.uiTokenAmount.uiAmountString || '0') : 0;
        const postAmount = parseFloat(postBalance.uiTokenAmount.uiAmountString || '0');
        const change = postAmount - preAmount;

        // Skip if no meaningful change
        if (Math.abs(change) < 0.000001) {
          continue;
        }

        // If a specific contract is specified, filter by it
        if (targetContract && postBalance.mint !== targetContract) {
          continue;
        }

        // Log any significant token transaction
        this.logger.debug(
          `Found SPL token transaction - Signature: ${tx.transaction.signatures?.[0]}, Mint: ${postBalance.mint}, Owner: ${postBalance.owner}, Change: ${Math.abs(change)}, Type: ${change > 0 ? 'transfer_in' : 'transfer_out'}`
        );

        // Determine transfer direction
        const type: 'transfer_in' | 'transfer_out' = change > 0 ? 'transfer_in' : 'transfer_out';

        // Get proper token symbol using hybrid approach (cache + API)
        const tokenSymbol = await this.getTokenSymbol(postBalance.mint);

        return {
          blockHash: '',
          blockNumber: tx.slot,
          confirmations: 1,
          fee: createMoney(lamportsToSol(tx.meta.fee).toNumber(), 'SOL'),
          from: type === 'transfer_out' ? userAddress : '',
          gasPrice: undefined,
          gasUsed: undefined,
          hash: tx.transaction.signatures?.[0] || '',
          nonce: undefined,
          status: tx.meta.err ? 'failed' : 'success',
          timestamp: tx.blockTime || 0,
          to: type === 'transfer_in' ? userAddress : '',
          tokenContract: postBalance.mint,
          tokenSymbol,
          type: 'token_transfer',
          value: createMoney(Math.abs(change), tokenSymbol),
        };
      }

      return null;
    } catch (error) {
      this.logger.debug(
        `Failed to extract token transaction - Signature: ${tx.transaction.signatures?.[0]}, Error: ${error instanceof Error ? error.message : String(error)}`
      );
      return null;
    }
  }

  private async fetchTokenAccountTransactions(
    tokenAccountAddresses: string[],
    since?: number,
    ownerAddress?: string
  ): Promise<BlockchainTransaction[]> {
    const allTokenTransactions: BlockchainTransaction[] = [];

    for (const tokenAccount of tokenAccountAddresses) {
      try {
        // Get signatures for this token account
        const signaturesResponse = await this.httpClient.post<JsonRpcResponse<HeliusSignatureResponse[]>>('/', {
          id: 1,
          jsonrpc: '2.0',
          method: 'getSignaturesForAddress',
          params: [
            tokenAccount,
            {
              limit: 50, // Limit per token account to avoid overwhelming
            },
          ],
        });

        if (!signaturesResponse?.result?.length) {
          continue;
        }

        // Fetch transaction details for token account signatures
        for (const sig of signaturesResponse.result.slice(0, 20)) {
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

            if (txResponse?.result) {
              // Transform transaction but link it back to the owner address
              // For token account transactions, we bypass the relevance check since we found it via token account
              const blockchainTx = await this.transformTokenAccountTransaction(
                txResponse.result,
                ownerAddress || tokenAccount
              );
              if (blockchainTx && (!since || blockchainTx.timestamp >= since)) {
                allTokenTransactions.push(blockchainTx);
              }
            }
          } catch (error) {
            this.logger.debug(
              `Failed to fetch token account transaction - TokenAccount: ${maskAddress(tokenAccount)}, Signature: ${sig.signature}, Error: ${error instanceof Error ? error.message : String(error)}`
            );
          }
        }
      } catch (error) {
        this.logger.warn(
          `Failed to get signatures for token account - TokenAccount: ${maskAddress(tokenAccount)}, Error: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    return allTokenTransactions;
  }

  /**
   * Fetch token symbol from Helius DAS API
   */
  private async fetchTokenSymbolFromAPI(mintAddress: string): Promise<string> {
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
        // Store metadata for potential scam detection
        const metadata = response.result.content.metadata;
        this.storeTokenMetadata(mintAddress, metadata);
        return response.result.content.metadata.symbol;
      }

      if (response?.result?.content?.metadata?.name) {
        // Use name if symbol not available
        const metadata = response.result.content.metadata;
        this.storeTokenMetadata(mintAddress, metadata);
        return response.result.content.metadata.name;
      }

      throw new Error('No symbol or name found in metadata');
    } catch (error) {
      throw new Error(`API lookup failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async getAddressBalance(params: { address: string }): Promise<Balance> {
    const { address } = params;

    if (!isValidSolanaAddress(address)) {
      throw new Error(`Invalid Solana address: ${address}`);
    }

    this.logger.debug(`Fetching address balance - Address: ${maskAddress(address)}, Network: ${this.network}`);

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

      const lamports = new Decimal(response.result.value);
      const solBalance = lamportsToSol(lamports.toNumber());

      this.logger.debug(
        `Successfully retrieved address balance - Address: ${maskAddress(address)}, BalanceSOL: ${solBalance.toNumber()}, Network: ${this.network}`
      );

      return {
        balance: solBalance.toNumber(),
        currency: 'SOL',
        total: solBalance.toNumber(),
        used: 0,
      };
    } catch (error) {
      this.logger.error(
        `Failed to get address balance - Address: ${maskAddress(address)}, Network: ${this.network}, Error: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }

  private async getAddressTransactions(params: {
    address: string;
    since?: number | undefined;
  }): Promise<BlockchainTransaction[]> {
    const { address, since } = params;

    if (!isValidSolanaAddress(address)) {
      throw new Error(`Invalid Solana address: ${address}`);
    }

    this.logger.debug(
      `Fetching address transactions with token account discovery - Address: ${maskAddress(address)}, Network: ${this.network}`
    );

    try {
      // Step 1: Get direct transactions for the address
      const directTransactions = await this.getDirectAddressTransactions(address, since);

      // Step 2: Get token accounts owned by the address
      const tokenAccounts = await this.getTokenAccountsOwnedByAddress(address);

      // Step 3: Fetch transactions for each token account
      const tokenAccountTransactions = await this.fetchTokenAccountTransactions(tokenAccounts, since, address);

      // Step 4: Combine and deduplicate all transactions
      const allTransactions = this.deduplicateTransactions([...directTransactions, ...tokenAccountTransactions]);

      // Sort by timestamp (newest first)
      allTransactions.sort((a, b) => b.timestamp - a.timestamp);

      this.logger.debug(
        `Successfully retrieved address transactions with token account discovery - Address: ${maskAddress(address)}, DirectTransactions: ${directTransactions.length}, TokenAccounts: ${tokenAccounts.length}, TokenAccountTransactions: ${tokenAccountTransactions.length}, TotalUniqueTransactions: ${allTransactions.length}, Network: ${this.network}`
      );

      return allTransactions;
    } catch (error) {
      this.logger.error(
        `Failed to get address transactions - Address: ${maskAddress(address)}, Network: ${this.network}, Error: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }

  private async getDirectAddressTransactions(address: string, since?: number): Promise<BlockchainTransaction[]> {
    // Get signatures for address (direct involvement)
    const signaturesResponse = await this.httpClient.post<JsonRpcResponse<SolanaSignature[]>>('/', {
      id: 1,
      jsonrpc: '2.0',
      method: 'getSignaturesForAddress',
      params: [
        address,
        {
          limit: 100,
        },
      ],
    });

    if (!signaturesResponse?.result) {
      this.logger.debug(`No direct signatures found - Address: ${maskAddress(address)}`);
      return [];
    }

    const transactions: BlockchainTransaction[] = [];
    const signatures = signaturesResponse.result.slice(0, 50);

    this.logger.debug(`Retrieved direct signatures - Address: ${maskAddress(address)}, Count: ${signatures.length}`);

    // Fetch transaction details individually (free tier doesn't support batch requests)
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

        if (txResponse?.result) {
          const blockchainTx = await this.transformTransaction(txResponse.result, address);
          if (blockchainTx && (!since || blockchainTx.timestamp >= since)) {
            transactions.push(blockchainTx);
          }
        }
      } catch (error) {
        this.logger.debug(
          `Failed to fetch direct transaction details - Signature: ${sig.signature}, Error: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    return transactions;
  }

  private async getTokenAccountsOwnedByAddress(address: string): Promise<string[]> {
    try {
      // Get all token accounts owned by the address
      const tokenAccountsResponse = await this.httpClient.post<JsonRpcResponse<SolanaTokenAccountsResponse>>('/', {
        id: 1,
        jsonrpc: '2.0',
        method: 'getTokenAccountsByOwner',
        params: [
          address,
          {
            programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', // SPL Token Program ID
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

  private async getTokenBalances(params: {
    address: string;
    contractAddresses?: string[] | undefined;
  }): Promise<Balance[]> {
    const { address, contractAddresses } = params;

    if (!isValidSolanaAddress(address)) {
      throw new Error(`Invalid Solana address: ${address}`);
    }

    this.logger.debug(`Fetching token balances - Address: ${maskAddress(address)}, Network: ${this.network}`);

    try {
      // Get all token accounts owned by the address
      const tokenAccountsResponse = await this.httpClient.post<JsonRpcResponse<SolanaTokenAccountsResponse>>('/', {
        id: 1,
        jsonrpc: '2.0',
        method: 'getTokenAccountsByOwner',
        params: [
          address,
          {
            programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', // SPL Token Program ID
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

      const tokenAccounts = tokenAccountsResponse.result.value;
      const balances: Balance[] = [];

      for (const account of tokenAccounts) {
        const accountData = account.account.data.parsed;
        if (!accountData || !accountData.info) continue;

        const tokenInfo = accountData.info;
        const mintAddress = tokenInfo.mint;
        const tokenAmount = tokenInfo.tokenAmount;

        // If specific contract addresses are provided, filter by them
        if (contractAddresses && contractAddresses.length > 0) {
          if (!contractAddresses.includes(mintAddress)) {
            continue;
          }
        }

        // Skip zero balances
        if (!tokenAmount.uiAmount || tokenAmount.uiAmount === 0) {
          continue;
        }

        balances.push({
          balance: tokenAmount.uiAmount,
          contractAddress: mintAddress,
          currency: mintAddress.slice(0, 8), // Use truncated mint address as symbol for now
          total: tokenAmount.uiAmount,
          used: 0,
        });
      }

      this.logger.debug(
        `Successfully retrieved token balances - Address: ${maskAddress(address)}, TotalTokens: ${balances.length}, Network: ${this.network}`
      );

      return balances;
    } catch (error) {
      this.logger.error(
        `Failed to get token balances - Address: ${maskAddress(address)}, Network: ${this.network}, Error: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }

  /**
   * Get token symbol using hybrid approach: static registry first, then API fallback
   */
  private async getTokenSymbol(mintAddress: string): Promise<string> {
    // Check cache first
    if (this.tokenSymbolCache.has(mintAddress)) {
      return this.tokenSymbolCache.get(mintAddress)!;
    }

    // Check static registry
    const knownSymbol = HeliusProvider.KNOWN_TOKENS.get(mintAddress);
    if (knownSymbol) {
      this.tokenSymbolCache.set(mintAddress, knownSymbol);
      this.logger.debug(
        `Found token symbol in static registry - Mint: ${maskAddress(mintAddress)}, Symbol: ${knownSymbol}`
      );
      return knownSymbol;
    }

    // Fallback to Helius DAS API
    try {
      const symbol = await this.fetchTokenSymbolFromAPI(mintAddress);
      this.tokenSymbolCache.set(mintAddress, symbol);
      this.logger.debug(`Fetched token symbol from API - Mint: ${maskAddress(mintAddress)}`);
      return symbol;
    } catch (error) {
      // Final fallback to truncated mint address
      const fallbackSymbol = `${mintAddress.slice(0, 6)}...`;
      this.tokenSymbolCache.set(mintAddress, fallbackSymbol);
      this.logger.warn(
        `Failed to fetch token symbol, using fallback - Mint: ${maskAddress(mintAddress)}, Symbol: ${fallbackSymbol}, Error: ${error instanceof Error ? error.message : String(error)}`
      );
      return fallbackSymbol;
    }
  }

  private async getTokenTransactions(params: {
    address: string;
    contractAddress?: string | undefined;
    since?: number | undefined;
  }): Promise<BlockchainTransaction[]> {
    const { address, contractAddress, since } = params;

    if (!isValidSolanaAddress(address)) {
      throw new Error(`Invalid Solana address: ${address}`);
    }

    this.logger.debug(`Fetching token transactions - Address: ${maskAddress(address)}, Network: ${this.network}`);

    try {
      // Get signatures for address (same as regular transactions)
      const signaturesResponse = await this.httpClient.post<JsonRpcResponse<HeliusSignatureResponse[]>>('/', {
        id: 1,
        jsonrpc: '2.0',
        method: 'getSignaturesForAddress',
        params: [
          address,
          {
            limit: 1000, // Increase limit to find historical token transactions
          },
        ],
      });

      if (!signaturesResponse?.result) {
        this.logger.debug(`No signatures found for token transactions - Address: ${maskAddress(address)}`);
        return [];
      }

      const signatures = signaturesResponse.result.slice(0, 100); // Process more signatures for token transactions
      const tokenTransactions: BlockchainTransaction[] = [];

      // Process signatures individually to find token transactions (free tier doesn't support batch requests)
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

          if (txResponse?.result) {
            const tokenTx = await this.extractTokenTransaction(txResponse.result, address, contractAddress);
            if (tokenTx && (!since || tokenTx.timestamp >= since)) {
              tokenTransactions.push(tokenTx);
            }
          }
        } catch (error) {
          this.logger.debug(
            `Failed to fetch token transaction details - Signature: ${sig.signature}, Error: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }

      tokenTransactions.sort((a, b) => b.timestamp - a.timestamp);

      this.logger.debug(
        `Successfully retrieved token transactions - Address: ${maskAddress(address)}, TotalTransactions: ${tokenTransactions.length}, Network: ${this.network}`
      );

      return tokenTransactions;
    } catch (error) {
      this.logger.error(
        `Failed to get token transactions - Address: ${maskAddress(address)}, Network: ${this.network}, Error: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
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

  private async transformTokenAccountTransaction(
    tx: HeliusTransaction,
    userAddress: string
  ): Promise<BlockchainTransaction | null> {
    try {
      // For token account transactions, we bypass the accountKeys relevance check
      // since we already know this transaction affects the user's token accounts

      // First check for token transfers - these are more important than SOL transfers
      const tokenTransaction = await this.extractTokenTransaction(tx, userAddress);
      if (tokenTransaction) {
        return tokenTransaction;
      }

      // Fall back to SOL transfer handling (similar to transformTransaction but without relevance check)
      const accountKeys = tx.transaction.message.accountKeys;
      const userIndex = accountKeys.findIndex(key => key === userAddress);

      if (userIndex !== -1) {
        // User is directly involved, use normal processing
        const preBalance = tx.meta.preBalances[userIndex] || 0;
        const postBalance = tx.meta.postBalances[userIndex] || 0;
        const rawBalanceChange = postBalance - preBalance;

        // For fee payer, add back the fee to get the actual transfer amount
        const isFeePayerIndex = userIndex === 0;
        const feeAdjustment = isFeePayerIndex ? tx.meta.fee : 0;
        const balanceChange = rawBalanceChange + feeAdjustment;

        const amount = lamportsToSol(Math.abs(balanceChange));
        const type: 'transfer_in' | 'transfer_out' = balanceChange > 0 ? 'transfer_in' : 'transfer_out';
        const fee = lamportsToSol(tx.meta.fee);

        // Skip transactions with no meaningful amount (pure fee transactions)
        if (amount.toNumber() <= fee.toNumber() && amount.toNumber() < 0.000001) {
          this.logger.debug(
            `Skipping fee-only token account transaction - Hash: ${tx.transaction.signatures?.[0]}, Amount: ${amount.toNumber()}, Fee: ${fee.toNumber()}`
          );
          return null;
        }

        return {
          blockHash: '',
          blockNumber: tx.slot,
          confirmations: 1,
          fee: createMoney(fee.toNumber(), 'SOL'),
          from: accountKeys?.[0] || '',
          gasPrice: undefined,
          gasUsed: undefined,
          hash: tx.transaction.signatures?.[0] || '',
          nonce: undefined,
          status: tx.meta.err ? 'failed' : 'success',
          timestamp: tx.blockTime || 0,
          to: '',
          tokenContract: undefined,
          tokenSymbol: 'SOL',
          type,
          value: createMoney(amount.toNumber(), 'SOL'),
        };
      }

      // User not directly involved but we found this via token account - still check for token changes
      this.logger.debug(
        `Token account transaction found via token account but user not in accountKeys - Signature: ${tx.transaction.signatures?.[0]}, UserAddress: ${maskAddress(userAddress)}`
      );

      return null;
    } catch (error) {
      this.logger.warn(
        `Failed to transform token account transaction - Signature: ${tx.transaction.signatures?.[0]}, Error: ${error instanceof Error ? error.message : String(error)}`
      );
      return null;
    }
  }

  private async transformTransaction(
    tx: HeliusTransaction,
    userAddress: string
  ): Promise<BlockchainTransaction | null> {
    try {
      const accountKeys = tx.transaction.message.accountKeys;
      const userIndex = accountKeys.findIndex(key => key === userAddress);

      if (userIndex === -1) {
        this.logger.debug(`Transaction not relevant to user - Signature: ${tx.transaction.signatures?.[0]}`);
        return null;
      }

      // First check for token transfers - these are more important than SOL transfers
      const tokenTransaction = await this.extractTokenTransaction(tx, userAddress);
      if (tokenTransaction) {
        return tokenTransaction;
      }

      // Fall back to SOL transfer handling
      const preBalance = tx.meta.preBalances[userIndex] || 0;
      const postBalance = tx.meta.postBalances[userIndex] || 0;
      const rawBalanceChange = postBalance - preBalance;

      // For fee payer, add back the fee to get the actual transfer amount
      const isFeePayerIndex = userIndex === 0;
      const feeAdjustment = isFeePayerIndex ? tx.meta.fee : 0;
      const balanceChange = rawBalanceChange + feeAdjustment;

      const amount = lamportsToSol(Math.abs(balanceChange));
      const type: 'transfer_in' | 'transfer_out' = balanceChange > 0 ? 'transfer_in' : 'transfer_out';
      const fee = lamportsToSol(tx.meta.fee);

      // Skip transactions with no meaningful amount (pure fee transactions)
      if (amount.toNumber() <= fee.toNumber() && amount.toNumber() < 0.000001) {
        this.logger.debug(
          `Skipping fee-only transaction - Hash: ${tx.transaction.signatures?.[0]}, Amount: ${amount.toNumber()}, Fee: ${fee.toNumber()}`
        );
        return null;
      }

      return {
        blockHash: '',
        blockNumber: tx.slot,
        confirmations: 1,
        fee: createMoney(fee.toNumber(), 'SOL'),
        from: accountKeys?.[0] || '',
        gasPrice: undefined,
        gasUsed: undefined,
        hash: tx.transaction.signatures?.[0] || '',
        nonce: undefined,
        status: tx.meta.err ? 'failed' : 'success',
        timestamp: tx.blockTime || 0,
        to: '',
        tokenContract: undefined,
        tokenSymbol: 'SOL',
        type,
        value: createMoney(amount.toNumber(), 'SOL'),
      };
    } catch (error) {
      this.logger.warn(
        `Failed to transform transaction - Signature: ${tx.transaction.signatures?.[0]}, Error: ${error instanceof Error ? error.message : String(error)}`
      );
      return null;
    }
  }

  async execute<T>(operation: ProviderOperation<T>): Promise<T> {
    this.logger.debug(
      `Executing operation - Type: ${operation.type}, Address: ${'address' in operation ? maskAddress(operation.address as string) : 'N/A'}`
    );

    try {
      switch (operation.type) {
        case 'getAddressTransactions':
          return this.getAddressTransactions({
            address: operation.address,
            since: operation.since,
          }) as T;
        case 'getAddressBalance':
          return this.getAddressBalance({
            address: operation.address,
          }) as T;
        case 'getTokenTransactions':
          return this.getTokenTransactions({
            address: operation.address,
            contractAddress: operation.contractAddress,
            since: operation.since,
          }) as T;
        case 'getTokenBalances':
          return this.getTokenBalances({
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
