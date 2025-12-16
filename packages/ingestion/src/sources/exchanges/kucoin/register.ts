import { registerExchange } from '../../../shared/types/exchange-adapter.js';

import { KucoinCsvImporter } from './importer-csv.js';
import { KucoinProcessor } from './processor-csv.js';

export function registerKucoinExchange(): void {
  registerExchange({
    exchange: 'kucoin',
    createImporter: () => new KucoinCsvImporter(),
    createProcessor: () => new KucoinProcessor(),
  });
}
