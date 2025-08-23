import crypto from "crypto";
import type { RateLimitConfig } from "@crypto/core";
import { getLogger } from "@crypto/shared-logger";
import { HttpClient } from "@crypto/shared-utils";
import type {
  CoinbaseCredentials,
  RawCoinbaseAccount,
  RawCoinbaseAccountsResponse,
  RawCoinbaseLedgerEntry,
  RawCoinbaseLedgerResponse,
  CoinbaseAccountsParams,
  CoinbaseLedgerParams,
} from "./types.ts";

/**
 * Direct API client for Coinbase Advanced Trade API
 *
 * Eliminates CCXT dependency and provides clean access to Coinbase's native API.
 * Handles authentication, pagination, and error handling.
 *
 * API Documentation: https://docs.cloud.coinbase.com/advanced-trade-api/docs/welcome
 * Authentication: https://docs.cloud.coinbase.com/advanced-trade-api/docs/rest-api-auth
 *
 * CRITICAL: Uses Advanced Trade API, not the deprecated Pro API
 * - Base URL: https://api.coinbase.com
 * - Endpoints: /api/v3/brokerage/*
 * - Version: 2015-07-22
 */
export class CoinbaseAPIClient {
  private readonly httpClient: HttpClient;
  private readonly logger: ReturnType<typeof getLogger>;
  private readonly credentials: CoinbaseCredentials;
  private readonly baseUrl: string;

  constructor(credentials: CoinbaseCredentials) {
    this.credentials = credentials;
    this.logger = getLogger("CoinbaseAPIClient");

    // Use sandbox or production URL
    this.baseUrl = credentials.sandbox
      ? "https://api.sandbox.coinbase.com" // Sandbox for Advanced Trade
      : "https://api.coinbase.com"; // Production Advanced Trade

    // Configure HTTP client with Coinbase-appropriate rate limits
    const rateLimit: RateLimitConfig = {
      requestsPerSecond: 10, // Coinbase Advanced Trade allows 10 requests/second
      burstLimit: 15,
    };

    this.httpClient = new HttpClient({
      baseUrl: this.baseUrl,
      timeout: 30000, // Coinbase can be slow, especially for ledger queries
      retries: 3,
      rateLimit,
      providerName: "coinbase-advanced",
      defaultHeaders: {
        Accept: "application/json",
        "User-Agent": "ccxt-crypto-tx-import/1.0.0",
      },
    });

    this.logger.info(
      `Coinbase API client initialized - BaseUrl: ${this.baseUrl}, Sandbox: ${credentials.sandbox || false}`,
    );
  }

  /**
   * Get all user accounts
   *
   * @param params Optional pagination and filtering parameters
   * @returns Promise resolving to array of accounts
   */
  async getAccounts(
    params: CoinbaseAccountsParams = {},
  ): Promise<RawCoinbaseAccount[]> {
    this.logger.debug(
      `Fetching Coinbase accounts - Params: ${JSON.stringify(params)}`,
    );

    const response =
      await this.authenticatedRequest<RawCoinbaseAccountsResponse>(
        "/api/v3/brokerage/accounts",
        "GET",
        params,
      );

    const accounts = response.accounts || [];
    this.logger.info(`Retrieved ${accounts.length} Coinbase accounts`);

    return accounts;
  }

  /**
   * Get ledger entries for a specific account with pagination
   *
   * @param accountId UUID of the account
   * @param params Optional pagination and filtering parameters
   * @returns Promise resolving to paginated ledger response
   */
  async getAccountLedger(
    accountId: string,
    params: CoinbaseLedgerParams = {},
  ): Promise<RawCoinbaseLedgerResponse> {
    if (!accountId) {
      throw new Error("Account ID is required for ledger requests");
    }

    this.logger.debug(
      `Fetching account ledger - AccountId: ${accountId}, Params: ${JSON.stringify(params)}`,
    );

    const response = await this.authenticatedRequest<RawCoinbaseLedgerResponse>(
      `/api/v3/brokerage/accounts/${accountId}/ledger`,
      "GET",
      params,
    );

    const entriesCount = response.ledger?.length || 0;
    this.logger.debug(
      `Retrieved ${entriesCount} ledger entries for account ${accountId} - HasNext: ${response.has_next}, Cursor: ${response.cursor ? "present" : "none"}`,
    );

    return response;
  }

