import type { ExchangeLedgerEntry } from '@exitbook/exchanges-providers';
import { describe, expect, test } from 'vitest';

import { byCorrelationId, byTimestamp, noGrouping, type RawTransactionWithMetadata } from '../grouping.js';

function createTestEntry(overrides: Partial<ExchangeLedgerEntry>): ExchangeLedgerEntry {
  return {
    amount: '0',
    asset: 'USD',
    correlationId: 'REF001',
    id: 'ENTRY001',
    timestamp: 1704067200000,
    type: 'test',
    status: 'success',
    ...overrides,
  };
}

function wrapEntry(entry: ExchangeLedgerEntry, externalId?: string): RawTransactionWithMetadata {
  return {
    raw: entry,
    normalized: entry,
    externalId: externalId || entry.id,
    cursor: {},
  };
}

describe('GroupingStrategy - byCorrelationId', () => {
  test('groups entries with same correlationId together', () => {
    const entries = [
      wrapEntry(createTestEntry({ id: 'E1', correlationId: 'REF001' })),
      wrapEntry(createTestEntry({ id: 'E2', correlationId: 'REF001' })),
      wrapEntry(createTestEntry({ id: 'E3', correlationId: 'REF002' })),
    ];

    const groups = byCorrelationId.group(entries);

    expect(groups.size).toBe(2);
    expect(groups.get('REF001')).toHaveLength(2);
    expect(groups.get('REF002')).toHaveLength(1);
  });

  test('creates separate groups for different correlationIds', () => {
    const entries = [
      wrapEntry(createTestEntry({ id: 'E1', correlationId: 'SWAP001' })),
      wrapEntry(createTestEntry({ id: 'E2', correlationId: 'SWAP002' })),
      wrapEntry(createTestEntry({ id: 'E3', correlationId: 'SWAP003' })),
    ];

    const groups = byCorrelationId.group(entries);

    expect(groups.size).toBe(3);
    expect(groups.get('SWAP001')).toHaveLength(1);
    expect(groups.get('SWAP002')).toHaveLength(1);
    expect(groups.get('SWAP003')).toHaveLength(1);
  });

  test('handles entries with same correlationId but different assets (swap)', () => {
    const entries = [
      wrapEntry(createTestEntry({ id: 'E1', correlationId: 'SWAP001', asset: 'USD', amount: '-100' })),
      wrapEntry(createTestEntry({ id: 'E2', correlationId: 'SWAP001', asset: 'BTC', amount: '0.001' })),
    ];

    const groups = byCorrelationId.group(entries);

    expect(groups.size).toBe(1);
    const group = groups.get('SWAP001');
    expect(group).toHaveLength(2);
    expect(group?.[0]?.normalized.asset).toBe('USD');
    expect(group?.[1]?.normalized.asset).toBe('BTC');
  });

  test('skips entries without valid id', () => {
    const validEntry1 = wrapEntry(createTestEntry({ id: 'E1', correlationId: 'REF001' }));
    const invalidEntry = {
      normalized: createTestEntry({ id: '', correlationId: 'REF002' }),
      raw: {},
      externalId: 'E2',
      cursor: {},
    };
    const validEntry2 = wrapEntry(createTestEntry({ id: 'E3', correlationId: 'REF003' }));

    const entries = [validEntry1, invalidEntry, validEntry2] as RawTransactionWithMetadata[];

    const groups = byCorrelationId.group(entries);

    expect(groups.size).toBe(2);
    expect(groups.get('REF001')).toHaveLength(1);
    expect(groups.get('REF003')).toHaveLength(1);
    expect(groups.get('REF002')).toBeUndefined();
  });

  test('handles empty input array', () => {
    const entries: RawTransactionWithMetadata[] = [];

    const groups = byCorrelationId.group(entries);

    expect(groups.size).toBe(0);
  });

  test('preserves order of entries within group', () => {
    const entries = [
      wrapEntry(createTestEntry({ id: 'E1', correlationId: 'REF001', timestamp: 1000 })),
      wrapEntry(createTestEntry({ id: 'E2', correlationId: 'REF001', timestamp: 2000 })),
      wrapEntry(createTestEntry({ id: 'E3', correlationId: 'REF001', timestamp: 3000 })),
    ];

    const groups = byCorrelationId.group(entries);
    const group = groups.get('REF001');

    expect(group?.[0]?.normalized.id).toBe('E1');
    expect(group?.[1]?.normalized.id).toBe('E2');
    expect(group?.[2]?.normalized.id).toBe('E3');
  });
});

