import type { Currency, Result } from '@exitbook/foundation';
import { err, ok } from '@exitbook/foundation';
import type { AccountingJournalDraft } from '@exitbook/ledger';
import { Decimal } from 'decimal.js';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';

import {
  dedupeLedgerProcessorItemsByKey,
  parseLedgerProcessorItems,
  processGroupedLedgerProcessorItems,
} from '../ledger-processor-v2-utils.js';

const ItemSchema = z.object({
  eventId: z.string(),
  groupId: z.string(),
  id: z.string(),
  quantity: z.string(),
});

type TestItem = z.infer<typeof ItemSchema>;

function buildComparisonMaterial(item: TestItem): string {
  return JSON.stringify(item);
}

function buildJournal(groupKey: string, quantity: Decimal): AccountingJournalDraft {
  return {
    journalKind: 'transfer',
    journalStableKey: 'transfer',
    sourceActivityFingerprint: `source:${groupKey}`,
    postings: [
      {
        assetId: 'blockchain:ethereum:native',
        assetSymbol: 'ETH' as Currency,
        balanceCategory: 'liquid',
        postingStableKey: 'principal:in:eth:1',
        quantity,
        role: 'principal',
        sourceComponentRefs: [
          {
            component: {
              assetId: 'blockchain:ethereum:native',
              componentId: `${groupKey}:event`,
              componentKind: 'account_delta',
              sourceActivityFingerprint: `source:${groupKey}`,
            },
            quantity,
          },
        ],
      },
    ],
  };
}

describe('ledger processor v2 utils', () => {
  test('parses processor items and reports schema paths on invalid input', () => {
    const result = parseLedgerProcessorItems({
      inputLabel: 'test v2',
      normalizedData: [{ eventId: 'event-1', groupId: 'group-1', id: 'tx-1' }],
      schema: ItemSchema,
    });

    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.message).toContain('Input validation failed for test v2 item at index 0');
    expect(result.error.message).toContain('quantity');
  });

  test('dedupes equal items by key and fails on conflicting payloads', () => {
    const item = { eventId: 'event-1', groupId: 'group-1', id: 'tx-1', quantity: '1' };
    const deduped = dedupeLedgerProcessorItemsByKey({
      buildComparisonMaterial,
      conflictItemLabel: 'event',
      conflictLabel: 'test v2',
      getItemKey: (candidate: TestItem) => candidate.eventId,
      items: [item, item],
    });
    expect(deduped.isOk()).toBe(true);
    if (deduped.isErr()) return;
    expect(deduped.value).toEqual([item]);

    const conflict = dedupeLedgerProcessorItemsByKey({
      buildComparisonMaterial,
      conflictItemLabel: 'event',
      conflictLabel: 'test v2',
      getItemKey: (candidate: TestItem) => candidate.eventId,
      items: [item, { ...item, quantity: '2' }],
    });
    expect(conflict.isErr()).toBe(true);
    if (conflict.isOk()) return;
    expect(conflict.error.message).toContain('conflicting normalized payloads for event event-1');
  });

  test('prepares, groups, validates, and skips empty journal drafts', async () => {
    const result = await processGroupedLedgerProcessorItems({
      assemble: (items, groupKey): Result<{ journals: AccountingJournalDraft[] }, Error> => {
        const quantity = items.reduce((total, item) => total.plus(item.quantity), new Decimal(0));
        return ok({
          journals: quantity.isZero() ? [] : [buildJournal(groupKey, quantity)],
        });
      },
      buildComparisonMaterial,
      conflictItemLabel: 'event',
      conflictLabel: 'test v2',
      getDeduplicationKey: (item) => item.eventId,
      groupItems: (items) => {
        const groups = new Map<string, TestItem[]>();
        for (const item of items) {
          groups.set(item.groupId, [...(groups.get(item.groupId) ?? []), item]);
        }
        return groups;
      },
      inputLabel: 'test v2',
      normalizedData: [
        { eventId: 'event-1', groupId: 'group-1', id: 'tx-1', quantity: '1' },
        { eventId: 'event-2', groupId: 'group-1', id: 'tx-1', quantity: '2' },
        { eventId: 'event-zero', groupId: 'group-zero', id: 'tx-zero', quantity: '0' },
      ],
      prepareItems: async (items) => ok(items.map((item) => ({ ...item, quantity: item.quantity }))),
      processorLabel: 'test v2',
      schema: ItemSchema,
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) throw result.error;
    expect(result.value).toHaveLength(1);
    expect(result.value[0]?.journals[0]?.postings[0]?.quantity.toFixed()).toBe('3');
  });

  test('returns prepare errors without assembling drafts', async () => {
    const result = await processGroupedLedgerProcessorItems({
      assemble: () => ok({ journals: [] }),
      buildComparisonMaterial,
      conflictItemLabel: 'event',
      conflictLabel: 'test v2',
      getDeduplicationKey: (item) => item.eventId,
      groupItems: () => new Map(),
      inputLabel: 'test v2',
      normalizedData: [{ eventId: 'event-1', groupId: 'group-1', id: 'tx-1', quantity: '1' }],
      prepareItems: async () => err(new Error('prepare failed')),
      processorLabel: 'test v2',
      schema: ItemSchema,
    });

    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.message).toBe('prepare failed');
  });
});
