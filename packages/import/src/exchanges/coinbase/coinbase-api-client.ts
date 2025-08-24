import { generateJwt } from '@coinbase/cdp-sdk/auth';
import type { RateLimitConfig } from '@crypto/core';
import { getLogger } from '@crypto/shared-logger';
import { HttpClient } from '@crypto/shared-utils';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

import type {
  CoinbaseAccountsParams,
  CoinbaseCredentials,
  CoinbaseTransactionsParams,
  RawCoinbaseAccount,
  RawCoinbaseAccountsResponse,
  RawCoinbaseTransaction,
  RawCoinbaseTransactionsResponse,
} from './types.ts';

/**
 * Direct API client for Coinbase Track API
 *
 * Provides access to Coinbase's Track API for transaction and account data.
 * Handles authentication, pagination, and error handling.
 *
 * API Documentation: https://docs.cdp.coinbase.com/coinbase-app/track-apis/
 * Authentication: OAuth2 or API Key
 *
 * CRITICAL: Uses Track API, not the Advanced Trade API
 * - Base URL: https://api.coinbase.com
 * - Endpoints: /v2/*
 * - Version: v2
 */
export class CoinbaseAPIClient {
  private readonly baseUrl: string;
  private readonly credentials: CoinbaseCredentials;
  private readonly httpClient: HttpClient;
  private readonly logger: ReturnType<typeof getLogger>;

  constructor(credentials: CoinbaseCredentials) {
    this.credentials = credentials;
    this.logger = getLogger('CoinbaseAPIClient');

    // Validate Coinbase credentials format
    this.validateCredentials();

    // Use Track API endpoints
    this.baseUrl = credentials.sandbox
      ? 'https://api.sandbox.coinbase.com' // Sandbox for Track API
      : 'https://api.coinbase.com'; // Production Track API

    // Configure HTTP client with Coinbase Track API rate limits
    const rateLimit: RateLimitConfig = {
      burstLimit: 5,
      requestsPerSecond: 3, // Coinbase Track API is more conservative
    };

    this.httpClient = new HttpClient({
      baseUrl: this.baseUrl,
      defaultHeaders: {
        Accept: 'application/json',
        'User-Agent': 'ccxt-crypto-tx-import/1.0.0',
      },
      providerName: 'coinbase-track',
      rateLimit,
      retries: 3,
      timeout: 30000, // Coinbase can be slow, especially for ledger queries
    });

    this.logger.info(
      `Coinbase API client initialized - BaseUrl: ${this.baseUrl}, Sandbox: ${credentials.sandbox || false}`
    );
  }

  /**
   * Make an authenticated request to Coinbase Track API
   *
   * Uses CDP API keys with ES256 JWT authentication (same as Advanced Trade API)
   */
  private async authenticatedRequest<T>(
    path: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
    params?: Record<string, unknown>,
    body?: unknown
  ): Promise<T> {
    // Build the full path with query parameters for GET requests
    const queryString =
      method === 'GET' && params ? '?' + new URLSearchParams(this.filterValidParams(params)).toString() : '';
    const fullPath = path + queryString;

    // Generate JWT token for Track API authentication (use base path without query params)
    const token = await this.generateJWT(method, path);

    // Build authentication headers
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };

    this.logger.debug(`Making authenticated request - Method: ${method}, Path: ${fullPath}`);

