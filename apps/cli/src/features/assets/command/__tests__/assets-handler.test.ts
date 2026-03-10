import type { Currency, UniversalTransactionData } from '@exitbook/core';
import { err, ok, parseDecimal } from '@exitbook/core';
import { assertErr, assertOk } from '@exitbook/core/test-utils';
import type { DataContext, OverrideStore } from '@exitbook/data';
import { describe, expect, it, vi } from 'vitest';

import { AssetsHandler } from '../assets-handler.js';

function createTransaction(params: {
  externalId?: string | undefined;
  fees?: { amount: string; assetId: string; assetSymbol: string }[] | undefined;
  id: number;
  inflows?: { amount: string; assetId: string; assetSymbol: string }[] | undefined;
  outflows?: { amount: string; assetId: string; assetSymbol: string }[] | undefined;
}): UniversalTransactionData {
  const inflows = params.inflows ?? [];
  const outflows = params.outflows ?? [];
  const fees = params.fees ?? [];

  return {
    id: params.id,
    accountId: 1,
    externalId: params.externalId ?? `tx-${params.id}`,
    datetime: '2024-01-01T00:00:00.000Z',
    timestamp: Date.parse('2024-01-01T00:00:00.000Z'),
    source: 'kraken',
    sourceType: 'exchange',
    status: 'success',
    movements: {
      inflows: inflows.map((movement) => ({
        assetId: movement.assetId,
        assetSymbol: movement.assetSymbol as Currency,
        grossAmount: parseDecimal(movement.amount),
      })),
      outflows: outflows.map((movement) => ({
        assetId: movement.assetId,
        assetSymbol: movement.assetSymbol as Currency,
        grossAmount: parseDecimal(movement.amount),
      })),
    },
    fees: fees.map((fee) => ({
      assetId: fee.assetId,
      assetSymbol: fee.assetSymbol as Currency,
      amount: parseDecimal(fee.amount),
      scope: 'platform',
      settlement: 'balance',
    })),
    operation: {
      category: 'trade',
      type: 'swap',
    },
  };
}

function createMockOverrideStore() {
  return {
    append: vi.fn(),
    exists: vi.fn(),
    readByScopes: vi.fn(),
  };
}

function createMockDb(transactions: UniversalTransactionData[]) {
  return {
    transactions: {
      findAll: vi.fn().mockResolvedValue(ok(transactions)),
    },
  };
}

