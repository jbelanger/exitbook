import type { ExchangeAdapter } from '../../../shared/types/exchange-adapter.js';

import { KucoinCsvImporter } from './importer-csv.js';
import { KucoinProcessor } from './processor-csv.js';

export const kucoinAdapter: ExchangeAdapter = {
  capabilities: {
    supportsApi: false,
    supportsCsv: true,
  },
  exchange: 'kucoin',
  createImporter: () => new KucoinCsvImporter(),
  createProcessor: () => new KucoinProcessor(),
};
