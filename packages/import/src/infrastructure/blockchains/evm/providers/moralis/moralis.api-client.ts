import { maskAddress } from '@exitbook/shared-utils';

import type { ProviderConfig } from '../../../shared/index.ts';
import { RegisterApiClient, BlockchainApiClient } from '../../../shared/index.ts';
import type { ProviderOperation } from '../../../shared/types.ts';
import type { EvmChainConfig } from '../../chain-config.interface.ts';
import { getEvmChainConfig } from '../../chain-registry.ts';

import type {
  MoralisNativeBalance,
  MoralisTransaction,
  MoralisTransactionResponse,
  MoralisTokenBalance,
  MoralisTokenTransfer,
  MoralisTokenTransferResponse,
} from './moralis.types.ts';

/**
 * Maps EVM chain names to Moralis-specific chain identifiers
 */
const CHAIN_ID_MAP: Record<string, string> = {
  avalanche: 'avalanche',
  ethereum: 'eth',
  polygon: 'polygon',
};

@RegisterApiClient({
  apiKeyEnvVar: 'MORALIS_API_KEY',
  baseUrl: 'https://deep-index.moralis.io/api/v2',
  blockchain: 'ethereum',
  capabilities: {
    supportedOperations: [
      'getRawAddressTransactions',
      'getRawAddressInternalTransactions',
      'getRawAddressBalance',
      'getTokenTransactions',
      'getRawTokenBalances',
    ],
  },
  defaultConfig: {
    rateLimit: {
      burstLimit: 5,
      requestsPerHour: 1000,
      requestsPerMinute: 120,
      requestsPerSecond: 2,
    },
    retries: 3,
    timeout: 10000,
  },
  description: 'Moralis API with comprehensive Web3 data and multi-chain EVM support',
  displayName: 'Moralis',
  name: 'moralis',
  requiresApiKey: true,
  supportedChains: ['ethereum', 'avalanche', 'polygon'],
})
export class MoralisApiClient extends BlockchainApiClient {
  private readonly chainConfig: EvmChainConfig;
  private readonly moralisChainId: string;

  constructor(config: ProviderConfig) {
    super(config);

    // Get EVM chain config
    const evmChainConfig = getEvmChainConfig(config.blockchain);
    if (!evmChainConfig) {
      throw new Error(`Unsupported blockchain: ${config.blockchain}`);
    }
    this.chainConfig = evmChainConfig;

    // Map to Moralis chain ID
    const mappedChainId = CHAIN_ID_MAP[config.blockchain];
    if (!mappedChainId) {
      throw new Error(`No Moralis chain ID mapping for blockchain: ${config.blockchain}`);
    }
    this.moralisChainId = mappedChainId;

    // Moralis requires API key in x-api-key header
    this.reinitializeHttpClient({
      defaultHeaders: {
        'x-api-key': this.apiKey,
      },
    });

    this.logger.debug(
      `Initialized MoralisApiClient for ${config.blockchain} - Moralis Chain ID: ${this.moralisChainId}, BaseUrl: ${this.baseUrl}`
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
      case 'getRawAddressInternalTransactions': {
        const { address, since } = operation;
        this.logger.debug(`Fetching raw address internal transactions - Address: ${maskAddress(address)}`);
        return this.getRawAddressInternalTransactions(address, since) as Promise<T>;
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
      endpoint: `/dateToBlock?chain=${this.moralisChainId}&date=2023-01-01T00:00:00.000Z`,
      validate: (response: unknown) => {
        const data = response as { block: number };
        return data && typeof data.block === 'number';
      },
    };
  }

  private async getRawAddressBalance(address: string): Promise<MoralisNativeBalance> {
    try {
      const params = new URLSearchParams({
        chain: this.moralisChainId,
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
          chain: this.moralisChainId,
          limit: '100',
        });

        if (since) {
          const sinceDate = new Date(since).toISOString();
          params.append('from_date', sinceDate);
        }

        if (cursor) {
          params.append('cursor', cursor);
        }

        // Include internal transactions in the same call for efficiency
        params.append('include', 'internal_transactions');

        const endpoint = `/${address}?${params.toString()}`;
        const response = await this.httpClient.get<MoralisTransactionResponse>(endpoint);

        const pageTransactions = response.result || [];

        // Augment transactions with native currency from chain config
        const augmentedTransactions = pageTransactions.map((tx) => ({
          ...tx,
          _nativeCurrency: this.chainConfig.nativeCurrency,
          _nativeDecimals: this.chainConfig.nativeDecimals,
        })) as MoralisTransaction[];

        transactions.push(...augmentedTransactions);
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

  private getRawAddressInternalTransactions(address: string, _since?: number): Promise<MoralisTransaction[]> {
    // Moralis includes internal transactions automatically when fetching regular transactions
    // with the 'include=internal_transactions' parameter. To avoid duplicate API calls,
    // internal transactions should be fetched via getRawAddressTransactions instead.
    this.logger.info(
      `Moralis internal transactions are included in getRawAddressTransactions call - returning empty array to avoid duplicate fetching for ${maskAddress(address)}`
    );
    return Promise.resolve([]);
  }

  private async getRawTokenBalances(address: string, contractAddresses?: string[]): Promise<MoralisTokenBalance[]> {
    try {
      const params = new URLSearchParams({
        chain: this.moralisChainId,
      });

      if (contractAddresses) {
        contractAddresses.forEach((contract) => {
          params.append('token_addresses[]', contract);
        });
      }

      const endpoint = `/${address}/erc20?${params.toString()}`;
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
          chain: this.moralisChainId,
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

        const endpoint = `/${address}/erc20/transfers?${params.toString()}`;
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
