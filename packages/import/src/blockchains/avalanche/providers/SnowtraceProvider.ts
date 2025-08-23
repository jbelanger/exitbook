import type { Balance, BlockchainTransaction } from "@crypto/core";
import { AuthenticationError, ServiceError } from "@crypto/core";
import { createMoney, maskAddress, parseDecimal } from "@crypto/shared-utils";
import { Decimal } from "decimal.js";
import { BaseRegistryProvider } from "../../shared/registry/base-registry-provider.ts";
import { RegisterProvider } from "../../shared/registry/decorators.ts";
import type { ProviderOperation } from "../../shared/types.ts";
import type {
  SnowtraceApiResponse,
  SnowtraceBalanceResponse,
  SnowtraceInternalTransaction,
  SnowtraceTokenTransfer,
  SnowtraceTransaction,
} from "../types.ts";
import { isValidAvalancheAddress } from "../types.ts";

@RegisterProvider({
  name: "snowtrace",
  blockchain: "avalanche",
  displayName: "Snowtrace API",
  type: "rest",
  requiresApiKey: false,
  apiKeyEnvVar: "SNOWTRACE_API_KEY",
  description:
    "Avalanche blockchain explorer API with comprehensive transaction and balance data",
  capabilities: {
    supportedOperations: [
      "getAddressTransactions",
      "getAddressBalance",
      "getTokenTransactions",
      "getTokenBalances",
    ],
    maxBatchSize: 1,
    supportsHistoricalData: true,
    supportsPagination: true,
    supportsRealTimeData: true,
    supportsTokenData: true,
  },
  networks: {
    mainnet: {
      baseUrl: "https://api.snowtrace.io/api",
    },
    testnet: {
      baseUrl: "https://api-testnet.snowtrace.io/api",
    },
  },
  defaultConfig: {
    timeout: 10000,
    retries: 3,
    rateLimit: {
      requestsPerSecond: 1,
      requestsPerMinute: 30,
      requestsPerHour: 100,
      burstLimit: 3,
    },
  },
})
export class SnowtraceProvider extends BaseRegistryProvider {
  constructor() {
    super("avalanche", "snowtrace", "mainnet");

    this.logger.debug(
      `Initialized SnowtraceProvider from registry metadata - Network: ${this.network}, BaseUrl: ${this.baseUrl}, HasApiKey: ${this.apiKey !== "YourApiKeyToken"}`,
    );
  }

