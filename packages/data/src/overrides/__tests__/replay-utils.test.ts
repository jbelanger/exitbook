import { describe, expect, it } from 'vitest';

import type { LinkOverridePayload, OverrideEvent } from '../override.schemas.js';
import { applyLinkOverrides, buildFingerprintMap, resolveTxId } from '../replay-utils.js';

describe('buildFingerprintMap', () => {
  it('should build fingerprint to ID map', () => {
    const transactions = [
      { id: 1, source: 'kraken', externalId: 'TRADE-123' },
      { id: 2, source: 'blockchain:bitcoin', externalId: 'abc123' },
      { id: 3, source: 'coinbase', externalId: 'DEPOSIT-456' },
    ];

    const map = buildFingerprintMap(transactions);

    expect(map.get('kraken:TRADE-123')).toBe(1);
    expect(map.get('blockchain:bitcoin:abc123')).toBe(2);
    expect(map.get('coinbase:DEPOSIT-456')).toBe(3);
  });

  it('should handle empty transaction array', () => {
    const map = buildFingerprintMap([]);

    expect(map.size).toBe(0);
  });
});

describe('resolveTxId', () => {
  it('should resolve transaction ID from fingerprint', () => {
    const map = new Map<string, number>([
      ['kraken:TRADE-123', 1],
      ['blockchain:bitcoin:abc123', 2],
    ]);

    expect(resolveTxId('kraken:TRADE-123', map)).toBe(1);
    expect(resolveTxId('blockchain:bitcoin:abc123', map)).toBe(2);
  });

  it('should return null for unknown fingerprint', () => {
    const map = new Map<string, number>([['kraken:TRADE-123', 1]]);

    expect(resolveTxId('unknown:fingerprint', map)).toBeNull();
  });
});

