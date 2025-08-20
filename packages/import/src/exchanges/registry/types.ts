import type { IExchangeAdapter, IBlockchainAdapter, DataSourceCapabilities } from '@crypto/core';
import type { ExchangeConfig } from '../types.ts';

// Exchange-specific operation types for capabilities
export type ExchangeOperationType = 
  | 'fetchTrades'
  | 'fetchDeposits' 
  | 'fetchWithdrawals'
  | 'fetchClosedOrders'
  | 'fetchLedger'
  | 'fetchBalance'
  | 'importTransactions'
  | 'parseCSV';

/**
 * Exchange adapter capabilities extending the unified data source capabilities
 */
export interface ExchangeAdapterCapabilities extends DataSourceCapabilities<ExchangeOperationType> {
  /** Whether the exchange adapter supports balance verification against live data */
  supportsBalanceVerification: boolean;
  
  /** Whether the exchange requires API key authentication */
  requiresApiKey: boolean;
  
  /** Whether the exchange supports CSV file import */
  supportsCsv: boolean;
  
  /** Whether the exchange supports CCXT library integration */
  supportsCcxt: boolean;
  
  /** Whether the exchange supports native API integration */
  supportsNative: boolean;
}

/**
 * Exchange adapter metadata embedded in the adapter class
 */
export interface ExchangeAdapterMetadata {
  exchangeId: string;
  displayName: string;
  adapterType: 'ccxt' | 'native' | 'csv';
  description?: string;
  capabilities: ExchangeAdapterCapabilities;
  configValidation?: {
    requiredCredentials: string[];
    optionalCredentials: string[];
    requiredOptions: string[];
    optionalOptions: string[];
  };
  defaultConfig: {
    enableRateLimit: boolean;
    timeout: number;
    rateLimit?: number;
  };
}

/**
 * Factory function to create exchange adapter instances
 */
export type ExchangeAdapterFactory = {
  metadata: ExchangeAdapterMetadata;
  create: (config: ExchangeConfig, enableOnlineVerification?: boolean, database?: any) => Promise<IExchangeAdapter | IBlockchainAdapter>;
};

/**
 * Information about an available exchange adapter
 */
export interface ExchangeAdapterInfo {
  exchangeId: string;
  displayName: string;
  adapterType: 'ccxt' | 'native' | 'csv';
  description: string;
  capabilities: ExchangeAdapterCapabilities;
  defaultConfig: ExchangeAdapterMetadata['defaultConfig'];
  configValidation?: ExchangeAdapterMetadata['configValidation'];
}