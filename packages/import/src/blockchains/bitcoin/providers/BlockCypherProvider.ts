import { Decimal } from "decimal.js";

import type { BlockchainTransaction } from "@crypto/core";
import { createMoney, maskAddress } from "@crypto/shared-utils";

import { BaseRegistryProvider } from "../../shared/registry/base-registry-provider.ts";
import { RegisterProvider } from "../../shared/registry/decorators.ts";
import { ProviderOperation } from "../../shared/types.ts";
import type { AddressInfo } from "../types.ts";

interface BlockCypherTransaction {
  hash: string;
  block_height: number;
  block_hash: string;
  block_index: number;
  received: string; // ISO 8601 date
  confirmed: string; // ISO 8601 date
  confirmations: number;
  double_spend: boolean;
  inputs: Array<{
    prev_hash: string;
    output_index: number;
    output_value: number;
    sequence: number;
    addresses: string[];
    script_type: string;
    age: number;
  }>;
  outputs: Array<{
    value: number;
    script: string;
    addresses: string[];
    script_type: string;
  }>;
  fees: number;
  size: number;
  vsize: number;
  preference: string;
  relayed_by: string;
  confidence: number;
  ver: number;
  lock_time: number;
  gas_limit?: number;
  gas_used?: number;
  gas_price?: number;
}

interface BlockCypherAddress {
  address: string;
  total_received: number;
  total_sent: number;
  balance: number;
  unconfirmed_balance: number;
  final_balance: number;
  n_tx: number;
  unconfirmed_n_tx: number;
  final_n_tx: number;
  txrefs?: Array<{
    tx_hash: string;
    block_height: number;
    tx_input_n: number;
    tx_output_n: number;
    value: number;
    ref_balance: number;
    spent: boolean;
    confirmations: number;
    confirmed: string;
    double_spend: boolean;
  }>;
  hasMore?: boolean;
  error?: string;
}

@RegisterProvider({
  name: "blockcypher",
  blockchain: "bitcoin",
  displayName: "BlockCypher API",
  type: "rest",
  requiresApiKey: true,
  apiKeyEnvVar: "BLOCKCYPHER_API_KEY",
  description:
    "Bitcoin blockchain API with high-performance transaction data and balance queries (requires API key for full functionality)",
  capabilities: {
    supportedOperations: [
      "getAddressTransactions",
      "getAddressBalance",
      "getAddressInfo",
      "parseWalletTransaction",
    ],
    maxBatchSize: 50,
    supportsHistoricalData: true,
    supportsPagination: true,
    supportsRealTimeData: true,
    supportsTokenData: false,
  },
  networks: {
    mainnet: {
      baseUrl: "https://api.blockcypher.com/v1/btc/main",
    },
    testnet: {
      baseUrl: "https://api.blockcypher.com/v1/btc/test3",
    },
  },
  defaultConfig: {
    timeout: 15000, // Longer timeout for BlockCypher
    retries: 3,
    rateLimit: {
      requestsPerSecond: 3.0, // API key dependent - 3 req/sec for free tier
      requestsPerMinute: 180,
      requestsPerHour: 10800,
      burstLimit: 5,
    },
  },
})
export class BlockCypherProvider extends BaseRegistryProvider {
  constructor() {
    super("bitcoin", "blockcypher", "mainnet");

    this.logger.debug(
      `Initialized BlockCypherProvider from registry metadata - Network: ${this.network}, BaseUrl: ${this.baseUrl}, HasApiKey: ${this.apiKey !== "YourApiKeyToken"}`,
    );
  }

