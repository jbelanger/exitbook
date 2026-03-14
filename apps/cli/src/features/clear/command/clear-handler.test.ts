import { ok } from '@exitbook/core';
import type { DataContext } from '@exitbook/data';
import { describe, expect, it, vi } from 'vitest';

import { calculateTotalDeletionItems, createClearHandler, flattenPreview } from './clear-handler.js';

describe('clear-handler', () => {
  it('includes cost-basis snapshot impact in preview and flattened totals', async () => {
    const db = {
      transactionLinks: { count: vi.fn().mockResolvedValue(ok(2)) },
      transactions: { count: vi.fn().mockResolvedValue(ok(5)) },
      costBasisSnapshots: {
        count: vi.fn().mockResolvedValue(ok(3)),
      },
      users: { findOrCreateDefault: vi.fn() },
      accounts: { findAll: vi.fn() },
      executeInTransaction: vi.fn(),
    } as unknown as DataContext;

    const handler = createClearHandler({ db });

    const previewResult = await handler.preview({ includeRaw: false });

    expect(previewResult.isOk()).toBe(true);
    if (previewResult.isErr()) {
      throw previewResult.error;
    }

    expect(previewResult.value.costBasisSnapshots.snapshots).toBe(3);

    const flat = flattenPreview(previewResult.value);
    expect(flat.transactions).toBe(5);
    expect(flat.links).toBe(2);
    expect(flat.costBasisSnapshots).toBe(3);
    expect(calculateTotalDeletionItems(flat)).toBe(flat.transactions + flat.links + flat.costBasisSnapshots);
  });
});
