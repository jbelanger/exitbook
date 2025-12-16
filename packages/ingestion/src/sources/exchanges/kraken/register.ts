import { registerExchange } from '../../../shared/types/exchange-adapter.ts';
import { DefaultExchangeProcessor } from '../shared/default-exchange-processor.js';

import { KrakenApiImporter } from './importer.js';

export function registerKrakenExchange(): void {
  registerExchange({
    exchange: 'kraken',
    createImporter: () => new KrakenApiImporter(),
    createProcessor: () => new DefaultExchangeProcessor('kraken'),
  });
}
