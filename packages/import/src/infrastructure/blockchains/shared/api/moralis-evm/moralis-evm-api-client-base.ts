import { maskAddress } from '@exitbook/shared-utils';

import type { ProviderOperation } from '../../../shared/types.js';
import { BlockchainApiClient } from '../blockchain-api-client.ts';

import type {
  MoralisNativeBalance,
  MoralisTransaction,
  MoralisTransactionResponse,
  MoralisTokenBalance,
  MoralisTokenTransfer,
  MoralisTokenTransferResponse,
} from './moralis.types.ts';

export interface MoralisChainConfig {
  /** Moralis chain identifier (e.g., 'eth', 'avalanche', '0xa86a') */
  chainId: string;
  /** Token standard for the chain (e.g., 'erc20' for EVM chains) */
  tokenStandard: string;
}

/**
 * Base Moralis API client for EVM-compatible blockchains
 * Supports Ethereum, Avalanche, and other EVM chains
 */
export abstract class MoralisEvmApiClientBase extends BlockchainApiClient {
  protected readonly chainConfig: MoralisChainConfig;

  constructor(blockchain: string, providerName: string, networkType: string, chainConfig: MoralisChainConfig) {
    super(blockchain, providerName, networkType);
    this.chainConfig = chainConfig;

    // Moralis requires API key in x-api-key header
    this.reinitializeHttpClient({
      defaultHeaders: {
        'x-api-key': this.apiKey,
      },
    });

    this.logger.debug(
      `Initialized MoralisEvmApiClientBase for ${blockchain} - Chain: ${chainConfig.chainId}, BaseUrl: ${this.baseUrl}`
    );
  }

  async execute<T>(operation: ProviderOperation<T>): Promise<T> {
    this.logger.debug(`Executing operation: ${operation.type}`);

    switch (operation.type) {
      case 'getRawAddressTransactions': {
        const { address, since } = operation;
        this.logger.debug(`Fetching raw address transactions - Address: ${maskAddress(address)}`);
        return this.getRawAddressTransactions(address, since) as Promise<T>;
      }
      case 'getRawAddressBalance': {
        const { address } = operation;
        this.logger.debug(`Fetching raw address balance - Address: ${maskAddress(address)}`);
        return this.getRawAddressBalance(address) as Promise<T>;
      }
      case 'getTokenTransactions': {
        const { address, contractAddress, since } = operation;
        this.logger.debug(
          `Fetching token transactions - Address: ${maskAddress(address)}, Contract: ${contractAddress || 'all'}`
        );
        return this.getTokenTransactions(address, contractAddress, since) as Promise<T>;
      }
      case 'getRawTokenBalances': {
        const { address, contractAddresses } = operation;
        this.logger.debug(`Fetching raw token balances - Address: ${maskAddress(address)}`);
        return this.getRawTokenBalances(address, contractAddresses) as Promise<T>;
      }
      default:
        throw new Error(`Unsupported operation: ${operation.type}`);
    }
  }

  getHealthCheckConfig() {
    return {
      endpoint: `/dateToBlock?chain=${this.chainConfig.chainId}&date=2023-01-01T00:00:00.000Z`,
      validate: (response: unknown) => {
        const data = response as { block: number };
        return data && typeof data.block === 'number';
      },
    };
  }

  private async getRawAddressBalance(address: string): Promise<MoralisNativeBalance> {
    try {
      const params = new URLSearchParams({
        chain: this.chainConfig.chainId,
      });

      const endpoint = `/${address}/balance?${params.toString()}`;
      const response: MoralisNativeBalance = await this.httpClient.get(endpoint);

      this.logger.debug(`Found raw native balance for ${address}: ${response.balance}`);
      return response;
    } catch (error) {
      this.logger.error(
        `Failed to fetch raw address balance for ${address} - Error: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }

  private async getRawAddressTransactions(address: string, since?: number): Promise<MoralisTransaction[]> {
    try {
      const transactions: MoralisTransaction[] = [];
      let cursor: string | null | undefined;
      let pageCount = 0;
      const maxPages = 100; // Safety limit to prevent infinite loops

      do {
        const params = new URLSearchParams({
          chain: this.chainConfig.chainId,
          limit: '100',
        });

        if (since) {
          const sinceDate = new Date(since).toISOString();
          params.append('from_date', sinceDate);
        }

        if (cursor) {
          params.append('cursor', cursor);
        }

        const endpoint = `/${address}?${params.toString()}`;
        const response = await this.httpClient.get<MoralisTransactionResponse>(endpoint);

        const pageTransactions = response.result || [];
        transactions.push(...pageTransactions);
        cursor = response.cursor;
        pageCount++;

        this.logger.debug(
          `Fetched page ${pageCount}: ${pageTransactions.length} transactions${cursor ? ' (more pages available)' : ' (last page)'}`
        );

        // Safety check to prevent infinite pagination
        if (pageCount >= maxPages) {
          this.logger.warn(`Reached maximum page limit (${maxPages}), stopping pagination`);
          break;
        }
      } while (cursor);

      this.logger.debug(`Found ${transactions.length} total raw address transactions for ${address}`);
      return transactions;
    } catch (error) {
      this.logger.error(
        `Failed to fetch raw address transactions for ${address} - Error: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }

  private async getRawTokenBalances(address: string, contractAddresses?: string[]): Promise<MoralisTokenBalance[]> {
    try {
      const params = new URLSearchParams({
        chain: this.chainConfig.chainId,
      });

      if (contractAddresses) {
        contractAddresses.forEach((contract) => {
          params.append('token_addresses[]', contract);
        });
      }

      const endpoint = `/${address}/${this.chainConfig.tokenStandard}?${params.toString()}`;
      const response = await this.httpClient.get<MoralisTokenBalance[]>(endpoint);

      const balances = response || [];
      this.logger.debug(`Found ${balances.length} raw token balances for ${address}`);
      return balances;
    } catch (error) {
      this.logger.error(
        `Failed to fetch raw token balances for ${address} - Error: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }

  private async getTokenTransactions(
    address: string,
    contractAddress?: string,
    since?: number
  ): Promise<MoralisTokenTransfer[]> {
    try {
      const transfers: MoralisTokenTransfer[] = [];
      let cursor: string | null | undefined;
      let pageCount = 0;
      const maxPages = 100; // Safety limit to prevent infinite loops

      do {
        const params = new URLSearchParams({
          chain: this.chainConfig.chainId,
          limit: '100',
        });

        if (since) {
          const sinceDate = new Date(since).toISOString();
          params.append('from_date', sinceDate);
        }

        if (contractAddress) {
          params.append('contract_addresses[]', contractAddress);
        }

        if (cursor) {
          params.append('cursor', cursor);
        }

        const endpoint = `/${address}/${this.chainConfig.tokenStandard}/transfers?${params.toString()}`;
        const response = await this.httpClient.get<MoralisTokenTransferResponse>(endpoint);

        const pageTransfers = response.result || [];
        transfers.push(...pageTransfers);
        cursor = response.cursor;
        pageCount++;

        this.logger.debug(
          `Fetched page ${pageCount}: ${pageTransfers.length} token transfers${cursor ? ' (more pages available)' : ' (last page)'}`
        );

        // Safety check to prevent infinite pagination
        if (pageCount >= maxPages) {
          this.logger.warn(`Reached maximum page limit (${maxPages}), stopping pagination`);
          break;
        }
      } while (cursor);

      this.logger.debug(`Found ${transfers.length} total raw token transactions for ${address}`);
      return transfers;
    } catch (error) {
      this.logger.error(
        `Failed to fetch raw token transactions for ${address} - Error: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }
}