  /**
   * Fetch all ledger entries for an account using automatic pagination
   *
   * @param accountId UUID of the account
   * @param params Optional filtering parameters (pagination handled automatically)
   * @returns Promise resolving to all ledger entries
   */
  async getAllAccountLedgerEntries(
    accountId: string,
    params: Omit<CoinbaseLedgerParams, "cursor"> = {},
  ): Promise<RawCoinbaseLedgerEntry[]> {
    const allEntries: RawCoinbaseLedgerEntry[] = [];
    let cursor: string | undefined;
    let pageCount = 0;
    const maxPages = 1000; // Safety limit to prevent infinite loops

    this.logger.info(
      `Starting paginated ledger fetch for account ${accountId}`,
    );

    do {
      pageCount++;

      if (pageCount > maxPages) {
        this.logger.warn(
          `Reached maximum page limit (${maxPages}) for account ${accountId}, stopping pagination`,
        );
        break;
      }

      const response = await this.getAccountLedger(accountId, {
        ...params,
        ...(cursor && { cursor }),
        limit: (params.limit as number | undefined) ?? 100, // Default to maximum page size
      });

      if (response.ledger && response.ledger.length > 0) {
        allEntries.push(...response.ledger);
        cursor = response.has_next ? response.cursor : undefined;

        this.logger.debug(
          `Page ${pageCount}: Retrieved ${response.ledger.length} entries - Total: ${allEntries.length}, HasNext: ${response.has_next}`,
        );
      } else {
        this.logger.debug(
          `Page ${pageCount}: No entries returned, ending pagination`,
        );
        break;
      }
    } while (cursor);

    this.logger.info(
      `Completed paginated ledger fetch for account ${accountId} - TotalEntries: ${allEntries.length}, Pages: ${pageCount}`,
    );

    return allEntries;
  }

  /**
   * Make an authenticated request to Coinbase Advanced Trade API
   *
   * Implements Coinbase's signature-based authentication as per:
   * https://docs.cloud.coinbase.com/advanced-trade-api/docs/rest-api-auth
   */
  private async authenticatedRequest<T>(
    path: string,
    method: "GET" | "POST" | "PUT" | "DELETE" = "GET",
    params?: Record<string, unknown>,
    body?: unknown,
  ): Promise<T> {
    // Build the full path with query parameters for GET requests
    const queryString =
      method === "GET" && params
        ? "?" + new URLSearchParams(this.filterValidParams(params)).toString()
        : "";
    const fullPath = path + queryString;

    // Generate timestamp for request (Unix timestamp in seconds)
    const timestamp = Math.floor(Date.now() / 1000).toString();

    // Build the message to sign according to Coinbase spec:
    // timestamp + method + path + body
    const bodyString = body ? JSON.stringify(body) : "";
    const message = timestamp + method + fullPath + bodyString;

    // Create signature using HMAC SHA256
    const signature = crypto
      .createHmac("sha256", this.credentials.secret)
      .update(message)
      .digest("hex");

    // Build authentication headers
    const headers: Record<string, string> = {
      "CB-ACCESS-KEY": this.credentials.apiKey,
      "CB-ACCESS-SIGN": signature,
      "CB-ACCESS-TIMESTAMP": timestamp,
      "CB-ACCESS-PASSPHRASE": this.credentials.passphrase,
      "CB-VERSION": "2015-07-22", // Advanced Trade API version
    };

    // Add content-type for requests with body
    if (body) {
      headers["Content-Type"] = "application/json";
    }

    this.logger.debug(
      `Making authenticated request - Method: ${method}, Path: ${fullPath}, Timestamp: ${timestamp}`,
    );

    try {
      const response = await this.httpClient.request<T>(fullPath, {
        method,
        headers,
        ...(bodyString && { body: bodyString }),
      });

      return response;
    } catch (error) {
      // Enhanced error logging for debugging authentication issues
      if (error instanceof Error) {
        if (error.message.includes("401") || error.message.includes("403")) {
          this.logger.error(
            `Authentication failed - Method: ${method}, Path: ${fullPath}, Error: ${error.message}. Check API credentials and permissions.`,
          );
        } else {
          this.logger.error(
            `API request failed - Method: ${method}, Path: ${fullPath}, Error: ${error.message}`,
          );
        }
      }
      throw error;
    }
  }

  /**
   * Filter out undefined/null parameters to avoid invalid query strings
   */
  private filterValidParams(
    params: Record<string, unknown>,
  ): Record<string, string> {
    const filtered: Record<string, string> = {};

    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") {
        filtered[key] = String(value);
      }
    }

    return filtered;
  }

  /**
   * Test the connection and authentication
   *
   * @returns Promise resolving to true if connection is successful
   */
  async testConnection(): Promise<boolean> {
    try {
      this.logger.info("Testing Coinbase API connection and authentication...");

      // Simple test: fetch accounts (should work for any valid API key)
      const accounts = await this.getAccounts({ limit: 1 });

      this.logger.info(
        `Connection test successful - Retrieved ${accounts.length} accounts`,
      );
      return true;
    } catch (error) {
      this.logger.error(
        `Connection test failed - Error: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      return false;
    }
  }

  /**
   * Get rate limit status from underlying HTTP client
   */
  getRateLimitStatus() {
    return this.httpClient.getRateLimitStatus();
  }
}
