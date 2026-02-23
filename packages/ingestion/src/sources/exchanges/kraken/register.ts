import type { ExchangeAdapter } from '../../../shared/types/exchange-adapter.js';
import { DefaultExchangeProcessor } from '../shared/default-exchange-processor.js';

import { KrakenApiImporter } from './importer.js';

export const krakenAdapter: ExchangeAdapter = {
  exchange: 'kraken',
  createImporter: () => new KrakenApiImporter(),
  createProcessor: () => new DefaultExchangeProcessor('kraken'),
};
