import type {
  Balance,
  BlockchainTransaction,
  RateLimitConfig,
} from "@crypto/core";
import { ServiceError } from "@crypto/core";
import { getLogger } from "@crypto/shared-logger";
import { HttpClient, createMoney } from "@crypto/shared-utils";
import { Decimal } from "decimal.js";
import {
  IBlockchainProvider,
  ProviderCapabilities,
  ProviderOperation,
} from "../../shared/types.ts";
import type {
  MoralisDateToBlockResponse,
  MoralisNativeBalance,
  MoralisTokenBalance,
  MoralisTokenTransfer,
  MoralisTokenTransferResponse,
  MoralisTransaction,
  MoralisTransactionResponse,
} from "../types.ts";

const logger = getLogger("MoralisProvider");

export interface MoralisConfig {
  apiKey?: string;
  network?: string;
  baseUrl?: string;
  timeout?: number;
  retries?: number;
}

export class MoralisProvider implements IBlockchainProvider<MoralisConfig> {
  readonly name = "moralis";
  readonly blockchain = "ethereum";
  readonly capabilities: ProviderCapabilities = {
    supportedOperations: [
      "getAddressTransactions",
      "getAddressBalance",
      "getTokenTransactions",
      "getTokenBalances",
    ],
    maxBatchSize: 1, // Moralis doesn't support batch operations in free tier
    supportsHistoricalData: true,
    supportsPagination: true,
    supportsRealTimeData: true,
    supportsTokenData: true,
  };
  readonly rateLimit: RateLimitConfig = {
    requestsPerSecond: 2, // Conservative for free tier
    requestsPerMinute: 120,
    requestsPerHour: 1000,
    burstLimit: 5,
  };

  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly network: string;
  private readonly httpClient: HttpClient;

  constructor(config: MoralisConfig = {}) {
    this.apiKey = config.apiKey || process.env.MORALIS_API_KEY || "";
    this.network = config.network || "eth"; // eth, polygon, bsc, etc.
    this.baseUrl = config.baseUrl || "https://deep-index.moralis.io/api/v2";
    this.httpClient = new HttpClient({
      baseUrl: this.baseUrl,
      timeout: config.timeout || 10000,
      retries: config.retries || 3,
      rateLimit: this.rateLimit,
      providerName: this.name,
      defaultHeaders: {
        Accept: "application/json",
        "X-API-Key": this.apiKey,
      },
    });

    if (!this.apiKey) {
      throw new Error(
        "Moralis API key is required - set MORALIS_API_KEY environment variable",
      );
    }

    logger.debug(
      `Initialized MoralisProvider - Network: ${this.network}, BaseUrl: ${this.baseUrl}, Timeout: ${config.timeout || 10000}, Retries: ${config.retries || 3}`,
    );
  }

