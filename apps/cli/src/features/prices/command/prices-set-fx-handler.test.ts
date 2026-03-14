import { ok } from '@exitbook/core';
import { Decimal } from 'decimal.js';
import { describe, expect, it, vi } from 'vitest';

import { PricesSetFxHandler } from './prices-set-fx-handler.js';

const saveFxRate = vi.fn();

vi.mock('@exitbook/price-providers', () => ({
  ManualPriceService: vi.fn().mockImplementation(function () {
    return { saveFxRate };
  }),
}));

describe('PricesSetFxHandler', () => {
  it('saves a manual fx rate and appends the override event', async () => {
    saveFxRate.mockResolvedValue(ok(undefined));

    const overrideStore = {
      append: vi.fn().mockResolvedValue(ok(undefined)),
    };

    const handler = new PricesSetFxHandler('/tmp/prices.db', overrideStore as never);
    const result = await handler.execute({
      from: 'CAD',
      to: 'USD',
      date: '2024-01-15T10:30:00Z',
      rate: '0.75',
      source: 'user-provided',
    });

    expect(result.isOk()).toBe(true);
    expect(saveFxRate).toHaveBeenCalledWith({
      from: 'CAD',
      to: 'USD',
      date: new Date('2024-01-15T10:30:00Z'),
      rate: new Decimal('0.75'),
      source: 'user-provided',
    });
    expect(overrideStore.append).toHaveBeenCalledTimes(1);
  });
});
