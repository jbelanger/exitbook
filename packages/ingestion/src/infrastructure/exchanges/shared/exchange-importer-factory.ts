import { err, ok, type Result } from 'neverthrow';

import type { IImporter, ImportParams } from '../../../types/importers.ts';

export async function createExchangeImporter(
  exchange: string,
  params?: ImportParams
): Promise<Result<IImporter, Error>> {
  const exchangeLower = exchange.toLowerCase();

  switch (exchangeLower) {
    case 'kraken': {
      const { KrakenApiImporter } = await import('../kraken/importer.ts');
      return ok(new KrakenApiImporter());
    }

    case 'kucoin': {
      // If CSV directories are provided, use CSV importer
      if (params?.csvDirectories && Array.isArray(params.csvDirectories) && params.csvDirectories.length > 0) {
        const { KucoinCsvImporter } = await import('../kucoin/importer-csv.ts');
        return ok(new KucoinCsvImporter());
      }

      // Otherwise, use API importer
      const { KuCoinApiImporter } = await import('../kucoin/importer.ts');
      return ok(new KuCoinApiImporter());
    }

    case 'coinbase': {
      const { CoinbaseApiImporter } = await import('../coinbase/importer.ts');
      return ok(new CoinbaseApiImporter());
    }

    default:
      return err(new Error(`Unsupported exchange: ${exchange}`));
  }
}
