import type { Money, TransactionStatus, TransactionType } from '@crypto/core';

export interface IUniversalAdapter {
  getInfo(): Promise<AdapterInfo>;
  testConnection(): Promise<boolean>;
  close(): Promise<void>;
  fetchTransactions(params: FetchParams): Promise<Transaction[]>;
  fetchBalances(params: FetchParams): Promise<Balance[]>;
}

export interface AdapterInfo {
  id: string;
  name: string;
  type: 'exchange' | 'blockchain';
  subType?: 'ccxt' | 'csv' | 'rpc' | 'rest';
  capabilities: AdapterCapabilities;
}

export interface AdapterCapabilities {
  supportedOperations: Array<
    | 'fetchTransactions' 
    | 'fetchBalances' 
    | 'getAddressTransactions'
    | 'getAddressBalance'
    | 'getTokenTransactions'
  >;
  maxBatchSize: number;
  supportsHistoricalData: boolean;
  supportsPagination: boolean;
  requiresApiKey: boolean;
  rateLimit?: {
    requestsPerSecond: number;
    burstLimit: number;
  };
}

export interface FetchParams {
  // Universal params
  addresses?: string[];        // For blockchains OR exchange accounts
  symbols?: string[];          // Filter by asset symbols
  since?: number;              // Time filter
  until?: number;              // Time filter
  
  // Optional type-specific params
  includeTokens?: boolean;     // For blockchains
  transactionTypes?: TransactionType[];
  
  // Pagination
  limit?: number;
  offset?: number;
}

export interface Transaction {
  // Universal fields
  id: string;
  timestamp: number;
  datetime: string;
  type: TransactionType;
  status: TransactionStatus;
  
  // Amounts
  amount: Money;
  fee?: Money;
  price?: Money;
  
  // Parties (works for both)
  from?: string;  // Sender address OR exchange account
  to?: string;    // Receiver address OR exchange account
  symbol?: string; // Add symbol for trades
  
  // Metadata
  source: string; // e.g., 'coinbase', 'bitcoin'
  network?: string; // e.g., 'mainnet'
  metadata: Record<string, any>;
}

export interface Balance {
  currency: string;
  total: number;
  free: number;
  used: number;
  contractAddress?: string;
}