  async isHealthy(): Promise<boolean> {
    try {
      // Test with a simple API call
      const params = new URLSearchParams({
        module: "stats",
        action: "ethsupply",
      });

      if (this.apiKey && this.apiKey !== "YourApiKeyToken") {
        params.append("apikey", this.apiKey);
      }

      const response = await this.httpClient.get(`?${params.toString()}`);
      return !!(
        response && (response as SnowtraceApiResponse<unknown>).status === "1"
      );
    } catch (error) {
      this.logger.warn(
        `Health check failed - Error: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      const result = await this.isHealthy();
      if (!result) {
        this.logger.warn(`Connection test failed - Provider unhealthy`);
      }
      return result;
    } catch (error) {
      this.logger.error(
        `Connection test failed - Error: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  async execute<T>(operation: ProviderOperation<T>): Promise<T> {
    this.logger.debug(
      `Executing operation - Type: ${operation.type}, Address: ${"address" in operation.params && typeof operation.params.address === "string" ? maskAddress(operation.params.address) : "N/A"}`,
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
        case "getTokenTransactions":
          return this.getTokenTransactions(
            operation.params as {
              address: string;
              contractAddress?: string;
              since?: number;
            },
          ) as T;
        case "getTokenBalances":
          return this.getTokenBalances(
            operation.params as {
              address: string;
              contractAddresses?: string[];
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

    if (!isValidAvalancheAddress(address)) {
      throw new Error(`Invalid Avalanche address: ${address}`);
    }

    this.logger.debug(
      `Fetching address transactions - Address: ${maskAddress(address)}, Network: ${this.network}`,
    );

    try {
      // Get normal transactions
      const normalTransactions = await this.getNormalTransactions(
        address,
        since,
      );

      // Get internal transactions
      const internalTransactions = await this.getInternalTransactions(
        address,
        since,
      );

      // Note: Token transfers are handled separately via getTokenTransactions
      const allTransactions = [...normalTransactions, ...internalTransactions];

      // Sort by timestamp (newest first)
      allTransactions.sort((a, b) => b.timestamp - a.timestamp);

      this.logger.debug(
        `Retrieved ${allTransactions.length} transactions for ${maskAddress(address)}`,
      );

      return allTransactions;
    } catch (error) {
      this.logger.error(
        `Failed to get address transactions - Address: ${maskAddress(address)}, Network: ${this.network}, Error: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  private async getAddressBalance(params: {
    address: string;
  }): Promise<Balance> {
    const { address } = params;

    if (!isValidAvalancheAddress(address)) {
      throw new Error(`Invalid Avalanche address: ${address}`);
    }

    this.logger.debug(
      `Fetching address balance - Address: ${maskAddress(address)}, Network: ${this.network}`,
    );

    try {
      // Get AVAX balance
      const avaxBalance = await this.getAVAXBalance(address);

      this.logger.debug(
        `Retrieved balance for ${maskAddress(address)}: ${avaxBalance.balance} AVAX`,
      );

      return avaxBalance;
    } catch (error) {
      this.logger.error(
        `Failed to get address balance - Address: ${maskAddress(address)}, Network: ${this.network}, Error: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  private async getTokenTransactions(params: {
    address: string;
    contractAddress?: string;
    since?: number;
  }): Promise<BlockchainTransaction[]> {
    const { address, contractAddress, since } = params;
    return this.getTokenTransfers(address, since, contractAddress);
  }

  private async getTokenBalances(params: {
    address: string;
    contractAddresses?: string[];
  }): Promise<Balance[]> {
    const { address, contractAddresses } = params;
    return this.getTokenBalancesForAddress(address, contractAddresses);
  }

  private async getNormalTransactions(
    address: string,
    since?: number,
  ): Promise<BlockchainTransaction[]> {
    const params = new URLSearchParams({
      module: "account",
      action: "txlist",
      address: address,
      startblock: "0",
      endblock: "99999999",
      sort: "asc",
    });

    if (since) {
      // Convert timestamp to approximate block number (simplified)
      // In production, you'd want to use a more accurate method
      params.set("startblock", Math.floor(since / 1000).toString());
    }

    if (this.apiKey && this.apiKey !== "YourApiKeyToken") {
      params.append("apikey", this.apiKey);
    }

    const response = (await this.httpClient.get(
      `?${params.toString()}`,
    )) as SnowtraceApiResponse<SnowtraceTransaction>;

    if (response.status !== "1") {
      if (
        response.message === "NOTOK" &&
        response.message.includes("Invalid API Key")
      ) {
        throw new AuthenticationError(
          "Invalid Snowtrace API key",
          this.name,
          "getNormalTransactions",
        );
      }
      throw new ServiceError(
        `Snowtrace API error: ${response.message}`,
        this.name,
        "getNormalTransactions",
      );
    }

    return response.result.map((tx) =>
      this.convertNormalTransaction(tx, address),
    );
  }

  private async getInternalTransactions(
    address: string,
    since?: number,
  ): Promise<BlockchainTransaction[]> {
    const params = new URLSearchParams({
      module: "account",
      action: "txlistinternal",
      address: address,
      startblock: "0",
      endblock: "99999999",
      sort: "asc",
    });

    if (since) {
      params.set("startblock", Math.floor(since / 1000).toString());
    }

    if (this.apiKey && this.apiKey !== "YourApiKeyToken") {
      params.append("apikey", this.apiKey);
    }

    try {
      const response = (await this.httpClient.get(
        `?${params.toString()}`,
      )) as SnowtraceApiResponse<SnowtraceInternalTransaction>;

      if (response.status !== "1") {
        // Internal transactions might not be available for all addresses
        this.logger.debug(
          `No internal transactions found - Message: ${response.message}`,
        );
        return [];
      }

      return response.result.map((tx) =>
        this.convertInternalTransaction(tx, address),
      );
    } catch (error) {
      this.logger.warn(`Failed to fetch internal transactions`);
      return [];
    }
  }

  private async getTokenTransfers(
    address: string,
    since?: number,
    contractAddress?: string,
  ): Promise<BlockchainTransaction[]> {
    const params = new URLSearchParams({
      module: "account",
      action: "tokentx",
      address: address,
      startblock: "0",
      endblock: "99999999",
      sort: "asc",
    });

    if (since) {
      params.set("startblock", Math.floor(since / 1000).toString());
    }

    if (contractAddress) {
      params.append("contractaddress", contractAddress);
    }

    if (this.apiKey && this.apiKey !== "YourApiKeyToken") {
      params.append("apikey", this.apiKey);
    }

    try {
      const response = (await this.httpClient.get(
        `?${params.toString()}`,
      )) as SnowtraceApiResponse<SnowtraceTokenTransfer>;

      if (response.status !== "1") {
        this.logger.debug(
          `No token transfers found - Message: ${response.message}`,
        );
        return [];
      }

      return response.result.map((tx) =>
        this.convertTokenTransfer(tx, address),
      );
    } catch (error) {
      this.logger.warn(`Failed to fetch token transfers`);
      return [];
    }
  }

  private async getAVAXBalance(address: string): Promise<Balance> {
    const params = new URLSearchParams({
      module: "account",
      action: "balance",
      address: address,
      tag: "latest",
    });

    if (this.apiKey && this.apiKey !== "YourApiKeyToken") {
      params.append("apikey", this.apiKey);
    }

    const response = (await this.httpClient.get(
      `?${params.toString()}`,
    )) as SnowtraceBalanceResponse;

    if (response.status !== "1") {
      throw new ServiceError(
        `Failed to fetch AVAX balance: ${response.message}`,
        this.name,
        "getAVAXBalance",
      );
    }

    // Convert from wei to AVAX
    const balanceWei = new Decimal(response.result);
    const balanceAvax = balanceWei.dividedBy(new Decimal(10).pow(18));

    return {
      currency: "AVAX",
      balance: balanceAvax.toNumber(),
      used: 0,
      total: balanceAvax.toNumber(),
    };
  }

  private async getTokenBalancesForAddress(
    _address: string,
    _contractAddresses?: string[],
  ): Promise<Balance[]> {
    // Snowtrace doesn't have a direct "get all token balances" endpoint like some other explorers
    // For now, return empty array - in production you might want to track known token contracts
    this.logger.debug(
      "Token balance fetching not implemented for Snowtrace - use specific contract addresses",
    );
    return [];
  }

  private convertNormalTransaction(
    tx: SnowtraceTransaction,
    userAddress: string,
  ): BlockchainTransaction {
    const isFromUser = tx.from.toLowerCase() === userAddress.toLowerCase();
    const isToUser = tx.to.toLowerCase() === userAddress.toLowerCase();

    // Determine transaction type
    let type: "transfer_in" | "transfer_out";
    if (isFromUser && isToUser) {
      type = "transfer_in"; // Self-transfer, treat as incoming
    } else if (isFromUser) {
      type = "transfer_out";
    } else {
      type = "transfer_in";
    }

    // Convert value from wei to AVAX
    const valueWei = new Decimal(tx.value);
    const valueAvax = valueWei.dividedBy(new Decimal(10).pow(18));

    // Calculate fee
    const gasUsed = new Decimal(tx.gasUsed);
    const gasPrice = new Decimal(tx.gasPrice);
    const feeWei = gasUsed.mul(gasPrice);
    const feeAvax = feeWei.dividedBy(new Decimal(10).pow(18));

    return {
      hash: tx.hash,
      blockNumber: parseInt(tx.blockNumber),
      blockHash: tx.blockHash,
      timestamp: parseInt(tx.timeStamp) * 1000,
      from: tx.from,
      to: tx.to,
      value: createMoney(valueAvax.toNumber(), "AVAX"),
      fee: createMoney(feeAvax.toNumber(), "AVAX"),
      gasUsed: parseInt(tx.gasUsed),
      gasPrice: parseDecimal(tx.gasPrice).toNumber(),
      status: tx.txreceipt_status === "1" ? "success" : "failed",
      type,
      confirmations: parseInt(tx.confirmations),
    };
  }

  private convertInternalTransaction(
    tx: SnowtraceInternalTransaction,
    userAddress: string,
  ): BlockchainTransaction {
    const isFromUser = tx.from.toLowerCase() === userAddress.toLowerCase();
    const isToUser = tx.to.toLowerCase() === userAddress.toLowerCase();

    let type: "internal_transfer_in" | "internal_transfer_out";
    if (isFromUser && isToUser) {
      type = "internal_transfer_in";
    } else if (isFromUser) {
      type = "internal_transfer_out";
    } else {
      type = "internal_transfer_in";
    }

    const valueWei = new Decimal(tx.value);
    const valueAvax = valueWei.dividedBy(new Decimal(10).pow(18));

    return {
      hash: tx.hash,
      blockNumber: parseInt(tx.blockNumber),
      blockHash: "",
      timestamp: parseInt(tx.timeStamp) * 1000,
      from: tx.from,
      to: tx.to,
      value: createMoney(valueAvax.toNumber(), "AVAX"),
      fee: createMoney(0, "AVAX"),
      gasUsed: parseInt(tx.gasUsed),
      gasPrice: 0,
      status: tx.isError === "0" ? "success" : "failed",
      type,
    };
  }

  private convertTokenTransfer(
    tx: SnowtraceTokenTransfer,
    userAddress: string,
  ): BlockchainTransaction {
    const isFromUser = tx.from.toLowerCase() === userAddress.toLowerCase();
    const isToUser = tx.to.toLowerCase() === userAddress.toLowerCase();

    let type: "token_transfer_in" | "token_transfer_out";
    if (isFromUser && isToUser) {
      type = "token_transfer_in";
    } else if (isFromUser) {
      type = "token_transfer_out";
    } else {
      type = "token_transfer_in";
    }

    // Convert value using token decimals
    const decimals = parseInt(tx.tokenDecimal);
    const valueRaw = new Decimal(tx.value);
    const value = valueRaw.dividedBy(new Decimal(10).pow(decimals));

    return {
      hash: tx.hash,
      blockNumber: parseInt(tx.blockNumber),
      blockHash: tx.blockHash,
      timestamp: parseInt(tx.timeStamp) * 1000,
      from: tx.from,
      to: tx.to,
      value: createMoney(value.toNumber(), tx.tokenSymbol),
      fee: createMoney(0, "AVAX"),
      gasUsed: parseInt(tx.gasUsed),
      gasPrice: parseDecimal(tx.gasPrice).toNumber(),
      status: "success",
      type,
      tokenContract: tx.contractAddress,
      tokenSymbol: tx.tokenSymbol,
      confirmations: parseInt(tx.confirmations),
    };
  }
}
