// Exchange adapter types and interfaces

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