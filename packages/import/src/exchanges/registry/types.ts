import type { IExchangeAdapter, IBlockchainAdapter } from '@crypto/core';
import type { ExchangeConfig } from '../types.ts';

/**
 * Exchange adapter capabilities
 */
export interface ExchangeAdapterCapabilities {
  supportedOperations: string[];
  supportsPagination: boolean;
  supportsBalanceVerification: boolean;
  supportsHistoricalData: boolean;
  requiresApiKey: boolean;
  supportsCsv: boolean;
  supportsCcxt: boolean;
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