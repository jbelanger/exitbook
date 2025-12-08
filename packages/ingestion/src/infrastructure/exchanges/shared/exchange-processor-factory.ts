import { err, ok, type Result } from 'neverthrow';

import type { ITransactionProcessor } from '../../../types/processors.js';

export async function createExchangeProcessor(exchange: string): Promise<Result<ITransactionProcessor, Error>> {
  const exchangeLower = exchange.toLowerCase();

  switch (exchangeLower) {
    case 'kraken': {
      const { DefaultExchangeProcessor } = await import('./default-exchange-processor.js');
      return ok(new DefaultExchangeProcessor('kraken'));
    }

    case 'coinbase': {
      const { CoinbaseProcessor } = await import('../coinbase/processor.js');
      return ok(new CoinbaseProcessor());
    }

    case 'kucoin': {
      const { KucoinProcessor } = await import('../kucoin/processor-csv.js');
      return ok(new KucoinProcessor());
    }

    default:
      return err(new Error(`Unsupported exchange: ${exchange}`));
  }
}
