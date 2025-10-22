// Shared test utilities for view command tests

import type { AssetMovement, UniversalTransaction } from '@exitbook/core';
import { createMoney, parseDecimal } from '@exitbook/core';

/**
 * Create a mock transaction with default values for testing.
 * All fields can be overridden via the overrides parameter.
 */
export function createMockTransaction(overrides: Partial<UniversalTransaction> = {}): UniversalTransaction {
  const baseDatetime = overrides.datetime ?? '2024-01-01T00:00:00Z';
  const baseTimestamp = overrides.timestamp ?? Math.floor(new Date(baseDatetime).getTime() / 1000);

  return {
    id: 1,
    source: 'kraken',
    externalId: 'ext-123',
    status: 'success',
    datetime: baseDatetime,
    timestamp: baseTimestamp,
    movements: {
      inflows: [{ asset: 'BTC', amount: parseDecimal('1.0') }],
      outflows: [],
    },
    operation: { category: 'trade', type: 'buy' },
    fees: {},
    ...overrides,
  };
}

/**
 * Create a mock movement with default values for testing.
 */
export function createMockMovement(asset: string, amount: string, withPrice = false): AssetMovement {
  const movement: AssetMovement = {
    asset,
    amount: parseDecimal(amount),
  };

  if (withPrice) {
    return {
      ...movement,
      priceAtTxTime: {
        price: createMoney('1000', 'USD'),
        source: 'test',
        fetchedAt: new Date('2024-01-01'),
        granularity: 'exact' as const,
      },
    };
  }

  return movement;
}

/**
 * Add price data to an existing movement.
 * Useful for testing price-related functionality.
 */
export function addPriceToMovement(movement: AssetMovement, price?: string, currency?: string): AssetMovement {
  return {
    ...movement,
    priceAtTxTime: {
      price: createMoney(price ?? '50000', currency ?? 'USD'),
      source: 'test',
      fetchedAt: new Date('2024-01-01'),
      granularity: 'exact' as const,
    },
  };
}
