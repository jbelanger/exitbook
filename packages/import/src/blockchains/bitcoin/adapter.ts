import * as bitcoin from "bitcoinjs-lib";

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
import type { MempoolTransaction, BlockstreamTransaction } from "./types.js";
import { createMoney } from "@crypto/shared-utils";

import { BaseAdapter } from "../../shared/adapters/base-adapter.ts";
import { BlockchainProviderManager } from "../shared/blockchain-provider-manager.ts";
// Parameter types removed - using discriminated union
import type { BlockchainExplorersConfig } from "../shared/explorer-config.ts";
import type { BitcoinWalletAddress } from "./types.ts";
import { BitcoinUtils } from "./utils.ts";

export class BitcoinAdapter extends BaseAdapter {
  private walletAddresses: BitcoinWalletAddress[] = [];
  protected network: bitcoin.Network;
  private addressInfoCache = new Map<
    string,
    { balance: string; txCount: number }
  >(); // Simplified cache
  private providerManager: BlockchainProviderManager;
  private addressGap: number;

  constructor(
    config: UniversalBlockchainAdapterConfig,
    explorerConfig: BlockchainExplorersConfig,
    options?: { addressGap?: number },
  ) {
    super(config);

    // Always use mainnet
    this.network = bitcoin.networks.bitcoin;

    // Set address gap for xpub derivation
    this.addressGap = options?.addressGap || 20;

    // Create and initialize provider manager with registry
    this.providerManager = new BlockchainProviderManager(explorerConfig);
    this.providerManager.autoRegisterFromConfig("bitcoin", "mainnet");

    this.logger.info(
      `Initialized Bitcoin adapter with registry-based provider manager - AddressGap: ${this.addressGap}, ProvidersCount: ${this.providerManager.getProviders("bitcoin").length}`,
    );
  }

  async getInfo(): Promise<UniversalAdapterInfo> {
    return {
      id: "bitcoin",
      name: "Bitcoin",
      type: "blockchain",
      subType: "rest",
      capabilities: {
        supportedOperations: ["fetchTransactions", "fetchBalances"],
        maxBatchSize: 1,
        supportsHistoricalData: true,
        supportsPagination: false,
        requiresApiKey: false,
        rateLimit: {
          requestsPerSecond: 2,
          burstLimit: 10,
        },
      },
    };
  }

  /**
   * Initialize an xpub wallet using BitcoinUtils
   */
  private async initializeXpubWallet(
    walletAddress: BitcoinWalletAddress,
  ): Promise<void> {
    await BitcoinUtils.initializeXpubWallet(
      walletAddress,
      this.network,
      this.providerManager,
      this.addressGap,
    );
  }

