import { err, ok, type Result } from 'neverthrow';

import type { ITransactionProcessor } from '../../../types/processors.ts';

export async function createExchangeProcessor(
  exchange: string,
  metadata?: Record<string, unknown>
): Promise<Result<ITransactionProcessor, Error>> {
  const exchangeLower = exchange.toLowerCase();

  switch (exchangeLower) {
    case 'kraken': {
      const { DefaultExchangeProcessor } = await import('./default-exchange-processor.ts');
      return ok(new DefaultExchangeProcessor('kraken'));
    }

    case 'coinbase': {
      const { CoinbaseProcessor } = await import('../coinbase/processor.ts');
      return ok(new CoinbaseProcessor());
    }

    case 'kucoin': {
      const importMethod = metadata?.importMethod as string | undefined;

      if (importMethod === 'csv') {
        const { KucoinProcessor } = await import('../kucoin/processor-csv.ts');
        return ok(new KucoinProcessor());
      }

      const { DefaultExchangeProcessor } = await import('./default-exchange-processor.ts');
      return ok(new DefaultExchangeProcessor('kucoin'));
    }

    default:
      return err(new Error(`Unsupported exchange: ${exchange}`));
  }
}
