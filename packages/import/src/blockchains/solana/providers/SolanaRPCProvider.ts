import { Decimal } from "decimal.js";

import type { Balance, BlockchainTransaction } from "@crypto/core";

import { createMoney, maskAddress } from "@crypto/shared-utils";
import { BaseRegistryProvider } from "../../shared/registry/base-registry-provider.ts";
import { RegisterProvider } from "../../shared/registry/decorators.ts";
import type { ProviderOperation, JsonRpcResponse } from "../../shared/types.ts";
import type { SolanaRPCTransaction, SolanaSignature } from "../types.ts";
import { isValidSolanaAddress, lamportsToSol } from "../utils.ts";

@RegisterProvider({
  name: "solana-rpc",
  blockchain: "solana",
  displayName: "Solana RPC",
  type: "rpc",
  requiresApiKey: false,
  description:
    "Direct connection to Solana mainnet RPC endpoints with basic transaction data",
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
      baseUrl: "https://api.mainnet-beta.solana.com",
    },
    testnet: {
      baseUrl: "https://api.testnet.solana.com",
    },
    devnet: {
      baseUrl: "https://api.devnet.solana.com",
    },
  },
  defaultConfig: {
    timeout: 30000,
    retries: 3,
    rateLimit: {
      requestsPerSecond: 1, // Conservative for public RPC
      burstLimit: 2,
    },
  },
})
export class SolanaRPCProvider extends BaseRegistryProvider {
  constructor() {
    super("solana", "solana-rpc", "mainnet");
  }

