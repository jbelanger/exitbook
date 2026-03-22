import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { type Currency, ok, parseDecimal } from '@exitbook/foundation';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createPricesDatabase, initializePricesDatabase } from '../../price-cache/persistence/database.js';
import { createPriceQueries } from '../../price-cache/persistence/queries.js';

const { mockCreatePriceProviderManager } = vi.hoisted(() => ({
  mockCreatePriceProviderManager: vi.fn(),
}));

vi.mock('../registry/manager-bootstrap.js', () => ({
  createPriceProviderManager: mockCreatePriceProviderManager,
}));

import { createPriceProviderRuntime } from '../create-price-provider-runtime.js';

describe('createPriceProviderRuntime', () => {
  let tempDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'price-provider-runtime-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { force: true, recursive: true });
  });

  it('saves manual prices without initializing the provider manager', async () => {
    const runtimeResult = await createPriceProviderRuntime({ dataDir: tempDir });
    expect(runtimeResult.isOk()).toBe(true);
    if (runtimeResult.isErr()) {
      return;
    }

    const runtime = runtimeResult.value;

    try {
      const saveResult = await runtime.setManualPrice({
        assetSymbol: 'BTC' as Currency,
        date: new Date('2024-01-15T10:30:00.000Z'),
        price: parseDecimal('45000'),
        source: 'manual-test',
      });

      expect(saveResult.isOk()).toBe(true);
      expect(mockCreatePriceProviderManager).not.toHaveBeenCalled();

      const dbResult = createPricesDatabase(path.join(tempDir, 'prices.db'));
      expect(dbResult.isOk()).toBe(true);
      if (dbResult.isErr()) {
        return;
      }

      const db = dbResult.value;
      try {
        const initResult = await initializePricesDatabase(db);
        expect(initResult.isOk()).toBe(true);

        const queries = createPriceQueries(db);
        const priceResult = await queries.getPrice(
          'BTC' as Currency,
          'USD' as Currency,
          new Date('2024-01-15T10:30:00.000Z')
        );

        expect(priceResult.isOk()).toBe(true);
        if (priceResult.isOk()) {
          expect(priceResult.value?.price.toFixed()).toBe('45000');
          expect(priceResult.value?.source).toBe('manual-test');
        }
      } finally {
        await db.destroy();
      }
    } finally {
      const cleanupResult = await runtime.cleanup();
      expect(cleanupResult.isOk()).toBe(true);
    }
  });

  it('lazily initializes the provider manager once for fetches', async () => {
    const manager = {
      destroy: vi.fn().mockResolvedValue(undefined),
      fetchPrice: vi.fn().mockResolvedValue(
        ok({
          data: {
            assetSymbol: 'BTC' as Currency,
            currency: 'USD' as Currency,
            fetchedAt: new Date('2024-01-15T10:31:00.000Z'),
            granularity: 'exact' as const,
            price: parseDecimal('45000'),
            source: 'mock-provider',
            timestamp: new Date('2024-01-15T10:30:00.000Z'),
          },
          providerName: 'mock-provider',
        })
      ),
    };
    mockCreatePriceProviderManager.mockResolvedValue(ok(manager));

    const runtimeResult = await createPriceProviderRuntime({ dataDir: tempDir });
    expect(runtimeResult.isOk()).toBe(true);
    if (runtimeResult.isErr()) {
      return;
    }

    const runtime = runtimeResult.value;

    try {
      const [firstFetch, secondFetch] = await Promise.all([
        runtime.fetchPrice({
          assetSymbol: 'BTC' as Currency,
          currency: 'USD' as Currency,
          timestamp: new Date('2024-01-15T10:30:00.000Z'),
        }),
        runtime.fetchPrice({
          assetSymbol: 'BTC' as Currency,
          currency: 'USD' as Currency,
          timestamp: new Date('2024-01-15T10:30:00.000Z'),
        }),
      ]);

      expect(firstFetch.isOk()).toBe(true);
      expect(secondFetch.isOk()).toBe(true);
      expect(mockCreatePriceProviderManager).toHaveBeenCalledTimes(1);
      expect(manager.fetchPrice).toHaveBeenCalledTimes(2);
    } finally {
      const cleanupResult = await runtime.cleanup();
      expect(cleanupResult.isOk()).toBe(true);
    }

    expect(manager.destroy).toHaveBeenCalledTimes(1);
  });
});
