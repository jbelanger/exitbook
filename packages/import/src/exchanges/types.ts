import type { CryptoTransaction } from '@crypto/core';

// Exchange adapter types and interfaces
export interface ExchangeInfo {
  id: string;
  name: string;
  version?: string;
  capabilities: ExchangeCapabilities;
  rateLimit?: number;
}

export interface ExchangeCapabilities {
  fetchMyTrades: boolean;
  fetchDeposits: boolean;
  fetchWithdrawals: boolean;
  fetchLedger: boolean;
  fetchClosedOrders: boolean;
  fetchBalance: boolean;
  fetchOrderBook: boolean;
  fetchTicker: boolean;
}

// Abstract interface for exchange operations
export interface IExchangeAdapter {
  // Connection and info
  testConnection(): Promise<boolean>;
  getExchangeInfo(): Promise<ExchangeInfo>;

  // Transaction fetching
  fetchAllTransactions(since?: number): Promise<CryptoTransaction[]>;
  fetchTrades(since?: number): Promise<CryptoTransaction[]>;
  fetchDeposits(since?: number): Promise<CryptoTransaction[]>;
  fetchWithdrawals(since?: number): Promise<CryptoTransaction[]>;
  fetchClosedOrders(since?: number): Promise<CryptoTransaction[]>;
  fetchLedger(since?: number): Promise<CryptoTransaction[]>;

  // Balance operations
  fetchBalance(): Promise<ExchangeBalance[]>;

  // Cleanup
  close(): Promise<void>;
}

export interface ExchangeBalance {
  currency: string;
  balance: number; // Available/free amount
  used: number;
  total: number;
}

export interface ExchangeCredentials {
  apiKey: string;
  secret: string;
  password?: string; // Used by some exchanges for passphrase
  sandbox?: boolean;
  [key: string]: any; // Allow for exchange-specific credentials
}

export interface ExchangeOptions {
  rateLimit?: number;
  enableRateLimit?: boolean;
  timeout?: number;
  csvDirectory?: string; // For CSV adapter
  uid?: string; // For CSV adapter - optional UID to filter by
  [key: string]: any;
}

// Exchange configuration for traditional exchange adapters
export interface ExchangeConfig {
  id: string;
  enabled: boolean;
  adapterType?: 'ccxt' | 'native' | 'csv';
  credentials: ExchangeCredentials;
  options?: ExchangeOptions;
}