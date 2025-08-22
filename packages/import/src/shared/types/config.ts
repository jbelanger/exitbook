interface BaseAdapterConfig {
  type: 'exchange' | 'blockchain';
  id: string;
}

export interface ExchangeAdapterConfig extends BaseAdapterConfig {
  type: 'exchange';
  subType: 'ccxt' | 'csv';
  credentials?: { 
    apiKey: string; 
    secret: string; 
    password?: string; 
  };
  csvDirectories?: string[];
}

export interface BlockchainAdapterConfig extends BaseAdapterConfig {
  type: 'blockchain';
  subType: 'rest' | 'rpc';
  network: string;
}

export type AdapterConfig = ExchangeAdapterConfig | BlockchainAdapterConfig;