  async isHealthy(): Promise<boolean> {
    try {
      const response = await this.httpClient.post<JsonRpcResponse<string>>(
        "/",
        {
          jsonrpc: "2.0",
          id: 1,
          method: "getHealth",
        },
      );
      return response && response.result === "ok";
    } catch (error) {
      this.logger.warn(
        `Health check failed - Error: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      const response = await this.httpClient.post<JsonRpcResponse<string>>(
        "/",
        {
          jsonrpc: "2.0",
          id: 1,
          method: "getHealth",
        },
      );
      this.logger.debug(
        `Connection test successful - Health: ${response?.result}`,
      );
      return response && response.result === "ok";
    } catch (error) {
      this.logger.error(
        `Connection test failed - Error: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  async execute<T>(operation: ProviderOperation<T>): Promise<T> {
    this.logger.debug(
      `Executing operation - Type: ${operation.type}, Address: ${"address" in operation ? maskAddress(operation.address as string) : "N/A"}`,
    );

    try {
      switch (operation.type) {
        case "getAddressTransactions":
          return this.getAddressTransactions({
            address: operation.address,
            since: operation.since,
          }) as T;
        case "getAddressBalance":
          return this.getAddressBalance({
            address: operation.address,
          }) as T;
        case "getTokenTransactions":
          return this.getTokenTransactions({
            address: operation.address,
            contractAddress: operation.contractAddress,
            since: operation.since,
          }) as T;
        case "getTokenBalances":
          return this.getTokenBalances({
            address: operation.address,
            contractAddresses: operation.contractAddresses,
          }) as T;
        default:
          throw new Error(`Unsupported operation: ${operation.type}`);
      }
    } catch (error) {
      this.logger.error(
        `Operation execution failed - Type: ${operation.type}, Error: ${error instanceof Error ? error.message : String(error)}, Stack: ${error instanceof Error ? error.stack : undefined}`,
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
      `Fetching address transactions - Address: ${maskAddress(address)}, Network: ${this.network}`,
    );

    try {
      // Get signatures for address
      const signaturesResponse = await this.httpClient.post<
        JsonRpcResponse<
          Array<{ signature: string; slot: number; blockTime?: number }>
        >
      >("/", {
        jsonrpc: "2.0",
        id: 1,
        method: "getSignaturesForAddress",
        params: [
          address,
          {
            limit: 100,
          },
        ],
      });

      if (!signaturesResponse?.result) {
        this.logger.debug(
          `No signatures found - Address: ${maskAddress(address)}`,
        );
        return [];
      }

      const transactions: BlockchainTransaction[] = [];
      const signatures = signaturesResponse.result.slice(0, 50); // Limit for performance

      this.logger.debug(
        `Retrieved signatures - Address: ${maskAddress(address)}, Count: ${signatures.length}`,
      );

      // Fetch transaction details
      for (const sig of signatures) {
        try {
          const txResponse = await this.httpClient.post<
            JsonRpcResponse<SolanaRPCTransaction>
          >("/", {
            jsonrpc: "2.0",
            id: 1,
            method: "getTransaction",
            params: [
              sig.signature,
              {
                encoding: "json",
                maxSupportedTransactionVersion: 0,
              },
            ],
          });

          if (txResponse?.result) {
            const blockchainTx = this.transformTransaction(
              txResponse.result,
              address,
            );
            if (blockchainTx && (!since || blockchainTx.timestamp >= since)) {
              transactions.push(blockchainTx);
            }
          }
        } catch (error) {
          this.logger.debug(
            `Failed to fetch transaction details - Signature: ${sig.signature}, Error: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      // Sort by timestamp (newest first)
      transactions.sort((a, b) => b.timestamp - a.timestamp);

      this.logger.debug(
        `Successfully retrieved address transactions - Address: ${maskAddress(address)}, TotalTransactions: ${transactions.length}, Network: ${this.network}`,
      );

      return transactions;
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

    if (!isValidSolanaAddress(address)) {
      throw new Error(`Invalid Solana address: ${address}`);
    }

    this.logger.debug(
      `Fetching address balance - Address: ${maskAddress(address)}, Network: ${this.network}`,
    );

    try {
      const response = await this.httpClient.post<
        JsonRpcResponse<{ value: number }>
      >("/", {
        jsonrpc: "2.0",
        id: 1,
        method: "getBalance",
        params: [address],
      });

      if (!response?.result || response.result.value === undefined) {
        throw new Error("Failed to fetch balance from Solana RPC");
      }

      const lamports = new Decimal(response.result.value);
      const solBalance = lamportsToSol(lamports.toNumber());

      this.logger.debug(
        `Successfully retrieved address balance - Address: ${maskAddress(address)}, BalanceSOL: ${solBalance.toNumber()}, Network: ${this.network}`,
      );

      return {
        currency: "SOL",
        balance: solBalance.toNumber(),
        used: 0,
        total: solBalance.toNumber(),
      };
    } catch (error) {
      this.logger.error(
        `Failed to get address balance - Address: ${maskAddress(address)}, Network: ${this.network}, Error: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  private transformTransaction(
    tx: SolanaRPCTransaction,
    userAddress: string,
  ): BlockchainTransaction | null {
    try {
      const accountKeys = tx.transaction.message.accountKeys;
      const userIndex = accountKeys.findIndex((key) => key === userAddress);

      if (userIndex === -1) {
        this.logger.debug(
          `Transaction not relevant to user - Signature: ${tx.transaction.signatures?.[0]}`,
        );
        return null;
      }

      // Calculate balance change
      const preBalance = tx.meta.preBalances[userIndex] || 0;
      const postBalance = tx.meta.postBalances[userIndex] || 0;
      const rawBalanceChange = postBalance - preBalance;

      // For fee payer, add back the fee to get the actual transfer amount
      const isFeePayerIndex = userIndex === 0;
      const feeAdjustment = isFeePayerIndex ? tx.meta.fee : 0;
      const balanceChange = rawBalanceChange + feeAdjustment;

      const amount = lamportsToSol(Math.abs(balanceChange));
      const type: "transfer_in" | "transfer_out" =
        balanceChange > 0 ? "transfer_in" : "transfer_out";
      const fee = lamportsToSol(tx.meta.fee);

      // Skip transactions with no meaningful amount (pure fee transactions)
      if (amount.toNumber() <= fee.toNumber() && amount.toNumber() < 0.000001) {
        this.logger.debug(
          `Skipping fee-only transaction - Hash: ${tx.transaction.signatures?.[0]}, Amount: ${amount.toNumber()}, Fee: ${fee.toNumber()}`,
        );
        return null;
      }

      return {
        hash: tx.transaction.signatures?.[0] || "",
        blockNumber: tx.slot,
        blockHash: "",
        timestamp: (tx.blockTime || 0) * 1000,
        from: accountKeys?.[0] || "",
        to: "",
        value: createMoney(amount.toNumber(), "SOL"),
        fee: createMoney(fee.toNumber(), "SOL"),
        gasUsed: undefined,
        gasPrice: undefined,
        status: tx.meta.err ? "failed" : "success",
        type,
        tokenContract: undefined,
        tokenSymbol: "SOL",
        nonce: undefined,
        confirmations: 1,
      };
    } catch (error) {
      this.logger.warn(
        `Failed to transform transaction - Signature: ${tx.transaction.signatures?.[0]}, Error: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
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

    this.logger.debug(
      `Fetching token transactions - Address: ${maskAddress(address)}, Network: ${this.network}`,
    );

    try {
      // Get all signatures for this address (same as regular transactions)
      const signaturesResponse = await this.httpClient.post<
        JsonRpcResponse<SolanaSignature[]>
      >("/", {
        jsonrpc: "2.0",
        id: 1,
        method: "getSignaturesForAddress",
        params: [
          address,
          {
            limit: 1000, // Increase limit to find more historical token transactions
          },
        ],
      });

      if (!signaturesResponse?.result) {
        this.logger.debug(
          `No signatures found for token transactions - Address: ${maskAddress(address)}`,
        );
        return [];
      }

      const signatures = signaturesResponse.result.slice(0, 100); // Process more signatures for token transactions
      const tokenTransactions: BlockchainTransaction[] = [];

      // Process signatures individually to find token transactions (avoid batch requests)
      for (const sig of signatures) {
        try {
          const txResponse = await this.httpClient.post<
            JsonRpcResponse<SolanaRPCTransaction>
          >("/", {
            jsonrpc: "2.0",
            id: 1,
            method: "getTransaction",
            params: [
              sig.signature,
              {
                encoding: "json",
                maxSupportedTransactionVersion: 0,
              },
            ],
          });

          if (txResponse?.result) {
            const tokenTx = this.extractTokenTransaction(
              txResponse.result,
              address,
              contractAddress,
            );
            if (tokenTx && (!since || tokenTx.timestamp >= since)) {
              tokenTransactions.push(tokenTx);
            }
          }
        } catch (error) {
          this.logger.debug(
            `Failed to fetch token transaction details - Signature: ${sig.signature}, Error: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      tokenTransactions.sort((a, b) => b.timestamp - a.timestamp);

      this.logger.debug(
        `Successfully retrieved token transactions - Address: ${maskAddress(address)}, TotalTransactions: ${tokenTransactions.length}, Network: ${this.network}`,
      );

      return tokenTransactions;
    } catch (error) {
      this.logger.error(
        `Failed to get token transactions - Address: ${maskAddress(address)}, Network: ${this.network}, Error: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
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

    this.logger.debug(
      `Fetching token balances - Address: ${maskAddress(address)}, Network: ${this.network}`,
    );

    try {
      // Get all token accounts owned by the address
      const tokenAccountsResponse = await this.httpClient.post<
        JsonRpcResponse<{
          value: Array<{
            account: {
              data: {
                parsed: {
                  info: {
                    mint: string;
                    owner: string;
                    tokenAmount: {
                      amount: string;
                      decimals: number;
                      uiAmount: number;
                      uiAmountString: string;
                    };
                  };
                };
              };
            };
          }>;
        }>
      >("/", {
        jsonrpc: "2.0",
        id: 1,
        method: "getTokenAccountsByOwner",
        params: [
          address,
          {
            programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", // SPL Token Program ID
          },
          {
            encoding: "jsonParsed",
          },
        ],
      });

      if (!tokenAccountsResponse?.result?.value) {
        this.logger.debug(
          `No token accounts found - Address: ${maskAddress(address)}`,
        );
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
          currency: mintAddress.slice(0, 8), // Use truncated mint address as symbol for now
          balance: tokenAmount.uiAmount,
          used: 0,
          total: tokenAmount.uiAmount,
          contractAddress: mintAddress,
        });
      }

      this.logger.debug(
        `Successfully retrieved token balances - Address: ${maskAddress(address)}, TotalTokens: ${balances.length}, Network: ${this.network}`,
      );

      return balances;
    } catch (error) {
      this.logger.error(
        `Failed to get token balances - Address: ${maskAddress(address)}, Network: ${this.network}, Error: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  private extractTokenTransaction(
    tx: SolanaRPCTransaction,
    userAddress: string,
    targetContract?: string,
  ): BlockchainTransaction | null {
    try {
      // Look for token balance changes in preTokenBalances and postTokenBalances
      const preTokenBalances = tx.meta.preTokenBalances || [];
      const postTokenBalances = tx.meta.postTokenBalances || [];

      // Find changes for token accounts
      for (const postBalance of postTokenBalances) {
        const preBalance = preTokenBalances.find(
          (pre) =>
            pre.accountIndex === postBalance.accountIndex &&
            pre.mint === postBalance.mint,
        );

        const preAmount = preBalance
          ? parseFloat(preBalance.uiTokenAmount.uiAmountString || "0")
          : 0;
        const postAmount = parseFloat(
          postBalance.uiTokenAmount.uiAmountString || "0",
        );
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
          `Found SPL token transaction - Signature: ${tx.transaction.signatures?.[0]}, Mint: ${postBalance.mint}, Change: ${Math.abs(change)}, Type: ${change > 0 ? "transfer_in" : "transfer_out"}`,
        );

        // Determine transfer direction
        const type: "transfer_in" | "transfer_out" =
          change > 0 ? "transfer_in" : "transfer_out";

        return {
          hash: tx.transaction.signatures?.[0] || "",
          blockNumber: tx.slot,
          blockHash: "",
          timestamp: (tx.blockTime || 0) * 1000,
          from: type === "transfer_out" ? userAddress : "",
          to: type === "transfer_in" ? userAddress : "",
          value: createMoney(Math.abs(change), "UNKNOWN"), // Will be updated with proper symbol later
          fee: createMoney(lamportsToSol(tx.meta.fee).toNumber(), "SOL"),
          gasUsed: undefined,
          gasPrice: undefined,
          status: tx.meta.err ? "failed" : "success",
          type: "token_transfer",
          tokenContract: postBalance.mint,
          tokenSymbol: postBalance.uiTokenAmount.uiAmountString?.includes(".")
            ? "UNKNOWN"
            : "UNKNOWN",
          nonce: undefined,
          confirmations: 1,
        };
      }

      return null;
    } catch (error) {
      this.logger.debug(
        `Failed to extract token transaction - Signature: ${tx.transaction.signatures?.[0]}, Error: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }
}
