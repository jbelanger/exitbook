import type { ExchangeAdapter } from '../../../shared/types/exchange-adapter.js';

import { KucoinCsvImporter } from './importer.js';
import { KucoinCsvProcessor } from './processor.js';

export const kucoinAdapter: ExchangeAdapter = {
  capabilities: {
    supportsApi: false,
    supportsCsv: true,
  },
  exchange: 'kucoin',
  createImporter: () => new KucoinCsvImporter(),
  createProcessor: () => new KucoinCsvProcessor(),
};