describe('GroupingStrategy - byTimestamp', () => {
  test('groups entries with same timestamp together', () => {
    const timestamp1 = 1704067200000;
    const timestamp2 = 1704153600000;

    const entries = [
      wrapEntry(createTestEntry({ id: 'E1', timestamp: timestamp1 })),
      wrapEntry(createTestEntry({ id: 'E2', timestamp: timestamp1 })),
      wrapEntry(createTestEntry({ id: 'E3', timestamp: timestamp2 })),
    ];

    const groups = byTimestamp.group(entries);

    expect(groups.size).toBe(2);
    expect(groups.get(timestamp1.toString())).toHaveLength(2);
    expect(groups.get(timestamp2.toString())).toHaveLength(1);
  });

  test('creates separate groups for different timestamps', () => {
    const entries = [
      wrapEntry(createTestEntry({ id: 'E1', timestamp: 1000 })),
      wrapEntry(createTestEntry({ id: 'E2', timestamp: 2000 })),
      wrapEntry(createTestEntry({ id: 'E3', timestamp: 3000 })),
    ];

    const groups = byTimestamp.group(entries);

    expect(groups.size).toBe(3);
    expect(groups.get('1000')).toHaveLength(1);
    expect(groups.get('2000')).toHaveLength(1);
    expect(groups.get('3000')).toHaveLength(1);
  });

  test('groups swap entries occurring at exact same time', () => {
    const timestamp = 1704067200000;

    const entries = [
      wrapEntry(createTestEntry({ id: 'E1', timestamp, asset: 'USD', amount: '-100' })),
      wrapEntry(createTestEntry({ id: 'E2', timestamp, asset: 'BTC', amount: '0.001' })),
    ];

    const groups = byTimestamp.group(entries);

    expect(groups.size).toBe(1);
    const group = groups.get(timestamp.toString());
    expect(group).toHaveLength(2);
  });

  test('handles empty input array', () => {
    const entries: RawTransactionWithMetadata[] = [];

    const groups = byTimestamp.group(entries);

    expect(groups.size).toBe(0);
  });

  test('preserves order of entries within time group', () => {
    const timestamp = 1704067200000;

    const entries = [
      wrapEntry(createTestEntry({ id: 'E1', timestamp })),
      wrapEntry(createTestEntry({ id: 'E2', timestamp })),
      wrapEntry(createTestEntry({ id: 'E3', timestamp })),
    ];

    const groups = byTimestamp.group(entries);
    const group = groups.get(timestamp.toString());

    expect(group?.[0]?.normalized.id).toBe('E1');
    expect(group?.[1]?.normalized.id).toBe('E2');
    expect(group?.[2]?.normalized.id).toBe('E3');
  });
});

describe('GroupingStrategy - noGrouping', () => {
  test('creates individual groups for each entry', () => {
    const entries = [
      wrapEntry(createTestEntry({ id: 'E1', correlationId: 'REF001' })),
      wrapEntry(createTestEntry({ id: 'E2', correlationId: 'REF001' })),
      wrapEntry(createTestEntry({ id: 'E3', correlationId: 'REF002' })),
    ];

    const groups = noGrouping.group(entries);

    expect(groups.size).toBe(3);
    expect(groups.get('E1')).toHaveLength(1);
    expect(groups.get('E2')).toHaveLength(1);
    expect(groups.get('E3')).toHaveLength(1);
  });

  test('uses entry.normalized.id as group key', () => {
    const entries = [
      wrapEntry(createTestEntry({ id: 'UNIQUE_ID_1' })),
      wrapEntry(createTestEntry({ id: 'UNIQUE_ID_2' })),
    ];

    const groups = noGrouping.group(entries);

    expect(groups.has('UNIQUE_ID_1')).toBe(true);
    expect(groups.has('UNIQUE_ID_2')).toBe(true);
    expect(groups.get('UNIQUE_ID_1')?.[0]?.normalized.id).toBe('UNIQUE_ID_1');
    expect(groups.get('UNIQUE_ID_2')?.[0]?.normalized.id).toBe('UNIQUE_ID_2');
  });

  test('handles empty input array', () => {
    const entries: RawTransactionWithMetadata[] = [];

    const groups = noGrouping.group(entries);

    expect(groups.size).toBe(0);
  });

  test('each group contains exactly one entry', () => {
    const entries = [
      wrapEntry(createTestEntry({ id: 'E1' })),
      wrapEntry(createTestEntry({ id: 'E2' })),
      wrapEntry(createTestEntry({ id: 'E3' })),
    ];

    const groups = noGrouping.group(entries);

    for (const group of groups.values()) {
      expect(group).toHaveLength(1);
    }
  });
});

describe('GroupingStrategy - Comparison', () => {
  test('byCorrelationId groups related entries that noGrouping would separate', () => {
    const entries = [
      wrapEntry(createTestEntry({ id: 'E1', correlationId: 'SWAP001' })),
      wrapEntry(createTestEntry({ id: 'E2', correlationId: 'SWAP001' })),
    ];

    const correlationGroups = byCorrelationId.group(entries);
    const noGroups = noGrouping.group(entries);

    expect(correlationGroups.size).toBe(1);
    expect(noGroups.size).toBe(2);
  });

  test('byTimestamp groups entries at same time that byCorrelationId would separate', () => {
    const timestamp = 1704067200000;

    const entries = [
      wrapEntry(createTestEntry({ id: 'E1', correlationId: 'REF001', timestamp })),
      wrapEntry(createTestEntry({ id: 'E2', correlationId: 'REF002', timestamp })),
    ];

    const timestampGroups = byTimestamp.group(entries);
    const correlationGroups = byCorrelationId.group(entries);

    expect(timestampGroups.size).toBe(1);
    expect(correlationGroups.size).toBe(2);
  });
});
