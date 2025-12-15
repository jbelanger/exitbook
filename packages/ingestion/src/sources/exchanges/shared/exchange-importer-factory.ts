import { err, ok, type Result } from 'neverthrow';

import type { IImporter } from '../../../core/types/importers.ts';

export async function createExchangeImporter(exchange: string): Promise<Result<IImporter, Error>> {
  const exchangeLower = exchange.toLowerCase();

  switch (exchangeLower) {
    case 'kraken': {
      const { KrakenApiImporter } = await import('../kraken/importer.js');
      return ok(new KrakenApiImporter());
    }

    case 'kucoin': {
      const { KucoinCsvImporter } = await import('../kucoin/importer-csv.js');
      return ok(new KucoinCsvImporter());
    }

    case 'coinbase': {
      const { CoinbaseApiImporter } = await import('../coinbase/importer.js');
      return ok(new CoinbaseApiImporter());
    }

    default:
      return err(new Error(`Unsupported exchange: ${exchange}`));
  }
}
