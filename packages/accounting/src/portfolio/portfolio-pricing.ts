import { type Currency } from '@exitbook/foundation';
import { getLogger } from '@exitbook/logger';
import type { IPriceProviderRuntime, PriceQuery } from '@exitbook/price-providers';
import { Decimal } from 'decimal.js';

import type { SpotPriceResult } from './portfolio-types.js';

const logger = getLogger('portfolio-pricing');

/**
 * Fetch spot prices for multiple assets using Promise.allSettled.
 * Returns a map of assetId -> SpotPriceResult (price or error).
 */
export async function fetchSpotPrices(
  assetSymbols: Map<string, Currency>,
  priceRuntime: IPriceProviderRuntime,
  asOf: Date
): Promise<Map<string, SpotPriceResult>> {
  const results = new Map<string, SpotPriceResult>();
  const usdCurrency = 'USD' as Currency;
  const queries: { assetId: string; query: PriceQuery }[] = [];

  for (const [assetId, assetSymbol] of assetSymbols.entries()) {
    queries.push({
      assetId,
      query: {
        assetSymbol,
        timestamp: asOf,
        currency: usdCurrency,
      },
    });
  }

  const settled = await Promise.allSettled(queries.map(({ query }) => priceRuntime.fetchPrice(query)));

  for (let i = 0; i < settled.length; i++) {
    const { assetId } = queries[i]!;
    const result = settled[i]!;

    if (result.status === 'fulfilled') {
      if (result.value.isOk()) {
        results.set(assetId, { price: result.value.value.price });
      } else {
        const error = result.value.error.message;
        logger.warn({ assetId, error }, 'Failed to fetch spot price');
        results.set(assetId, { error });
      }
      continue;
    }

    const error = result.reason instanceof Error ? result.reason.message : String(result.reason);
    logger.warn({ assetId, error }, 'Price fetch promise rejected');
    results.set(assetId, { error });
  }

  return results;
}

export function convertSpotPricesToDisplayCurrency(
  spotPrices: Map<string, SpotPriceResult>,
  fxRate: Decimal | undefined
): Map<string, SpotPriceResult> {
  if (!fxRate) {
    return new Map(spotPrices);
  }

  return new Map(
    [...spotPrices.entries()].map(([assetId, result]) => [
      assetId,
      'price' in result ? { price: result.price.times(fxRate) } : result,
    ])
  );
}
