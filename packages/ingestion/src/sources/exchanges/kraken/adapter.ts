import { registerExchange } from '../../../core/types/exchange-adapter.ts';
import { DefaultExchangeProcessor } from '../shared/default-exchange-processor.js';

import { KrakenApiImporter } from './importer.js';

registerExchange({
  exchange: 'kraken',
  createImporter: () => new KrakenApiImporter(),
  createProcessor: () => new DefaultExchangeProcessor('kraken'),
});
