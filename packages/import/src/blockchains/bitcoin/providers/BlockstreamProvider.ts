import { Decimal } from "decimal.js";

import type { BlockchainTransaction } from "@crypto/core";
import { createMoney, maskAddress } from "@crypto/shared-utils";
import { BaseRegistryProvider } from "../../shared/registry/base-registry-provider.ts";
import { RegisterProvider } from "../../shared/registry/decorators.ts";
import type { ProviderOperation } from "../../shared/types.ts";
import { 
  hasAddressParam,
  isAddressTransactionOperation,
  isAddressBalanceOperation,
  isAddressInfoOperation,
  isParseWalletTransactionOperation
} from "../../shared/types.ts";
import type { AddressInfo, BlockstreamAddressInfo, BlockstreamTransaction } from "../types.ts";


@RegisterProvider({
  name: "blockstream.info",
  blockchain: "bitcoin",
  displayName: "Blockstream.info API",
  type: "rest",
  requiresApiKey: false,
  description:
    "Bitcoin blockchain explorer API with comprehensive transaction data and pagination support (no API key required)",
  capabilities: {
    supportedOperations: [
      "getAddressTransactions",
      "getAddressBalance",
      "getRawAddressTransactions",
      "getAddressInfo",
      "parseWalletTransaction",
    ],
    maxBatchSize: 25,
    supportsHistoricalData: true,
    supportsPagination: true,
    supportsRealTimeData: true,
    supportsTokenData: false,
  },
  networks: {
    mainnet: {
      baseUrl: "https://blockstream.info/api",
    },
    testnet: {
      baseUrl: "https://blockstream.info/testnet/api",
    },
  },
  defaultConfig: {
    timeout: 10000,
    retries: 3,
    rateLimit: {
      requestsPerSecond: 1.0, // More generous than mempool.space
      requestsPerMinute: 60,
      requestsPerHour: 3600,
      burstLimit: 5,
    },
  },
})
export class BlockstreamProvider extends BaseRegistryProvider {
  constructor() {
    super("bitcoin", "blockstream.info", "mainnet");

    this.logger.debug(
      `Initialized BlockstreamProvider from registry metadata - Network: ${this.network}, BaseUrl: ${this.baseUrl}`,
    );
  }

