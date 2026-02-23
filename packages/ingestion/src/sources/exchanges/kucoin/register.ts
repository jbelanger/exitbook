import type { ExchangeAdapter } from '../../../shared/types/exchange-adapter.js';

import { KucoinCsvImporter } from './importer-csv.js';
import { KucoinProcessor } from './processor-csv.js';

export const kucoinAdapter: ExchangeAdapter = {
  exchange: 'kucoin',
  createImporter: () => new KucoinCsvImporter(),
  createProcessor: () => new KucoinProcessor(),
};
