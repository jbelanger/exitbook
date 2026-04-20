import type { ExchangeAdapter } from '../../../shared/types/exchange-adapter.js';

import { KuCoinCsvImporter } from './importer.js';
import { KuCoinCsvProcessor } from './processor.js';

export const kucoinAdapter: ExchangeAdapter = {
  capabilities: {
    supportsApi: false,
    supportsCsv: true,
  },
  exchange: 'kucoin',
  createImporter: () => new KuCoinCsvImporter(),
  createProcessor: () => new KuCoinCsvProcessor(),
};
