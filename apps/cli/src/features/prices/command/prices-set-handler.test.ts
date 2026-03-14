import { ok } from '@exitbook/core';
import { Decimal } from 'decimal.js';
import { describe, expect, it, vi } from 'vitest';

import { PricesSetHandler } from './prices-set-handler.js';

describe('PricesSetHandler', () => {
  it('bumps the cost-basis price dependency after saving a manual price', async () => {
    const service = {
      savePrice: vi.fn().mockResolvedValue(ok(undefined)),
    };
    const overrideStore = {
      append: vi.fn().mockResolvedValue(ok(undefined)),
    };
    const invalidation = {
      bumpPricesVersion: vi.fn().mockResolvedValue(ok({ version: 1 })),
    };

    const handler = new PricesSetHandler(service as never, overrideStore as never, invalidation);

    const result = await handler.execute({
      asset: 'BTC',
      date: '2024-01-15T10:30:00Z',
      price: '45000',
      currency: 'USD',
      source: 'manual-cli',
    });

    expect(result.isOk()).toBe(true);
    expect(service.savePrice).toHaveBeenCalledWith({
      assetSymbol: 'BTC',
      date: new Date('2024-01-15T10:30:00Z'),
      price: new Decimal('45000'),
      currency: 'USD',
      source: 'manual-cli',
    });
    expect(invalidation.bumpPricesVersion).toHaveBeenCalledTimes(1);
  });
});
