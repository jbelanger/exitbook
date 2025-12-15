import { registerExchange } from '../../../core/types/exchange-adapter.ts';

import { CoinbaseApiImporter } from './importer.js';
import { CoinbaseProcessor } from './processor.js';

export function registerCoinbaseExchange(): void {
  registerExchange({
    exchange: 'coinbase',
    createImporter: () => new CoinbaseApiImporter(),
    createProcessor: () => new CoinbaseProcessor(),
  });
}
