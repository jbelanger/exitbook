interface BaseAdapterConfig {
  id: string;
  type: 'exchange' | 'blockchain';
}

export interface ExchangeAdapterConfig extends BaseAdapterConfig {
  credentials?:
    | {
        apiKey: string;
        password?: string | undefined;
        secret: string;
      }
    | undefined;
  csvDirectories?: string[] | undefined;
  subType: 'ccxt' | 'csv';
  type: 'exchange';
}

export interface BlockchainAdapterConfig extends BaseAdapterConfig {
  network: string;
  subType: 'rest' | 'rpc';
  type: 'blockchain';
}

export type AdapterConfig = ExchangeAdapterConfig | BlockchainAdapterConfig;
