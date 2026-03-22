export interface PriceProviderDescriptor {
  displayName: string;
  name: string;
  requiresApiKey: boolean;
  supportedAssetTypes: ('crypto' | 'fiat')[];
}

const PRICE_PROVIDER_DESCRIPTORS: PriceProviderDescriptor[] = [
  {
    displayName: 'Bank of Canada',
    name: 'bank-of-canada',
    requiresApiKey: false,
    supportedAssetTypes: ['fiat'],
  },
  {
    displayName: 'Binance',
    name: 'binance',
    requiresApiKey: false,
    supportedAssetTypes: ['crypto'],
  },
  {
    displayName: 'CoinGecko',
    name: 'coingecko',
    requiresApiKey: false,
    supportedAssetTypes: ['crypto'],
  },
  {
    displayName: 'CryptoCompare',
    name: 'cryptocompare',
    requiresApiKey: false,
    supportedAssetTypes: ['crypto'],
  },
  {
    displayName: 'European Central Bank',
    name: 'ecb',
    requiresApiKey: false,
    supportedAssetTypes: ['fiat'],
  },
  {
    displayName: 'Frankfurter (ECB)',
    name: 'frankfurter',
    requiresApiKey: false,
    supportedAssetTypes: ['fiat'],
  },
];

export function listPriceProviders(): PriceProviderDescriptor[] {
  return PRICE_PROVIDER_DESCRIPTORS.map((descriptor) => ({ ...descriptor }));
}
