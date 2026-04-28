import type { ExchangeAdapter } from '../../../shared/types/exchange-adapter.js';

import { KuCoinCsvImporter } from './importer.js';
import { KuCoinProcessorV2 } from './processor-v2.js';
import { KuCoinCsvProcessor } from './processor.js';

export const kucoinAdapter: ExchangeAdapter = {
  capabilities: {
    supportsApi: false,
    supportsCsv: true,
  },
  exchange: 'kucoin',
  createImporter: () => new KuCoinCsvImporter(),
  createLedgerProcessor: () => new KuCoinProcessorV2(),
  createProcessor: () => new KuCoinCsvProcessor(),
};