  async isHealthy(): Promise<boolean> {
    try {
      const response = await this.httpClient.get("/");
      return response && typeof response === "object" && "name" in response;
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
      const chainInfo = await this.httpClient.get("/");
      this.logger.debug(
        `Connection test successful - ChainInfo: ${chainInfo.name}`,
      );
      return chainInfo && typeof chainInfo === "object" && "name" in chainInfo;
    } catch (error) {
      this.logger.error(
        `Connection test failed - Error: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  async execute<T>(operation: ProviderOperation<T>): Promise<T> {
    this.logger.debug(
      `Executing operation - Type: ${operation.type}, Address: ${operation.params?.address ? maskAddress(operation.params.address) : "N/A"}`,
    );

    try {
      switch (operation.type) {
        case "getAddressTransactions":
          return this.getAddressTransactions(
            operation.params as { address: string; since?: number },
          ) as T;
        case "getAddressBalance":
          return this.getAddressBalance(
            operation.params as { address: string },
          ) as T;
        case "getAddressInfo":
          return this.getAddressInfo(
            operation.params as { address: string },
          ) as T;
        case "parseWalletTransaction":
          return this.parseWalletTransaction(
            operation.params as {
              tx: BlockCypherTransaction;
              walletAddresses: string[];
            },
          ) as T;
        default:
          throw new Error(`Unsupported operation: ${operation.type}`);
      }
    } catch (error) {
      this.logger.error(
        `Operation execution failed - Type: ${operation.type}, Params: ${operation.params}, Error: ${error instanceof Error ? error.message : String(error)}, Stack: ${error instanceof Error ? error.stack : undefined}`,
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
      `Fetching address transactions - Address: ${maskAddress(address)}`,
    );

    try {
      // Get address info with transaction references
      const addressInfo = await this.httpClient.get<BlockCypherAddress>(
        this.buildEndpoint(`/addrs/${address}?limit=50`),
      );

      if (!addressInfo.txrefs || addressInfo.txrefs.length === 0) {
        this.logger.debug(
          `No transactions found for address - Address: ${maskAddress(address)}`,
        );
        return [];
      }

      this.logger.debug(
        `Retrieved transaction references - Address: ${maskAddress(address)}, Count: ${addressInfo.txrefs.length}`,
      );

      // Extract unique transaction hashes
      const uniqueTxHashes = Array.from(
        new Set(addressInfo.txrefs.map((ref) => ref.tx_hash)),
      );

      // Fetch detailed transaction data
      const transactions: BlockchainTransaction[] = [];

      // Process transactions in batches to respect rate limits
      const batchSize = this.capabilities.maxBatchSize!;
      for (let i = 0; i < uniqueTxHashes.length; i += batchSize) {
        const batch = uniqueTxHashes.slice(i, i + batchSize);

        const batchTransactions = await Promise.all(
          batch.map(async (txHash) => {
            try {
              const tx = await this.httpClient.get<BlockCypherTransaction>(
                this.buildEndpoint(`/txs/${txHash}`),
              );
              return this.transformTransaction(tx, address);
            } catch (error) {
              this.logger.warn(
                `Failed to fetch transaction details - Error: ${error instanceof Error ? error.message : String(error)}`,
              );
              return null;
            }
          }),
        );

        transactions.push(
          ...batchTransactions.filter(
            (tx): tx is BlockchainTransaction => tx !== null,
          ),
        );

        // Rate limiting between batches
        if (i + batchSize < uniqueTxHashes.length) {
          await new Promise((resolve) => setTimeout(resolve, 1000)); // 1 second delay between batches
        }
      }

      // Filter by timestamp if 'since' is provided
      let filteredTransactions = transactions;
      if (since) {
        filteredTransactions = transactions.filter(
          (tx) => tx.timestamp >= since,
        );
        this.logger.debug(
          `Filtered transactions by timestamp - OriginalCount: ${transactions.length}, FilteredCount: ${filteredTransactions.length}`,
        );
      }

      // Sort by timestamp (newest first)
      filteredTransactions.sort((a, b) => b.timestamp - a.timestamp);

      this.logger.debug(
        `Successfully retrieved address transactions - Address: ${maskAddress(address)}, TotalTransactions: ${filteredTransactions.length}`,
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
      const addressInfo = await this.httpClient.get<BlockCypherAddress>(
        this.buildEndpoint(`/addrs/${address}/balance`),
      );

      // BlockCypher returns balance in satoshis
      const balanceSats = addressInfo.final_balance;

      // Convert satoshis to BTC
      const balanceBTC = (balanceSats / 100000000).toString();

      this.logger.debug(
        `Successfully retrieved address balance - Address: ${maskAddress(address)}, UnconfirmedBalance: ${addressInfo.unconfirmed_balance}`,
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
      const addressInfo = await this.httpClient.get<BlockCypherAddress>(
        this.buildEndpoint(`/addrs/${address}/balance`),
      );

      // Get transaction count (final_n_tx includes confirmed transactions)
      const txCount = addressInfo.final_n_tx;

      // Get balance in BTC (BlockCypher returns in satoshis)
      const balanceBTC = (addressInfo.final_balance / 100000000).toString();

      this.logger.debug(
        `Successfully retrieved lightweight address info - Address: ${maskAddress(address)}`,
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

  private transformTransaction(
    tx: BlockCypherTransaction,
    userAddress?: string,
  ): BlockchainTransaction {
    // Calculate transaction value and determine type
    let valueAmount = new Decimal(0);
    let type: BlockchainTransaction["type"] = "transfer_in";

    if (userAddress) {
      let inputValue = 0;
      let outputValue = 0;

      // Check inputs for user address
      for (const input of tx.inputs) {
        if (input.addresses.includes(userAddress)) {
          inputValue += input.output_value;
        }
      }

      // Check outputs for user address
      for (const output of tx.outputs) {
        if (output.addresses.includes(userAddress)) {
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
      const totalValue = tx.outputs.reduce(
        (sum, output) => sum + output.value,
        0,
      );
      valueAmount = new Decimal(totalValue).div(100000000);
    }

    // Extract addresses
    const fromAddresses = tx.inputs
      .flatMap((input) => input.addresses)
      .filter((addr, index, array) => array.indexOf(addr) === index); // Remove duplicates
    const toAddresses = tx.outputs
      .flatMap((output) => output.addresses)
      .filter((addr, index, array) => array.indexOf(addr) === index); // Remove duplicates

    // Convert ISO date to timestamp
    const timestamp = tx.confirmed
      ? Math.floor(new Date(tx.confirmed).getTime() / 1000)
      : Math.floor(Date.now() / 1000);

    return {
      hash: tx.hash,
      blockNumber: tx.block_height || 0,
      blockHash: tx.block_hash || "",
      timestamp,
      from: fromAddresses[0] || "",
      to: toAddresses[0] || "",
      value: { amount: valueAmount, currency: "BTC" },
      fee: { amount: new Decimal(tx.fees).div(100000000), currency: "BTC" },
      status: tx.confirmations > 0 ? "success" : "pending",
      type,
      confirmations: tx.confirmations,
    };
  }

  private buildEndpoint(endpoint: string): string {
    if (this.apiKey) {
      const separator = endpoint.includes("?") ? "&" : "?";
      return `${endpoint}${separator}token=${this.apiKey}`;
    }
    return endpoint;
  }

  /**
   * Parse a BlockCypher transaction considering multiple wallet addresses (for xpub scenarios)
   */
  private parseWalletTransaction(params: {
    tx: BlockCypherTransaction;
    walletAddresses: string[];
  }): BlockchainTransaction {
    const { tx, walletAddresses } = params;

    try {
      const timestamp = tx.confirmed
        ? new Date(tx.confirmed).getTime()
        : Date.now();

      // Calculate transaction value considering all wallet addresses
      let totalValueChange = 0;
      let isIncoming = false;
      let isOutgoing = false;
      const relevantAddresses = new Set(walletAddresses);

      // Check inputs - money going out of our wallet (BlockCypher format uses arrays)
      for (const input of tx.inputs) {
        if (input.addresses) {
          for (const address of input.addresses) {
            if (relevantAddresses.has(address)) {
              isOutgoing = true;
              if (input.output_value) {
                totalValueChange -= input.output_value;
              }
              break; // Found a match in this input
            }
          }
        }
      }

      // Check outputs - money coming into our wallet (BlockCypher format uses arrays)
      for (const output of tx.outputs) {
        if (output.addresses) {
          for (const address of output.addresses) {
            if (relevantAddresses.has(address)) {
              isIncoming = true;
              totalValueChange += output.value;
              break; // Found a match in this output
            }
          }
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
      const fee = isOutgoing ? tx.fees : 0;

      // Determine from/to addresses (first relevant address found)
      let fromAddress = "";
      let toAddress = "";

      // For from address, look for wallet addresses in inputs
      for (const input of tx.inputs) {
        if (input.addresses) {
          for (const address of input.addresses) {
            if (relevantAddresses.has(address)) {
              fromAddress = address;
              break;
            }
          }
          if (fromAddress) break;
        }
      }

      // For to address, look for wallet addresses in outputs
      for (const output of tx.outputs) {
        if (output.addresses) {
          for (const address of output.addresses) {
            if (relevantAddresses.has(address)) {
              toAddress = address;
              break;
            }
          }
          if (toAddress) break;
        }
      }

      // Fallback to first addresses if no wallet addresses found
      if (
        !fromAddress &&
        tx.inputs.length > 0 &&
        tx.inputs[0]?.addresses?.length > 0
      ) {
        fromAddress = tx.inputs[0].addresses[0];
      }

      if (
        !toAddress &&
        tx.outputs.length > 0 &&
        tx.outputs[0]?.addresses?.length > 0
      ) {
        toAddress = tx.outputs[0].addresses[0];
      }

      return {
        hash: tx.hash,
        blockNumber: tx.block_height || 0,
        blockHash: tx.block_hash || "",
        timestamp,
        from: fromAddress,
        to: toAddress,
        value: createMoney(totalValue / 100000000, "BTC"),
        fee: createMoney(fee / 100000000, "BTC"),
        gasUsed: undefined,
        gasPrice: undefined,
        status: tx.confirmations > 0 ? "success" : "pending",
        type,
        tokenContract: undefined,
        tokenSymbol: "BTC",
        nonce: undefined,
        confirmations: tx.confirmations || 0,
      };
    } catch (error) {
      this.logger.error(
        `Failed to parse BlockCypher wallet transaction ${tx.hash} - Error: ${error instanceof Error ? error.message : String(error)}, Stack: ${error instanceof Error ? error.stack : undefined}, TxData: ${JSON.stringify(tx)}`,
      );
      throw error;
    }
  }
}