describe('AssetsHandler', () => {
  it('writes an asset-exclude event after resolving a unique symbol', async () => {
    const mockDb = createMockDb([
      createTransaction({
        id: 1,
        inflows: [{ assetId: 'blockchain:ethereum:0xscam', assetSymbol: 'SCAM', amount: '100' }],
      }),
    ]);
    const mockOverrideStore = createMockOverrideStore();
    mockOverrideStore.exists.mockReturnValue(false);
    mockOverrideStore.append.mockResolvedValue(ok(undefined));

    const handler = new AssetsHandler(
      mockDb as unknown as Pick<DataContext, 'transactions'>,
      mockOverrideStore as unknown as Pick<OverrideStore, 'append' | 'exists' | 'readByScopes'>
    );

    const result = await handler.exclude({ symbol: 'scam', reason: 'junk airdrop' });

    const value = assertOk(result);
    expect(value).toMatchObject({
      action: 'exclude',
      assetId: 'blockchain:ethereum:0xscam',
      assetSymbols: ['SCAM'],
      changed: true,
      reason: 'junk airdrop',
    });
    expect(mockDb.transactions.findAll).toHaveBeenCalledWith({ includeExcluded: true });
    expect(mockOverrideStore.append).toHaveBeenCalledWith({
      scope: 'asset-exclude',
      payload: {
        type: 'asset_exclude',
        asset_id: 'blockchain:ethereum:0xscam',
      },
      reason: 'junk airdrop',
    });
  });

  it('returns an error when symbol resolution is ambiguous', async () => {
    const mockDb = createMockDb([
      createTransaction({
        id: 1,
        inflows: [{ assetId: 'exchange:kraken:usdc', assetSymbol: 'USDC', amount: '10' }],
      }),
      createTransaction({
        id: 2,
        inflows: [{ assetId: 'blockchain:ethereum:0xa0b8', assetSymbol: 'USDC', amount: '12' }],
      }),
    ]);
    const mockOverrideStore = createMockOverrideStore();
    mockOverrideStore.exists.mockReturnValue(false);

    const handler = new AssetsHandler(
      mockDb as unknown as Pick<DataContext, 'transactions'>,
      mockOverrideStore as unknown as Pick<OverrideStore, 'append' | 'exists' | 'readByScopes'>
    );

    const result = await handler.exclude({ symbol: 'USDC' });

    const error = assertErr(result);
    expect(error.message).toContain("Symbol 'USDC' is ambiguous");
    expect(error.message).toContain('exchange:kraken:usdc');
    expect(error.message).toContain('blockchain:ethereum:0xa0b8');
    expect(mockOverrideStore.append).not.toHaveBeenCalled();
  });

  it('returns unchanged for include when the asset is not currently excluded', async () => {
    const mockDb = createMockDb([
      createTransaction({
        id: 1,
        inflows: [{ assetId: 'blockchain:ethereum:0xscam', assetSymbol: 'SCAM', amount: '100' }],
      }),
    ]);
    const mockOverrideStore = createMockOverrideStore();
    mockOverrideStore.exists.mockReturnValue(false);

    const handler = new AssetsHandler(
      mockDb as unknown as Pick<DataContext, 'transactions'>,
      mockOverrideStore as unknown as Pick<OverrideStore, 'append' | 'exists' | 'readByScopes'>
    );

    const result = await handler.include({ assetId: 'blockchain:ethereum:0xscam' });

    const value = assertOk(result);
    expect(value.changed).toBe(false);
    expect(value.action).toBe('include');
    expect(mockOverrideStore.append).not.toHaveBeenCalled();
  });

  it('lists current exclusions with transaction and movement counts', async () => {
    const mockDb = createMockDb([
      createTransaction({
        id: 1,
        inflows: [{ assetId: 'blockchain:ethereum:0xscam', assetSymbol: 'SCAM', amount: '100' }],
        fees: [{ assetId: 'blockchain:ethereum:0xscam', assetSymbol: 'SCAM', amount: '1' }],
      }),
      createTransaction({
        id: 2,
        outflows: [{ assetId: 'blockchain:ethereum:0xscam', assetSymbol: 'SCAM', amount: '40' }],
      }),
      createTransaction({
        id: 3,
        inflows: [{ assetId: 'exchange:kraken:dust', assetSymbol: 'DUST', amount: '2' }],
      }),
    ]);
    const mockOverrideStore = createMockOverrideStore();
    mockOverrideStore.exists.mockReturnValue(true);
    mockOverrideStore.readByScopes.mockResolvedValue(
      ok([
        {
          id: 'evt-1',
          created_at: '2026-03-09T10:00:00.000Z',
          actor: 'user',
          source: 'cli',
          scope: 'asset-exclude',
          payload: {
            type: 'asset_exclude',
            asset_id: 'blockchain:ethereum:0xscam',
          },
        },
      ])
    );

    const handler = new AssetsHandler(
      mockDb as unknown as Pick<DataContext, 'transactions'>,
      mockOverrideStore as unknown as Pick<OverrideStore, 'append' | 'exists' | 'readByScopes'>
    );

    const result = await handler.listExclusions();

    const value = assertOk(result);
    expect(value.excludedAssets).toEqual([
      {
        assetId: 'blockchain:ethereum:0xscam',
        assetSymbols: ['SCAM'],
        movementCount: 3,
        transactionCount: 2,
      },
    ]);
  });

  it('returns override replay errors without swallowing them', async () => {
    const mockDb = createMockDb([]);
    const mockOverrideStore = createMockOverrideStore();
    mockOverrideStore.exists.mockReturnValue(true);
    mockOverrideStore.readByScopes.mockResolvedValue(err(new Error('overrides are invalid')));

    const handler = new AssetsHandler(
      mockDb as unknown as Pick<DataContext, 'transactions'>,
      mockOverrideStore as unknown as Pick<OverrideStore, 'append' | 'exists' | 'readByScopes'>
    );

    const result = await handler.listExclusions();

    const error = assertErr(result);
    expect(error.message).toContain('Failed to read asset exclusion override events');
  });
});
