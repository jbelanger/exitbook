import type { ExchangeAdapter } from '../../../shared/types/exchange-adapter.js';

import { KrakenApiImporter } from './importer.js';
import { KrakenProcessor } from './processor.js';

export const krakenAdapter: ExchangeAdapter = {
  exchange: 'kraken',
  createImporter: () => new KrakenApiImporter(),
  createProcessor: () => new KrakenProcessor(),
};