  async isHealthy(): Promise<boolean> {
    try {
      // Test with a simple API call to get server time or stats
      const response = await this.httpClient.get<MoralisDateToBlockResponse>(
        "/dateToBlock?chain=eth&date=2023-01-01T00:00:00.000Z",
      );
      return response && typeof response.block === "number";
    } catch (error) {
      logger.warn(
        `Health check failed - Error: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  async testConnection(): Promise<boolean> {
    return this.isHealthy();
  }

  async execute<T>(operation: ProviderOperation<T>): Promise<T> {
    switch (operation.type) {
      case "getAddressTransactions":
        return this.getAddressTransactions(
          operation.address,
          operation.since,
        ) as Promise<T>;
      case "getAddressBalance":
        return this.getAddressBalance(operation.address) as Promise<T>;
      case "getTokenTransactions":
        return this.getTokenTransactions(
          operation.address,
          operation.contractAddress,
          operation.since,
        ) as Promise<T>;
      case "getTokenBalances":
        return this.getTokenBalances(
          operation.address,
          operation.contractAddresses,
        ) as Promise<T>;
      default:
        throw new ServiceError(
          `Unsupported operation: ${operation.type}`,
          this.name,
          operation.type,
        );
    }
  }

  private async getAddressTransactions(
    address: string,
    since?: number,
  ): Promise<BlockchainTransaction[]> {
    try {
      // Get only native transactions
      // Token transfers are handled separately via getTokenTransactions
      const nativeTransactions = await this.getNativeTransactions(
        address,
        since,
      );

      // Sort by timestamp
      nativeTransactions.sort((a, b) => a.timestamp - b.timestamp);

      logger.debug(
        `Found ${nativeTransactions.length} native transactions for ${address}`,
      );
      return nativeTransactions;
    } catch (error) {
      logger.error(
        `Failed to fetch native transactions for ${address} - Error: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  private async getAddressBalance(address: string): Promise<Balance[]> {
    try {
      const balances: Balance[] = [];

      // Get native balance (ETH)
      const nativeBalance = await this.getNativeBalance(address);
      balances.push(nativeBalance);

      // Get token balances
      const tokenBalances = await this.getTokenBalancesForAddress(address);
      balances.push(...tokenBalances);

      return balances;
    } catch (error) {
      logger.error(
        `Failed to fetch balances for ${address} - Error: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  private async getTokenTransactions(
    address: string,
    contractAddress?: string,
    since?: number,
  ): Promise<BlockchainTransaction[]> {
    return this.getTokenTransfers(address, since, contractAddress);
  }

  private async getTokenBalances(
    address: string,
    contractAddresses?: string[],
  ): Promise<Balance[]> {
    return this.getTokenBalancesForAddress(address, contractAddresses);
  }

  private async getNativeTransactions(
    address: string,
    since?: number,
  ): Promise<BlockchainTransaction[]> {
    const params = new URLSearchParams({
      chain: this.network,
      limit: "100",
    });

    if (since) {
      // Convert timestamp to ISO string
      const sinceDate = new Date(since).toISOString();
      params.append("from_date", sinceDate);
    }

    const endpoint = `/${address}?${params.toString()}`;
    const response =
      await this.httpClient.get<MoralisTransactionResponse>(endpoint);

    return (response.result || []).map((tx: MoralisTransaction) =>
      this.convertNativeTransaction(tx, address),
    );
  }

  private async getTokenTransfers(
    address: string,
    since?: number,
    contractAddress?: string,
  ): Promise<BlockchainTransaction[]> {
    const params = new URLSearchParams({
      chain: this.network,
      limit: "100",
    });

    if (since) {
      const sinceDate = new Date(since).toISOString();
      params.append("from_date", sinceDate);
    }

    if (contractAddress) {
      params.append("contract_addresses[]", contractAddress);
    }

    const endpoint = `/${address}/erc20?${params.toString()}`;
    const response =
      await this.httpClient.get<MoralisTokenTransferResponse>(endpoint);

    return (response.result || []).map((tx: MoralisTokenTransfer) =>
      this.convertTokenTransfer(tx, address),
    );
  }

  private async getNativeBalance(address: string): Promise<Balance> {
    const params = new URLSearchParams({
      chain: this.network,
    });

    const endpoint = `/${address}/balance?${params.toString()}`;
    const response: MoralisNativeBalance = await this.httpClient.get(endpoint);

    // Convert from wei to ETH
    const balanceWei = new Decimal(response.balance);
    const balanceEth = balanceWei.dividedBy(new Decimal(10).pow(18));

    return {
      currency: "ETH",
      balance: balanceEth.toNumber(),
      used: 0,
      total: balanceEth.toNumber(),
    };
  }

  private async getTokenBalancesForAddress(
    address: string,
    contractAddresses?: string[],
  ): Promise<Balance[]> {
    const params = new URLSearchParams({
      chain: this.network,
    });

    if (contractAddresses) {
      contractAddresses.forEach((contract) => {
        params.append("token_addresses[]", contract);
      });
    }

    const endpoint = `/${address}/erc20?${params.toString()}`;
    const response = await this.httpClient.get<MoralisTokenBalance[]>(endpoint);

    const balances: Balance[] = [];

    for (const tokenBalance of response || []) {
      if (tokenBalance.balance && tokenBalance.balance !== "0") {
        const balance = new Decimal(tokenBalance.balance);
        const decimals = tokenBalance.decimals || 18;
        const symbol = tokenBalance.symbol || "UNKNOWN";

        const adjustedBalance = balance.dividedBy(
          new Decimal(10).pow(decimals),
        );

        balances.push({
          currency: symbol,
          balance: adjustedBalance.toNumber(),
          used: 0,
          total: adjustedBalance.toNumber(),
          contractAddress: tokenBalance.token_address,
        });
      }
    }

    return balances;
  }

  private convertNativeTransaction(
    tx: MoralisTransaction,
    userAddress: string,
  ): BlockchainTransaction {
    const isFromUser =
      tx.from_address.toLowerCase() === userAddress.toLowerCase();
    const isToUser = tx.to_address.toLowerCase() === userAddress.toLowerCase();

    // Determine transaction type
    let type: "transfer_in" | "transfer_out";
    if (isFromUser && isToUser) {
      type = "transfer_in"; // Self-transfer, treat as incoming
    } else if (isFromUser) {
      type = "transfer_out";
    } else {
      type = "transfer_in";
    }

    // Convert value from wei to ETH
    const valueWei = new Decimal(tx.value);
    const valueEth = valueWei.dividedBy(new Decimal(10).pow(18));

    return {
      hash: tx.hash,
      blockNumber: parseInt(tx.block_number),
      blockHash: tx.block_hash,
      timestamp: new Date(tx.block_timestamp).getTime(),
      from: tx.from_address,
      to: tx.to_address,
      value: createMoney(valueEth.toNumber(), "ETH"),
      fee: createMoney(0, "ETH"),
      gasUsed: parseInt(tx.receipt_gas_used),
      gasPrice: new Decimal(tx.gas_price).toNumber(),
      status: tx.receipt_status === "1" ? "success" : "failed",
      type,
    };
  }

  private convertTokenTransfer(
    tx: MoralisTokenTransfer,
    userAddress: string,
  ): BlockchainTransaction {
    const isFromUser =
      tx.from_address.toLowerCase() === userAddress.toLowerCase();
    const isToUser = tx.to_address.toLowerCase() === userAddress.toLowerCase();

    // Determine transaction type
    let type: "token_transfer_in" | "token_transfer_out";
    if (isFromUser && isToUser) {
      type = "token_transfer_in"; // Self-transfer, treat as incoming
    } else if (isFromUser) {
      type = "token_transfer_out";
    } else {
      type = "token_transfer_in";
    }

    // Convert value using token decimals
    const decimals = parseInt(tx.token_decimals);
    const valueRaw = new Decimal(tx.value);
    const value = valueRaw.dividedBy(new Decimal(10).pow(decimals));

    return {
      hash: tx.transaction_hash,
      blockNumber: parseInt(tx.block_number),
      blockHash: "",
      timestamp: new Date(tx.block_timestamp).getTime(),
      from: tx.from_address,
      to: tx.to_address,
      value: createMoney(value.toNumber(), tx.token_symbol),
      fee: createMoney(0, "ETH"),
      status: "success" as const,
      type,
      tokenContract: tx.address,
      tokenSymbol: tx.token_symbol,
    };
  }
}
