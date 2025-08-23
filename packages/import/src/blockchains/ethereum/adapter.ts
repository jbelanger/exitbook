import type {
  Balance,
  BlockchainTransaction,
  TransactionType,
  UniversalAdapterInfo,
  UniversalBalance,
  UniversalBlockchainAdapterConfig,
  UniversalFetchParams,
  UniversalTransaction,
} from "@crypto/core";

import { BaseAdapter } from "../../shared/adapters/base-adapter.ts";
import { BlockchainProviderManager } from "../shared/blockchain-provider-manager.ts";
import type { BlockchainExplorersConfig } from "../shared/explorer-config.ts";
import type {
  AddressTransactionParams,
  TokenTransactionParams,
  AddressBalanceParams,
} from "../shared/types.ts";

export class EthereumAdapter extends BaseAdapter {
  private providerManager: BlockchainProviderManager;

  constructor(
    config: UniversalBlockchainAdapterConfig,
    explorerConfig: BlockchainExplorersConfig,
  ) {
    super(config);

    this.providerManager = new BlockchainProviderManager(explorerConfig);
    this.providerManager.autoRegisterFromConfig("ethereum", "mainnet");

    this.logger.info(
      `Initialized Ethereum adapter with registry-based provider manager - ProvidersCount: ${this.providerManager.getProviders("ethereum").length}`,
    );
  }

  async getInfo(): Promise<UniversalAdapterInfo> {
    return {
      id: "ethereum",
      name: "Ethereum",
      type: "blockchain",
      subType: "rest",
      capabilities: {
        supportedOperations: ["fetchTransactions", "fetchBalances"],
        maxBatchSize: 1,
        supportsHistoricalData: true,
        supportsPagination: true,
        requiresApiKey: false,
        rateLimit: {
          requestsPerSecond: 5,
          burstLimit: 20,
        },
      },
    };
  }

  protected async fetchRawTransactions(
    params: UniversalFetchParams,
  ): Promise<BlockchainTransaction[]> {
    if (!params.addresses?.length) {
      throw new Error("Addresses required for Ethereum adapter");
    }

    const allTransactions: BlockchainTransaction[] = [];

    for (const address of params.addresses) {
      this.logger.info(
        `EthereumAdapter: Fetching transactions for address: ${address.substring(0, 20)}...`,
      );

      try {
        // Fetch regular ETH transactions
        const regularTxs = (await this.providerManager.executeWithFailover(
          "ethereum",
          {
            type: "getAddressTransactions",
            address: address,
            since: params.since,
            getCacheKey: (cacheParams) =>
              `eth_tx_${cacheParams.type === 'getAddressTransactions' ? cacheParams.address : 'unknown'}_${cacheParams.type === 'getAddressTransactions' ? cacheParams.since || "all" : 'unknown'}`,
          },
        )) as BlockchainTransaction[];

        // Try to fetch ERC-20 token transactions (if provider supports it)
        let tokenTxs: BlockchainTransaction[] = [];
        try {
          tokenTxs = (await this.providerManager.executeWithFailover(
            "ethereum",
            {
              type: "getTokenTransactions",
              address: address,
              since: params.since,
              getCacheKey: (cacheParams) =>
                `eth_token_tx_${cacheParams.type === 'getTokenTransactions' ? cacheParams.address : 'unknown'}_${cacheParams.type === 'getTokenTransactions' ? cacheParams.since || "all" : 'unknown'}`,
            },
          )) as BlockchainTransaction[];
        } catch (error) {
          this.logger.debug(
            `Provider does not support separate token transactions or failed to fetch - Error: ${error instanceof Error ? error.message : String(error)}`,
          );
          // Continue without separate token transactions - provider may already include them in getAddressTransactions
        }

        allTransactions.push(...regularTxs, ...tokenTxs);

        this.logger.info(
          `EthereumAdapter transaction breakdown for ${address.substring(0, 20)}... - Regular: ${regularTxs.length}, Token: ${tokenTxs.length}`,
        );
      } catch (error) {
        this.logger.error(
          `Failed to fetch transactions for ${address} - Error: ${error}`,
        );
        throw error;
      }
    }

    // Remove duplicates and sort by timestamp
    const uniqueTransactions = allTransactions.reduce((acc, tx) => {
      if (!acc.find((existing) => existing.hash === tx.hash)) {
        acc.push(tx);
      }
      return acc;
    }, [] as BlockchainTransaction[]);

    uniqueTransactions.sort((a, b) => b.timestamp - a.timestamp);

    this.logger.info(
      `EthereumAdapter: Found ${uniqueTransactions.length} unique transactions total`,
    );
    return uniqueTransactions;
  }

