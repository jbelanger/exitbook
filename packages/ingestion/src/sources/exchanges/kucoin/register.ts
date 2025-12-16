import { registerExchange } from '../../../shared/types/exchange-adapter.ts';

import { KucoinCsvImporter } from './importer-csv.js';
import { KucoinProcessor } from './processor-csv.js';

export function registerKucoinExchange(): void {
  registerExchange({
    exchange: 'kucoin',
    createImporter: () => new KucoinCsvImporter(),
    createProcessor: () => new KucoinProcessor(),
  });
}
