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

import "./providers/SnowtraceProvider.ts";

import { BaseAdapter } from "../../shared/adapters/base-adapter.ts";
import { BlockchainProviderManager } from "../shared/blockchain-provider-manager.ts";
import type { BlockchainExplorersConfig } from "../shared/explorer-config.ts";
import type {
  AddressTransactionParams,
  TokenTransactionParams,
  AddressBalanceParams,
} from "../shared/types.ts";

export class AvalancheAdapter extends BaseAdapter {
  private providerManager: BlockchainProviderManager;

  constructor(
    config: UniversalBlockchainAdapterConfig,
    explorerConfig: BlockchainExplorersConfig,
  ) {
    super(config);

    this.providerManager = new BlockchainProviderManager(explorerConfig);
    this.providerManager.autoRegisterFromConfig("avalanche", "mainnet");

    this.logger.debug(
      `Initialized Avalanche adapter with ${this.providerManager.getProviders("avalanche").length} providers`,
    );
  }

  async getInfo(): Promise<UniversalAdapterInfo> {
    return {
      id: "avalanche",
      name: "Avalanche C-Chain",
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
      throw new Error("Addresses required for Avalanche adapter");
    }

    const allTransactions: BlockchainTransaction[] = [];

    for (const address of params.addresses) {
      this.logger.info(
        `AvalancheAdapter: Fetching transactions for address: ${address.substring(0, 20)}...`,
      );

      try {
        // Fetch regular AVAX transactions
        const regularTxs = (await this.providerManager.executeWithFailover(
          "avalanche",
          {
            type: "getAddressTransactions",
            params: { address, since: params.since },
            getCacheKey: (cacheParams) =>
              `avax_tx_${(cacheParams as AddressTransactionParams).address}_${(cacheParams as AddressTransactionParams).since || "all"}`,
          },
        )) as BlockchainTransaction[];

        // Try to fetch ERC-20 token transactions (if provider supports it)
        let tokenTxs: BlockchainTransaction[] = [];
        try {
          tokenTxs = (await this.providerManager.executeWithFailover(
            "avalanche",
            {
              type: "getTokenTransactions",
              params: { address, since: params.since },
              getCacheKey: (cacheParams) =>
                `avax_token_tx_${(cacheParams as TokenTransactionParams).address}_${(cacheParams as TokenTransactionParams).since || "all"}`,
            },
          )) as BlockchainTransaction[];
        } catch (error) {
          this.logger.debug(
            `Provider does not support separate token transactions or failed to fetch: ${error instanceof Error ? error.message : String(error)}`,
          );
          // Continue without separate token transactions - provider may already include them in getAddressTransactions
        }

        allTransactions.push(...regularTxs, ...tokenTxs);

        this.logger.debug(
          `Transaction breakdown: ${regularTxs.length} regular, ${tokenTxs.length} token`,
        );
      } catch (error) {
        this.logger.error(
          `Failed to fetch address transactions via provider manager - Address: ${address}, Error: ${error instanceof Error ? error.message : String(error)}`,
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

    this.logger.debug(
      `AvalancheAdapter: Found ${uniqueTransactions.length} unique transactions total`,
    );
    return uniqueTransactions;
  }

  protected async fetchRawBalances(
    params: UniversalFetchParams,
  ): Promise<Balance[]> {
    if (!params.addresses?.length) {
      throw new Error("Addresses required for Avalanche balance fetching");
    }

    const allBalances: Balance[] = [];

    for (const address of params.addresses) {
      this.logger.debug(
        `AvalancheAdapter.getAddressBalance called - Address: ${address}`,
      );

      try {
        const balances = (await this.providerManager.executeWithFailover(
          "avalanche",
          {
            type: "getAddressBalance",
            params: { address },
            getCacheKey: (cacheParams) =>
              `avax_balance_${(cacheParams as AddressBalanceParams).address}`,
          },
        )) as Balance[];

        allBalances.push(...balances);
        this.logger.info(
          `AvalancheAdapter: Found ${balances.length} balances for address`,
        );
      } catch (error) {
        this.logger.error(
          `Failed to fetch address balance via provider manager - Address: ${address}, Error: ${error instanceof Error ? error.message : String(error)}`,
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
        source: "avalanche",
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
    this.logger.debug("AvalancheAdapter.testConnection called");

    try {
      // Test connection using provider manager
      const providers = this.providerManager.getProviders("avalanche");
      if (providers.length === 0) {
        this.logger.warn(
          "No Avalanche providers available for connection test",
        );
        return false;
      }

      // Test the first healthy provider
      for (const provider of providers) {
        try {
          const isHealthy = await provider.isHealthy();
          if (isHealthy) {
            this.logger.info(
              `Connection test successful with provider: ${provider.name}`,
            );
            return true;
          }
        } catch (error) {
          this.logger.debug(
            `Provider ${provider.name} failed health check - Error: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      this.logger.warn("All Avalanche providers failed connection test");
      return false;
    } catch (error) {
      this.logger.error(
        `Connection test failed - Error: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  /**
   * Close adapter and cleanup resources
   */
  async close(): Promise<void> {
    try {
      this.providerManager.destroy();
      this.logger.info("Avalanche adapter closed successfully");
    } catch (error) {
      this.logger.warn(
        `Error during Avalanche adapter close - Error: ${error}`,
      );
    }
  }

  // Legacy methods for compatibility (can be removed once migration is complete)
  validateAddress(address: string): boolean {
    // Avalanche C-Chain uses Ethereum-style addresses but they are case-sensitive
    const ethAddressRegex = /^0x[a-fA-F0-9]{40}$/;
    const isValid = ethAddressRegex.test(address);

    this.logger.debug(
      `Address validation - Address: ${address}, IsValid: ${isValid}`,
    );
    return isValid;
  }
}