  protected async fetchRawBalances(
    params: UniversalFetchParams,
  ): Promise<Balance[]> {
    if (!params.addresses?.length) {
      throw new Error("Addresses required for Ethereum balance fetching");
    }

    const allBalances: Balance[] = [];

    for (const address of params.addresses) {
      this.logger.info(
        `Getting balance for address: ${address.substring(0, 20)}...`,
      );

      try {
        const balances = (await this.providerManager.executeWithFailover(
          "ethereum",
          {
            type: "getAddressBalance",
            address: address,
            getCacheKey: (cacheParams) =>
              `eth_balance_${cacheParams.type === 'getAddressBalance' ? cacheParams.address : 'unknown'}`,
          },
        )) as Balance[];

        allBalances.push(...balances);
      } catch (error) {
        this.logger.error(
          `Failed to fetch balance for ${address} - Error: ${error}`,
        );
        throw error;
      }
    }

    return allBalances;
  }

  protected async transformTransactions(
    rawTxs: BlockchainTransaction[],
    params: UniversalFetchParams,
  ): Promise<UniversalTransaction[]> {
    const userAddresses = params.addresses || [];

    return rawTxs.map((tx) => {
      // Determine transaction type based on user addresses
      let type: TransactionType = "transfer";

      if (userAddresses.length > 0) {
        const userAddress = userAddresses[0].toLowerCase();
        const isIncoming = tx.to.toLowerCase() === userAddress;
        const isOutgoing = tx.from.toLowerCase() === userAddress;

        if (isIncoming && !isOutgoing) {
          type = "deposit";
        } else if (isOutgoing && !isIncoming) {
          type = "withdrawal";
        }
      }

      return {
        id: tx.hash,
        timestamp: tx.timestamp,
        datetime: new Date(tx.timestamp).toISOString(),
        type,
        status:
          tx.status === "success"
            ? "closed"
            : tx.status === "pending"
              ? "open"
              : "canceled",
        amount: tx.value,
        fee: tx.fee,
        from: tx.from,
        to: tx.to,
        symbol: tx.tokenSymbol || tx.value.currency,
        source: "ethereum",
        network: "mainnet",
        metadata: {
          blockNumber: tx.blockNumber,
          blockHash: tx.blockHash,
          confirmations: tx.confirmations,
          tokenContract: tx.tokenContract,
          transactionType: tx.type,
          originalTransaction: tx,
        },
      };
    });
  }

  protected async transformBalances(
    rawBalances: Balance[],
    params: UniversalFetchParams,
  ): Promise<UniversalBalance[]> {
    return rawBalances.map((balance) => ({
      currency: balance.currency,
      total: balance.total,
      free: balance.balance,
      used: balance.used,
      contractAddress: balance.contractAddress,
    }));
  }

  async testConnection(): Promise<boolean> {
    this.logger.debug("EthereumAdapter.testConnection called");
    try {
      const providers = this.providerManager.getProviders("ethereum");
      this.logger.debug(`Found ${providers.length} providers`);
      if (providers.length === 0) {
        this.logger.warn("No providers available for connection test");
        return false;
      }

      // Test the first provider
      const result = (await providers[0]?.testConnection()) || false;
      this.logger.debug(`Connection test result: ${result}`);
      return result;
    } catch (error) {
      this.logger.error(`Connection test failed - Error: ${error}`);
      return false;
    }
  }

  /**
   * Close adapter and cleanup resources
   */
  async close(): Promise<void> {
    try {
      this.providerManager.destroy();
      this.logger.info("Ethereum adapter closed successfully");
    } catch (error) {
      this.logger.warn(`Error during Ethereum adapter close - Error: ${error}`);
    }
  }
}