    try {
      const bodyString = body ? JSON.stringify(body) : undefined;
      const response = await this.httpClient.request<T>(fullPath, {
        headers,
        method,
        ...(bodyString && { body: bodyString }),
      });

      return response;
    } catch (error) {
      // Enhanced error logging for debugging authentication issues
      if (error instanceof Error) {
        if (error.message.includes('401') || error.message.includes('403')) {
          this.logger.error(
            `Authentication failed - Method: ${method}, Path: ${fullPath}, Error: ${error.message}. Check API credentials and permissions.`
          );
        } else {
          this.logger.error(`API request failed - Method: ${method}, Path: ${fullPath}, Error: ${error.message}`);
        }
      }
      throw error;
    }
  }

  /**
   * Filter out undefined/null parameters to avoid invalid query strings
   */
  private filterValidParams(params: Record<string, unknown>): Record<string, string> {
    const filtered: Record<string, string> = {};

    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') {
        filtered[key] = String(value);
      }
    }

    return filtered;
  }

  /**
   * Generate JWT token for Coinbase Advanced Trade API authentication
   * Uses ES256 algorithm with ECDSA keys as per official Coinbase documentation
   *
   * @param method HTTP method
   * @param path Request path
   * @returns JWT token
   */
  private async generateJWT(method: string, path: string): Promise<string> {
    try {
      this.logger.debug(
        `Generating JWT - Method: ${method}, Path: ${path}, ApiKey: ${this.credentials.apiKey.substring(0, 20)}...`
      );

      // Try CDP SDK first (it handles key format automatically)
      try {
        const token = await generateJwt({
          apiKeyId: this.credentials.apiKey,
          apiKeySecret: this.credentials.secret,
          expiresIn: 120,
          requestHost: 'api.coinbase.com',
          requestMethod: method,
          requestPath: path,
        });

        this.logger.debug(`CDP SDK JWT generated successfully - Length: ${token.length}`);
        return token;
      } catch (cdpError) {
        this.logger.debug(
          `CDP SDK failed: ${cdpError instanceof Error ? cdpError.message : 'Unknown error'}, trying manual JWT generation`
        );

        // Fallback to manual JWT generation with exact Coinbase format
        const keyName = this.credentials.apiKey;

        // Clean up the key format - handle various escaping scenarios
        let keySecret = this.credentials.secret;
        keySecret = keySecret.replace(/\\\\n/g, '\n'); // Double escaped newlines
        keySecret = keySecret.replace(/\\n/g, '\n'); // Single escaped newlines

        // Remove quotes if they wrap the entire key
        if (keySecret.startsWith('"') && keySecret.endsWith('"')) {
          keySecret = keySecret.slice(1, -1);
        }

        this.logger.debug(`Manual JWT - Key Secret length: ${keySecret.length}`);
        this.logger.debug(`Manual JWT - Key Secret starts with: ${keySecret.substring(0, 30)}...`);

        const algorithm = 'ES256';
        const uri = `${method} api.coinbase.com${path}`;

        const payload = {
          exp: Math.floor(Date.now() / 1000) + 120,
          iss: 'cdp',
          nbf: Math.floor(Date.now() / 1000),
          sub: keyName,
          uri,
        };

        const header = {
          alg: algorithm,
          kid: keyName,
          nonce: crypto.randomBytes(16).toString('hex'),
        };

        // Create private key object for ES256 algorithm
        let privateKey: crypto.KeyObject;
        try {
          privateKey = crypto.createPrivateKey(keySecret);
          this.logger.debug('Successfully created private key object');
        } catch (keyError) {
          this.logger.error(
            `Failed to create private key: ${keyError instanceof Error ? keyError.message : 'Unknown error'}`
          );
          throw keyError;
        }

        const token = jwt.sign(payload, privateKey, { algorithm, header });

        this.logger.debug(`Manual JWT generated successfully - Length: ${token.length}`);
        return token;
      }
    } catch (error) {
      this.logger.error(`JWT generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  /**
   * Validate Coinbase credentials format and provide helpful error messages
   */
  private validateCredentials(): void {
    // Validate API key format
    if (!this.credentials.apiKey.includes('/apiKeys/')) {
      throw new Error(
        `❌ Invalid Coinbase API key format. Expected: organizations/{org_id}/apiKeys/{key_id}, got: ${this.credentials.apiKey}\n\n` +
          `🔧 To create a valid Coinbase API key:\n` +
          `   1. Go to https://portal.cdp.coinbase.com/access/api\n` +
          `   2. Select 'Secret API Keys' tab\n` +
          `   3. Click 'Create API key'\n` +
          `   4. CRITICAL: Select 'ECDSA' as signature algorithm (NOT Ed25519)\n` +
          `   5. Use the full API key path: organizations/YOUR_ORG_ID/apiKeys/YOUR_KEY_ID`
      );
    }

    // Validate private key format
    if (!this.credentials.secret.includes('-----BEGIN EC PRIVATE KEY-----')) {
      throw new Error(
        `❌ Invalid Coinbase private key format. Expected ECDSA PEM key, got: ${this.credentials.secret.substring(0, 50)}...\n\n` +
          `🔧 Requirements:\n` +
          `   • Must be ECDSA key (NOT Ed25519)\n` +
          `   • Must be in PEM format: -----BEGIN EC PRIVATE KEY-----\\n...\\n-----END EC PRIVATE KEY-----\n` +
          `   • In .env file, use actual newlines (not \\n escapes)\n\n` +
          `💡 Example .env format:\n` +
          `   COINBASE_SECRET="-----BEGIN EC PRIVATE KEY-----\n` +
          `   MHcCAQEE...\n` +
          `   -----END EC PRIVATE KEY-----"`
      );
    }
  }

  /**
   * Get all user accounts
   *
   * @param params Optional pagination and filtering parameters
   * @returns Promise resolving to array of accounts
   */
  async getAccounts(params: CoinbaseAccountsParams = {}): Promise<RawCoinbaseAccount[]> {
    this.logger.debug(`Fetching Coinbase accounts - Params: ${JSON.stringify(params)}`);

    const response = await this.authenticatedRequest<RawCoinbaseAccountsResponse>('/v2/accounts', 'GET', params);

    const accounts = response.data || [];
    this.logger.info(`Retrieved ${accounts.length} Coinbase accounts`);

    return accounts;
  }

  /**
   * Get transactions for a specific account with pagination
   * This is the correct endpoint for Coinbase Track API transaction data
   *
   * @param accountId The account ID to fetch transactions for
   * @param params Optional pagination and filtering parameters
   * @returns Promise resolving to paginated transactions response
   */
  async getAccountTransactions(
    accountId: string,
    params: CoinbaseTransactionsParams = {}
  ): Promise<RawCoinbaseTransactionsResponse> {
    this.logger.debug(`Fetching transactions for account ${accountId} - Params: ${JSON.stringify(params)}`);

    const response = await this.authenticatedRequest<RawCoinbaseTransactionsResponse>(
      `/v2/accounts/${accountId}/transactions`,
      'GET',
      params
    );

    const transactionsCount = response.data?.length || 0;
    this.logger.debug(
      `Retrieved ${transactionsCount} transactions - HasNext: ${response.pagination?.next_uri ? 'yes' : 'no'}`
    );

    return response;
  }

  /**
   * Get rate limit status from underlying HTTP client
   */
  getRateLimitStatus() {
    return this.httpClient.getRateLimitStatus();
  }

  /**
   * Test the connection and authentication
   *
   * @returns Promise resolving to true if connection is successful
   */
  async testConnection(): Promise<boolean> {
    try {
      this.logger.info('Testing Coinbase API connection and authentication...');

      // Simple test: fetch accounts (should work for any valid API key)
      const accounts = await this.getAccounts({ limit: 1 });

      this.logger.info(`Connection test successful - Retrieved ${accounts.length} accounts`);
      return true;
    } catch (error) {
      this.logger.error(`Connection test failed - Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return false;
    }
  }
}
