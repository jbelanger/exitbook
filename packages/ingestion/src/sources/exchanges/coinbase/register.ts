import { registerExchange } from '../../../shared/types/exchange-adapter.js';

import { CoinbaseApiImporter } from './importer.js';
import { CoinbaseProcessor } from './processor.js';

export function registerCoinbaseExchange(): void {
  registerExchange({
    exchange: 'coinbase',
    createImporter: () => new CoinbaseApiImporter(),
    createProcessor: () => new CoinbaseProcessor(),
  });
}