  async isHealthy(): Promise<boolean> {
    try {
      const response = await this.httpClient.get<number>("/blocks/tip/height");
      return typeof response === "number" && response > 0;
    } catch (error) {
      this.logger.warn(
        `Health check failed - Error: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      // Test with a simple endpoint that should always work
      const blockHeight =
        await this.httpClient.get<number>("/blocks/tip/height");
      this.logger.debug(
        `Connection test successful - CurrentBlockHeight: ${blockHeight}`,
      );
      return typeof blockHeight === "number" && blockHeight > 0;
    } catch (error) {
      this.logger.error(
        `Connection test failed - Error: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  async execute<T>(operation: ProviderOperation<T>): Promise<T> {
    this.logger.debug(
      `Executing operation - Type: ${operation.type}, Address: ${hasAddressParam(operation) ? maskAddress(operation.params.address) : "N/A"}`,
    );

    try {
      switch (operation.type) {
        case "getAddressTransactions":
        case "getRawAddressTransactions":
          if (isAddressTransactionOperation(operation)) {
            return operation.type === "getAddressTransactions" 
              ? this.getAddressTransactions(operation.params) as T
              : this.getRawAddressTransactions(operation.params) as T;
          }
          throw new Error(`Invalid params for ${operation.type} operation`);
        case "getAddressBalance":
          if (isAddressBalanceOperation(operation)) {
            return this.getAddressBalance(operation.params) as T;
          }
          throw new Error(`Invalid params for getAddressBalance operation`);
        case "getAddressInfo":
          if (isAddressInfoOperation(operation)) {
            return this.getAddressInfo(operation.params) as T;
          }
          throw new Error(`Invalid params for getAddressInfo operation`);
        case "parseWalletTransaction":
          if (isParseWalletTransactionOperation(operation)) {
            return this.parseWalletTransaction({
              tx: operation.params.tx as BlockstreamTransaction,
              walletAddresses: operation.params.walletAddresses
            }) as T;
          }
          throw new Error(`Invalid params for parseWalletTransaction operation`);
        default:
          throw new Error(`Unsupported operation: ${operation.type}`);
      }
    } catch (error) {
      this.logger.error(
        `Operation execution failed - Type: ${operation.type}, Params: ${JSON.stringify(operation.params)}, Error: ${error instanceof Error ? error.message : String(error)}, Stack: ${error instanceof Error ? error.stack : undefined}`,
      );
      throw error;
    }
  }

  private async getAddressTransactions(params: {
    address: string;
    since?: number;
  }): Promise<BlockchainTransaction[]> {
    const { address, since } = params;

    this.logger.debug(
      `Fetching address transactions - Address: ${maskAddress(address)}, Since: ${since}`,
    );

    try {
      // Get address info first to check if there are transactions
      const addressInfo = await this.httpClient.get<BlockstreamAddressInfo>(
        `/address/${address}`,
      );

      if (
        addressInfo.chain_stats.tx_count === 0 &&
        addressInfo.mempool_stats.tx_count === 0
      ) {
        this.logger.debug(
          `No transactions found for address - Address: ${maskAddress(address)}`,
        );
        return [];
      }

      // Get transaction list with pagination
      const allTransactions: BlockchainTransaction[] = [];
      let lastSeenTxid: string | undefined;
      let hasMore = true;
      let batchCount = 0;
      const maxBatches = 50; // Safety limit

      while (hasMore && batchCount < maxBatches) {
        const endpoint = lastSeenTxid
          ? `/address/${address}/txs/chain/${lastSeenTxid}`
          : `/address/${address}/txs`;

        const transactions =
          await this.httpClient.get<BlockstreamTransaction[]>(endpoint);

        if (!Array.isArray(transactions) || transactions.length === 0) {
          hasMore = false;
          break;
        }

        this.logger.debug(
          `Retrieved transaction batch - Address: ${maskAddress(address)}, BatchSize: ${transactions.length}, Batch: ${batchCount + 1}`,
        );

        // Transform the transactions we already have
        const batchTransactions = transactions.map((tx) => {
          try {
            return this.transformTransaction(tx, address);
          } catch (error) {
            this.logger.warn(
              `Failed to transform transaction - Txid: ${tx.txid}, Error: ${error instanceof Error ? error.message : String(error)}`,
            );
            return null;
          }
        });

        const validTransactions = batchTransactions.filter(
          (tx): tx is BlockchainTransaction => tx !== null,
        );
        allTransactions.push(...validTransactions);

        // Update pagination
        lastSeenTxid =
          transactions.length > 0
            ? transactions[transactions.length - 1]?.txid
            : undefined;
        hasMore = transactions.length === 25; // Blockstream typically returns 25 per page
        batchCount++;

        // Rate limiting is handled by HttpClient automatically
      }

      // Filter by timestamp if 'since' is provided
      let filteredTransactions = allTransactions;
      if (since) {
        filteredTransactions = allTransactions.filter(
          (tx) => tx.timestamp >= since,
        );
        this.logger.debug(
          `Filtered transactions by timestamp - OriginalCount: ${allTransactions.length}, FilteredCount: ${filteredTransactions.length}, Since: ${since}`,
        );
      }

      // Sort by timestamp (newest first)
      filteredTransactions.sort((a, b) => b.timestamp - a.timestamp);

      this.logger.debug(
        `Successfully retrieved address transactions - Address: ${maskAddress(address)}, TotalTransactions: ${filteredTransactions.length}, BatchesProcessed: ${batchCount}`,
      );

      return filteredTransactions;
    } catch (error) {
      this.logger.error(
        `Failed to get address transactions - Address: ${maskAddress(address)}, Error: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  private async getAddressBalance(params: {
    address: string;
  }): Promise<{ balance: string; token: string }> {
    const { address } = params;

    this.logger.debug(
      `Fetching address balance - Address: ${maskAddress(address)}`,
    );

    try {
      const addressInfo = await this.httpClient.get<BlockstreamAddressInfo>(
        `/address/${address}`,
      );

      // Calculate current balance: funded amount - spent amount
      const chainBalance =
        addressInfo.chain_stats.funded_txo_sum -
        addressInfo.chain_stats.spent_txo_sum;
      const mempoolBalance =
        addressInfo.mempool_stats.funded_txo_sum -
        addressInfo.mempool_stats.spent_txo_sum;
      const totalBalanceSats = chainBalance + mempoolBalance;

      // Convert satoshis to BTC
      const balanceBTC = (totalBalanceSats / 100000000).toString();

      this.logger.debug(
        `Successfully retrieved address balance - Address: ${maskAddress(address)}, BalanceBTC: ${balanceBTC}, BalanceSats: ${totalBalanceSats}`,
      );

      return {
        balance: balanceBTC,
        token: "BTC",
      };
    } catch (error) {
      this.logger.error(
        `Failed to get address balance - Address: ${maskAddress(address)}, Error: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  /**
   * Get lightweight address info for efficient gap scanning
   */
  private async getAddressInfo(params: {
    address: string;
  }): Promise<AddressInfo> {
    const { address } = params;

    this.logger.debug(
      `Fetching lightweight address info - Address: ${maskAddress(address)}`,
    );

    try {
      const addressInfo = await this.httpClient.get<BlockstreamAddressInfo>(
        `/address/${address}`,
      );

      // Calculate transaction count
      const txCount =
        addressInfo.chain_stats.tx_count + addressInfo.mempool_stats.tx_count;

      // Calculate current balance: funded amount - spent amount
      const chainBalance =
        addressInfo.chain_stats.funded_txo_sum -
        addressInfo.chain_stats.spent_txo_sum;
      const mempoolBalance =
        addressInfo.mempool_stats.funded_txo_sum -
        addressInfo.mempool_stats.spent_txo_sum;
      const totalBalanceSats = chainBalance + mempoolBalance;

      // Convert satoshis to BTC
      const balanceBTC = (totalBalanceSats / 100000000).toString();

      this.logger.debug(
        `Successfully retrieved lightweight address info - Address: ${maskAddress(address)}, TxCount: ${txCount}, BalanceBTC: ${balanceBTC}`,
      );

      return {
        txCount,
        balance: balanceBTC,
      };
    } catch (error) {
      this.logger.error(
        `Failed to get address info - Address: ${maskAddress(address)}, Error: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  /**
   * Get raw transaction data without transformation for wallet-aware parsing
   */
  private async getRawAddressTransactions(params: {
    address: string;
    since?: number;
  }): Promise<BlockstreamTransaction[]> {
    const { address, since } = params;

    this.logger.debug(
      `Fetching raw address transactions - Address: ${maskAddress(address)}, Since: ${since}`,
    );

    try {
      // Get address info first to check if there are transactions
      const addressInfo = await this.httpClient.get<BlockstreamAddressInfo>(
        `/address/${address}`,
      );

      if (
        addressInfo.chain_stats.tx_count === 0 &&
        addressInfo.mempool_stats.tx_count === 0
      ) {
        this.logger.debug(
          `No raw transactions found for address - Address: ${maskAddress(address)}`,
        );
        return [];
      }

      // Get transaction list with pagination - return raw transactions directly
      const allRawTransactions: BlockstreamTransaction[] = [];
      let lastSeenTxid: string | undefined;
      let hasMore = true;
      let batchCount = 0;
      const maxBatches = 50; // Safety limit

      while (hasMore && batchCount < maxBatches) {
        const endpoint = lastSeenTxid
          ? `/address/${address}/txs/chain/${lastSeenTxid}`
          : `/address/${address}/txs`;

        const rawTransactions =
          await this.httpClient.get<BlockstreamTransaction[]>(endpoint);

        if (!Array.isArray(rawTransactions) || rawTransactions.length === 0) {
          hasMore = false;
          break;
        }

        this.logger.debug(
          `Retrieved raw transaction batch - Address: ${maskAddress(address)}, BatchSize: ${rawTransactions.length}, Batch: ${batchCount + 1}`,
        );

        // We already have the raw transaction data - no need to fetch again
        const validRawTransactions = rawTransactions.filter(
          (tx): tx is BlockstreamTransaction => tx !== null,
        );
        allRawTransactions.push(...validRawTransactions);

        // Update pagination
        lastSeenTxid =
          rawTransactions.length > 0
            ? rawTransactions[rawTransactions.length - 1]?.txid
            : undefined;
        hasMore = rawTransactions.length === 25; // Blockstream typically returns 25 per page
        batchCount++;
      }

      // Filter by timestamp if 'since' is provided
      let filteredRawTransactions = allRawTransactions;
      if (since) {
        filteredRawTransactions = allRawTransactions.filter(
          (tx) =>
            (tx.status.block_time || Math.floor(Date.now() / 1000)) >= since,
        );
        this.logger.debug(
          `Filtered raw transactions by timestamp - OriginalCount: ${allRawTransactions.length}, FilteredCount: ${filteredRawTransactions.length}, Since: ${since}`,
        );
      }

      // Sort by timestamp (newest first)
      filteredRawTransactions.sort((a, b) => {
        const aTime = a.status.block_time || 0;
        const bTime = b.status.block_time || 0;
        return bTime - aTime;
      });

      this.logger.debug(
        `Successfully retrieved raw address transactions - Address: ${maskAddress(address)}, TotalRawTransactions: ${filteredRawTransactions.length}, BatchesProcessed: ${batchCount}`,
      );

      return filteredRawTransactions;
    } catch (error) {
      this.logger.error(
        `Failed to get raw address transactions - Address: ${maskAddress(address)}, Error: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  private transformTransaction(
    tx: BlockstreamTransaction,
    userAddress?: string,
  ): BlockchainTransaction {
    // Calculate transaction value and determine type
    let valueAmount = new Decimal(0);
    let type: BlockchainTransaction["type"] = "transfer_in";

    if (userAddress) {
      let inputValue = 0;
      let outputValue = 0;

      // Check inputs for user address
      for (const input of tx.vin) {
        if (input.prevout.scriptpubkey_address === userAddress) {
          inputValue += input.prevout.value;
        }
      }

      // Check outputs for user address
      for (const output of tx.vout) {
        if (output.scriptpubkey_address === userAddress) {
          outputValue += output.value;
        }
      }

      // Determine transaction type and value
      if (inputValue > 0 && outputValue === 0) {
        // Pure withdrawal: user sent money
        type = "transfer_out";
        valueAmount = new Decimal(inputValue).div(100000000);
      } else if (inputValue === 0 && outputValue > 0) {
        // Pure deposit: user received money
        type = "transfer_in";
        valueAmount = new Decimal(outputValue).div(100000000);
      } else if (inputValue > 0 && outputValue > 0) {
        // Mixed transaction: calculate net effect
        const netValue = outputValue - inputValue;
        if (netValue > 0) {
          type = "transfer_in";
          valueAmount = new Decimal(netValue).div(100000000);
        } else {
          type = "transfer_out";
          valueAmount = new Decimal(Math.abs(netValue)).div(100000000);
        }
      }
    } else {
      // Without user address context, just sum all outputs
      const totalValue = tx.vout.reduce((sum, output) => sum + output.value, 0);
      valueAmount = new Decimal(totalValue).div(100000000);
    }

    // Extract addresses
    const fromAddresses = tx.vin
      .map((input) => input.prevout.scriptpubkey_address)
      .filter((addr): addr is string => addr !== undefined);
    const toAddresses = tx.vout
      .map((output) => output.scriptpubkey_address)
      .filter((addr): addr is string => addr !== undefined);

    return {
      hash: tx.txid,
      blockNumber: tx.status.block_height || 0,
      blockHash: tx.status.block_hash || "",
      timestamp: tx.status.block_time || Math.floor(Date.now() / 1000),
      from: fromAddresses[0] || "",
      to: toAddresses[0] || "",
      value: { amount: valueAmount, currency: "BTC" },
      fee: { amount: new Decimal(tx.fee).div(100000000), currency: "BTC" },
      status: tx.status.confirmed ? "success" : "pending",
      type,
    };
  }

  /**
   * Parse a Blockstream transaction considering multiple wallet addresses (for xpub scenarios)
   */
  private parseWalletTransaction(params: {
    tx: BlockstreamTransaction;
    walletAddresses: string[];
  }): BlockchainTransaction {
    const { tx, walletAddresses } = params;

    try {
      const timestamp =
        tx.status.confirmed && tx.status.block_time
          ? tx.status.block_time * 1000
          : Date.now();

      // Calculate transaction value considering all wallet addresses
      let totalValueChange = 0;
      let isIncoming = false;
      let isOutgoing = false;
      const relevantAddresses = new Set(walletAddresses);

      // Check inputs - money going out of our wallet (Blockstream format)
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

      // Check outputs - money coming into our wallet (Blockstream format)
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

      if (
        !toAddress &&
        tx.vout.length > 0 &&
        tx.vout[0]?.scriptpubkey_address
      ) {
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
    } catch (error) {
      this.logger.error(
        `Failed to parse Blockstream wallet transaction ${tx.txid} - Error: ${error instanceof Error ? error.message : String(error)}, Stack: ${error instanceof Error ? error.stack : undefined}, TxData: ${JSON.stringify(tx, null, 2)}`,
      );
      throw error;
    }
  }
}
