import type { ExchangeAdapter } from '../../../shared/types/exchange-adapter.js';

import { KrakenApiImporter } from './importer.js';
import { KrakenProcessorV2 } from './processor-v2.js';
import { KrakenProcessor } from './processor.js';

export const krakenAdapter: ExchangeAdapter = {
  capabilities: {
    supportsApi: true,
    supportsCsv: false,
  },
  exchange: 'kraken',
  createImporter: () => new KrakenApiImporter(),
  createProcessor: () => new KrakenProcessor(),
  createLedgerProcessor: () => new KrakenProcessorV2(),
};
