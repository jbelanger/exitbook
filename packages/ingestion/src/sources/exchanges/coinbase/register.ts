import type { ExchangeAdapter } from '../../../shared/types/exchange-adapter.js';

import { CoinbaseApiImporter } from './importer.js';
import { CoinbaseProcessorV2 } from './processor-v2.js';
import { CoinbaseProcessor } from './processor.js';

export const coinbaseAdapter: ExchangeAdapter = {
  capabilities: {
    supportsApi: true,
    supportsCsv: false,
  },
  exchange: 'coinbase',
  createImporter: () => new CoinbaseApiImporter(),
  createLedgerProcessor: () => new CoinbaseProcessorV2(),
  createProcessor: () => new CoinbaseProcessor(),
};
