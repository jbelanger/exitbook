import type { NewLinkableMovement } from '@exitbook/accounting';
import { describe, expect, it } from 'vitest';

import { assignInMemoryIds, emptyLinkingResult } from '../link-operation-utils.js';

describe('link-operation-utils', () => {
  it('assigns deterministic in-memory IDs starting at 1', () => {
    // Minimal shape — only the fields relevant to ID assignment
    const movements = [
      { transactionId: 10, direction: 'outflow' as const },
      { transactionId: 11, direction: 'inflow' as const },
    ] as unknown as NewLinkableMovement[];

    const withIds = assignInMemoryIds(movements);

    expect(withIds[0]?.id).toBe(1);
    expect(withIds[1]?.id).toBe(2);
    expect(withIds[0]?.transactionId).toBe(10);
    expect(withIds[1]?.transactionId).toBe(11);
  });

  it('returns zeroed linking result for empty transaction set', () => {
    const result = emptyLinkingResult(true);

    expect(result).toEqual({
      internalLinksCount: 0,
      confirmedLinksCount: 0,
      suggestedLinksCount: 0,
      totalSourceTransactions: 0,
      totalTargetTransactions: 0,
      unmatchedSourceCount: 0,
      unmatchedTargetCount: 0,
      dryRun: true,
    });
  });
});
