import { ok } from '@exitbook/core';
import { Decimal } from 'decimal.js';
import { describe, expect, it, vi } from 'vitest';

import { PricesSetHandler } from './prices-set-handler.js';

describe('PricesSetHandler', () => {
  it('saves a manual price and appends the override event', async () => {
    const priceWriter = {
      setManualPrice: vi.fn().mockResolvedValue(ok(undefined)),
    };
    const overrideStore = {
      append: vi.fn().mockResolvedValue(ok(undefined)),
    };

    const handler = new PricesSetHandler(priceWriter as never, overrideStore as never);

    const result = await handler.execute({
      asset: 'BTC',
      date: '2024-01-15T10:30:00Z',
      price: '45000',
      currency: 'USD',
      source: 'manual-cli',
    });

    expect(result.isOk()).toBe(true);
    expect(priceWriter.setManualPrice).toHaveBeenCalledWith({
      assetSymbol: 'BTC',
      date: new Date('2024-01-15T10:30:00Z'),
      price: new Decimal('45000'),
      currency: 'USD',
      source: 'manual-cli',
    });
    expect(overrideStore.append).toHaveBeenCalledTimes(1);
  });
});