describe('applyLinkOverrides', () => {
  it('should confirm suggested link', () => {
    const transactions = [
      { id: 1, source: 'kraken', externalId: 'WITHDRAWAL-123' },
      { id: 2, source: 'blockchain:bitcoin', externalId: 'abc123' },
    ];

    const links = [
      {
        id: 'link-1',
        sourceTransactionId: 1,
        targetTransactionId: 2,
        assetSymbol: 'BTC',
        status: 'suggested' as const,
      },
    ];

    const payload: LinkOverridePayload = {
      type: 'link_override',
      action: 'confirm',
      link_type: 'transfer',
      source_fingerprint: 'kraken:WITHDRAWAL-123',
      target_fingerprint: 'blockchain:bitcoin:abc123',
      asset: 'BTC',
    };

    const overrides: OverrideEvent[] = [
      {
        id: 'override-1',
        created_at: '2024-01-15T10:00:00Z',
        actor: 'user',
        source: 'cli',
        scope: 'link',
        payload,
      },
    ];

    const result = applyLinkOverrides(links, overrides, transactions);

    expect(result.isOk()).toBe(true);

    if (result.isOk()) {
      const { links: modifiedLinks, orphaned, unresolved } = result.value;
      expect(modifiedLinks).toHaveLength(1);
      expect(modifiedLinks[0]?.status).toBe('confirmed');
      expect(modifiedLinks[0]?.reviewedBy).toBe('user');
      expect(modifiedLinks[0]?.reviewedAt).toBeInstanceOf(Date);
      expect(orphaned).toHaveLength(0);
      expect(unresolved).toHaveLength(0);
    }
  });

  it('should mark link as rejected for unlink override', () => {
    const transactions = [
      { id: 1, source: 'kraken', externalId: 'WITHDRAWAL-123' },
      { id: 2, source: 'blockchain:bitcoin', externalId: 'abc123' },
    ];

    const links = [
      {
        id: 'link-1',
        sourceTransactionId: 1,
        targetTransactionId: 2,
        assetSymbol: 'BTC',
        status: 'suggested' as const,
      },
    ];

    const overrides: OverrideEvent[] = [
      {
        id: 'override-1',
        created_at: '2024-01-15T10:00:00Z',
        actor: 'user',
        source: 'cli',
        scope: 'unlink',
        payload: {
          type: 'unlink_override',
          link_fingerprint: 'link:blockchain:bitcoin:abc123:kraken:WITHDRAWAL-123:BTC',
        },
      },
    ];

    const result = applyLinkOverrides(links, overrides, transactions);

    expect(result.isOk()).toBe(true);

    if (result.isOk()) {
      const { links: modifiedLinks, orphaned, unresolved } = result.value;
      expect(modifiedLinks).toHaveLength(1);
      expect(modifiedLinks[0]?.status).toBe('rejected');
      expect(modifiedLinks[0]?.reviewedBy).toBe('user');
      expect(orphaned).toHaveLength(0);
      expect(unresolved).toHaveLength(0);
    }
  });

  it('should return orphaned override when transactions exist but algorithm produced no link', () => {
    const transactions = [
      { id: 1, source: 'kraken', externalId: 'WITHDRAWAL-123' },
      { id: 2, source: 'blockchain:bitcoin', externalId: 'abc123' },
    ];

    // Empty links — algorithm didn't produce a match for this pair
    const links: {
      assetSymbol: string;
      id: string;
      sourceTransactionId: number;
      status: 'suggested';
      targetTransactionId: number;
    }[] = [];

    const payload: LinkOverridePayload = {
      type: 'link_override',
      action: 'confirm',
      link_type: 'transfer',
      source_fingerprint: 'kraken:WITHDRAWAL-123',
      target_fingerprint: 'blockchain:bitcoin:abc123',
      asset: 'BTC',
    };

    const overrides: OverrideEvent[] = [
      {
        id: 'override-1',
        created_at: '2024-01-15T10:00:00Z',
        actor: 'user',
        source: 'cli',
        scope: 'link',
        payload,
      },
    ];

    const result = applyLinkOverrides(links, overrides, transactions);

    expect(result.isOk()).toBe(true);

    if (result.isOk()) {
      const { links: modifiedLinks, orphaned, unresolved } = result.value;
      expect(modifiedLinks).toHaveLength(0);
      expect(unresolved).toHaveLength(0);

      // Override should be orphaned — both txs exist but no link to promote
      expect(orphaned).toHaveLength(1);
      expect(orphaned[0]?.sourceTransactionId).toBe(1);
      expect(orphaned[0]?.targetTransactionId).toBe(2);
      expect(orphaned[0]?.assetSymbol).toBe('BTC');
      expect(orphaned[0]?.linkType).toBe('transfer');
      expect(orphaned[0]?.override.id).toBe('override-1');
    }
  });

  it('should handle unresolved link override when transaction not found', () => {
    const transactions = [{ id: 1, source: 'kraken', externalId: 'WITHDRAWAL-123' }];

    const links = [
      {
        id: 'link-1',
        sourceTransactionId: 1,
        targetTransactionId: 2,
        assetSymbol: 'BTC',
        status: 'suggested' as const,
      },
    ];

    const payload: LinkOverridePayload = {
      type: 'link_override',
      action: 'confirm',
      link_type: 'transfer',
      source_fingerprint: 'kraken:WITHDRAWAL-123',
      target_fingerprint: 'blockchain:bitcoin:unknown',
      asset: 'BTC',
    };

    const overrides: OverrideEvent[] = [
      {
        id: 'override-1',
        created_at: '2024-01-15T10:00:00Z',
        actor: 'user',
        source: 'cli',
        scope: 'link',
        payload,
      },
    ];

    const result = applyLinkOverrides(links, overrides, transactions);

    expect(result.isOk()).toBe(true);

    if (result.isOk()) {
      const { links: modifiedLinks, orphaned, unresolved } = result.value;
      expect(modifiedLinks).toHaveLength(1);
      expect(modifiedLinks[0]?.status).toBe('suggested');
      expect(orphaned).toHaveLength(0);
      expect(unresolved).toHaveLength(1);
      expect(unresolved[0]?.id).toBe('override-1');
    }
  });

  it('should handle empty overrides array', () => {
    const transactions = [
      { id: 1, source: 'kraken', externalId: 'WITHDRAWAL-123' },
      { id: 2, source: 'blockchain:bitcoin', externalId: 'abc123' },
    ];

    const links = [
      {
        id: 'link-1',
        sourceTransactionId: 1,
        targetTransactionId: 2,
        assetSymbol: 'BTC',
        status: 'suggested' as const,
      },
    ];

    const result = applyLinkOverrides(links, [], transactions);

    expect(result.isOk()).toBe(true);

    if (result.isOk()) {
      const { links: modifiedLinks, orphaned, unresolved } = result.value;
      expect(modifiedLinks).toHaveLength(1);
      expect(modifiedLinks[0]?.status).toBe('suggested');
      expect(orphaned).toHaveLength(0);
      expect(unresolved).toHaveLength(0);
    }
  });
});
