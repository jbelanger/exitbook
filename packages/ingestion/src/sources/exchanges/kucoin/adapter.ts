import { registerExchange } from '../../../core/types/exchange-adapter.ts';

import { KucoinCsvImporter } from './importer-csv.js';
import { KucoinProcessor } from './processor-csv.js';

registerExchange({
  exchange: 'kucoin',
  createImporter: () => new KucoinCsvImporter(),
  createProcessor: () => new KucoinProcessor(),
});