  protected async fetchRawTransactions(
    params: UniversalFetchParams,
  ): Promise<BlockchainTransaction[]> {
    if (!params.addresses?.length) {
      throw new Error("Addresses required for Bitcoin adapter");
    }

    const allTransactions: BlockchainTransaction[] = [];

    for (const userAddress of params.addresses) {
      this.logger.info(
        `Fetching transactions for address: ${userAddress.substring(0, 20)}...`,
      );

      let wallet: BitcoinWalletAddress;

      // Check if we've already processed this address
      const existingWallet = this.walletAddresses.find(
        (w) => w.address === userAddress,
      );
      if (existingWallet) {
        wallet = existingWallet;
      } else {
        // Initialize this specific address (handles both xpub and regular addresses)
        wallet = {
          address: userAddress,
          type: BitcoinUtils.getAddressType(userAddress),
        };

        if (BitcoinUtils.isXpub(userAddress)) {
          this.logger.info(
            `Processing xpub: ${userAddress.substring(0, 20)}...`,
          );
          await this.initializeXpubWallet(wallet);
        } else {
          this.logger.info(`Processing regular address: ${userAddress}`);
        }

        this.walletAddresses.push(wallet);
      }

      if (wallet.derivedAddresses) {
        // Xpub wallet - fetch from all derived addresses and deduplicate
        this.logger.info(
          `Fetching from ${wallet.derivedAddresses.length} derived addresses`,
        );
        const walletTransactions =
          await this.fetchUniqueTransactionsForWalletWithProviders(
            wallet.derivedAddresses,
            params.since,
          );
        allTransactions.push(...walletTransactions);
      } else {
        // Regular address - use provider manager with raw transactions for wallet-aware parsing
        try {
          const rawTransactions =
            (await this.providerManager.executeWithFailover("bitcoin", {
              type: "getRawAddressTransactions",
              address: userAddress,
              since: params.since,
              getCacheKey: (cacheParams) =>
                `bitcoin:raw-txs:${cacheParams.type === 'getRawAddressTransactions' ? cacheParams.address : 'unknown'}:${cacheParams.type === 'getRawAddressTransactions' ? cacheParams.since || "all" : 'unknown'}`,
            })) as (MempoolTransaction | BlockstreamTransaction)[];

          // Parse raw transactions with wallet context (single address, local parsing)
          for (const rawTx of rawTransactions) {
            try {
              const blockchainTx = this.parseWalletTransaction(rawTx, [
                userAddress,
              ]);
              allTransactions.push(blockchainTx);
            } catch (error) {
              this.logger.warn(
                `Failed to parse transaction ${rawTx.txid} - Error: ${error}`,
              );
            }
          }
        } catch (error) {
          this.logger.error(
            `Failed to fetch Bitcoin transactions for ${userAddress} - Error: ${error}`,
          );
          throw error;
        }
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
      `BitcoinAdapter: Found ${uniqueTransactions.length} unique transactions total`,
    );
    return uniqueTransactions;
  }

  protected async fetchRawBalances(
    params: UniversalFetchParams,
  ): Promise<Balance[]> {
    if (!params.addresses?.length) {
      throw new Error("Addresses required for Bitcoin balance fetching");
    }

    const allBalances: Balance[] = [];

    for (const address of params.addresses) {
      try {
        const result = (await this.providerManager.executeWithFailover(
          "bitcoin",
          {
            type: "getAddressBalance",
            address: address,
          },
        )) as { balance: string; token: string };

        const balanceValue = parseFloat(result.balance);
        if (balanceValue > 0) {
          allBalances.push({
            currency: "BTC",
            balance: balanceValue,
            used: 0,
            total: balanceValue,
            contractAddress: undefined,
          });
        }
      } catch (error) {
        this.logger.error(
          `Failed to get Bitcoin balance for ${address} - Error: ${error}`,
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
        source: "bitcoin",
        network: "mainnet",
        metadata: {
          blockNumber: tx.blockNumber,
          blockHash: tx.blockHash,
          confirmations: tx.confirmations,
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

  /**
   * Fetch unique raw transactions for an xpub wallet across all derived addresses using provider architecture
   */
  private async fetchUniqueTransactionsForWalletWithProviders(
    derivedAddresses: string[],
    since?: number,
  ): Promise<BlockchainTransaction[]> {
    // Collect all unique transaction hashes and their associated raw transactions
    const uniqueRawTransactions = new Map<
      string,
      MempoolTransaction | BlockstreamTransaction
    >();

    for (const address of derivedAddresses) {
      // Check cache first to see if this address has any transactions
      const cachedInfo = this.addressInfoCache.get(address);

      // Skip addresses that we know are empty from gap scanning
      if (cachedInfo && cachedInfo.txCount === 0) {
        this.logger.debug(
          `Skipping address ${address} - no transactions in cache`,
        );
        continue;
      }

      try {
        const rawTransactions = (await this.providerManager.executeWithFailover(
          "bitcoin",
          {
            type: "getRawAddressTransactions",
            address: address,
            since: since,
            getCacheKey: (params) =>
              `bitcoin:raw-txs:${params.type === 'getRawAddressTransactions' ? params.address : 'unknown'}:${params.type === 'getRawAddressTransactions' ? params.since || "all" : 'unknown'}`,
          },
        )) as (MempoolTransaction | BlockstreamTransaction)[];

        // Add raw transactions to the unique set
        for (const rawTx of rawTransactions) {
          uniqueRawTransactions.set(rawTx.txid, rawTx);
        }

        this.logger.debug(
          `Found ${rawTransactions.length} transactions for address ${address}`,
        );
      } catch (error) {
        this.logger.error(
          `Failed to fetch raw transactions for address ${address} - Error: ${error instanceof Error ? error.message : String(error)}, Stack: ${error instanceof Error ? error.stack : undefined}`,
        );
      }
    }

    this.logger.info(
      `Found ${uniqueRawTransactions.size} unique raw transactions across all addresses`,
    );

    // Parse each unique transaction with wallet context (local parsing, no API calls)
    const blockchainTransactions: BlockchainTransaction[] = [];
    for (const [txid, rawTx] of uniqueRawTransactions) {
      try {
        const blockchainTx = this.parseWalletTransaction(
          rawTx,
          derivedAddresses,
        );
        blockchainTransactions.push(blockchainTx);
      } catch (error) {
        this.logger.warn(
          `Failed to parse transaction ${txid} - Error: ${error}`,
        );
      }
    }

    // Sort by timestamp (newest first)
    blockchainTransactions.sort((a, b) => b.timestamp - a.timestamp);

    return blockchainTransactions;
  }

  /**
   * Parse a raw Bitcoin transaction with wallet context (local parsing, no API calls)
   */
  private parseWalletTransaction(
    tx: MempoolTransaction | BlockstreamTransaction,
    walletAddresses: string[],
  ): BlockchainTransaction {
    const timestamp =
      tx.status.confirmed && tx.status.block_time
        ? tx.status.block_time * 1000
        : Date.now();

    // Calculate transaction value considering all wallet addresses
    let totalValueChange = 0;
    let isIncoming = false;
    let isOutgoing = false;
    const relevantAddresses = new Set(walletAddresses);

    // Check inputs - money going out of our wallet
    for (const input of tx.vin) {
      if (
        input.prevout?.scriptpubkey_address &&
        relevantAddresses.has(input.prevout.scriptpubkey_address)
      ) {
        isOutgoing = true;
        if (input.prevout?.value) {
          totalValueChange -= input.prevout.value;
        }
      }
    }

    // Check outputs - money coming into our wallet
    for (const output of tx.vout) {
      if (
        output.scriptpubkey_address &&
        relevantAddresses.has(output.scriptpubkey_address)
      ) {
        isIncoming = true;
        totalValueChange += output.value;
      }
    }

    // Determine transaction type
    let type:
      | "transfer_in"
      | "transfer_out"
      | "internal_transfer_in"
      | "internal_transfer_out";

    if (isIncoming && !isOutgoing) {
      type = "transfer_in";
    } else if (isOutgoing && !isIncoming) {
      type = "transfer_out";
    } else if (isIncoming && isOutgoing) {
      // Internal transfer within our wallet - treat based on net change
      type =
        totalValueChange >= 0
          ? "internal_transfer_in"
          : "internal_transfer_out";
    } else {
      // Neither incoming nor outgoing (shouldn't happen with proper filtering)
      type = "transfer_out";
    }

    const totalValue = Math.abs(totalValueChange);
    const fee = isOutgoing ? tx.fee : 0;

    // Determine from/to addresses (first relevant address found)
    let fromAddress = "";
    let toAddress = "";

    // For from address, look for wallet addresses in inputs
    for (const input of tx.vin) {
      if (
        input.prevout?.scriptpubkey_address &&
        relevantAddresses.has(input.prevout.scriptpubkey_address)
      ) {
        fromAddress = input.prevout.scriptpubkey_address;
        break;
      }
    }

    // For to address, look for wallet addresses in outputs
    for (const output of tx.vout) {
      if (
        output.scriptpubkey_address &&
        relevantAddresses.has(output.scriptpubkey_address)
      ) {
        toAddress = output.scriptpubkey_address;
        break;
      }
    }

    // Fallback to first addresses if no wallet addresses found
    if (
      !fromAddress &&
      tx.vin.length > 0 &&
      tx.vin[0]?.prevout?.scriptpubkey_address
    ) {
      fromAddress = tx.vin[0].prevout.scriptpubkey_address;
    }

    if (!toAddress && tx.vout.length > 0 && tx.vout[0]?.scriptpubkey_address) {
      toAddress = tx.vout[0].scriptpubkey_address;
    }

    return {
      hash: tx.txid,
      blockNumber: tx.status.block_height || 0,
      blockHash: tx.status.block_hash || "",
      timestamp,
      from: fromAddress,
      to: toAddress,
      value: createMoney(totalValue / 100000000, "BTC"),
      fee: createMoney(fee / 100000000, "BTC"),
      gasUsed: undefined,
      gasPrice: undefined,
      status: tx.status.confirmed ? "success" : "pending",
      type,
      tokenContract: undefined,
      tokenSymbol: "BTC",
      nonce: undefined,
      confirmations: tx.status.confirmed ? 1 : 0,
    };
  }

  async testConnection(): Promise<boolean> {
    try {
      // Test connection through provider manager
      const healthStatus = this.providerManager.getProviderHealth("bitcoin");
      const hasHealthyProvider = Array.from(healthStatus.values()).some(
        (health) => health.isHealthy && health.circuitState !== "OPEN",
      );

      this.logger.info(
        `Bitcoin provider connection test result - HasHealthyProvider: ${hasHealthyProvider}, TotalProviders: ${healthStatus.size}`,
      );

      return hasHealthyProvider;
    } catch (error) {
      this.logger.error(`Bitcoin connection test failed - Error: ${error}`);
      return false;
    }
  }

  /**
   * Close adapter and cleanup resources
   */
  async close(): Promise<void> {
    try {
      this.providerManager.destroy();
      this.logger.info("Bitcoin adapter closed successfully");
    } catch (error) {
      this.logger.warn(`Error during Bitcoin adapter close - Error: ${error}`);
    }
  }
}
