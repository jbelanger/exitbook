import type { LinkOverridePayload, OverrideEvent } from '@exitbook/core';
import { describe, expect, it } from 'vitest';

import { applyLinkOverrides } from './override-replay.js';

const sourceAssetId = 'exchange:kraken:btc';
const targetAssetId = 'blockchain:bitcoin:native';
const sourceFingerprint = 'tx:v2:kraken:1:WITHDRAWAL-123';
const targetFingerprint = 'tx:v2:blockchain:bitcoin:2:abc123';
const unknownTargetFingerprint = 'tx:v2:blockchain:bitcoin:2:unknown';
const sourceMovementFingerprint = 'movement:tx:v2:kraken:1:WITHDRAWAL-123:outflow:0';
const targetMovementFingerprint = 'movement:tx:v2:blockchain:bitcoin:2:abc123:inflow:0';
const resolvedLinkFingerprint = [
  'resolved-link:v1',
  sourceMovementFingerprint,
  targetMovementFingerprint,
  sourceAssetId,
  targetAssetId,
].join(':');

function createLinkOverridePayload(targetTxFingerprint = targetFingerprint): LinkOverridePayload {
  return {
    type: 'link_override',
    action: 'confirm',
    link_type: 'transfer',
    source_fingerprint: sourceFingerprint,
    target_fingerprint: targetTxFingerprint,
    asset: 'BTC',
    resolved_link_fingerprint: resolvedLinkFingerprint,
    source_asset_id: sourceAssetId,
    target_asset_id: targetAssetId,
    source_movement_fingerprint: sourceMovementFingerprint,
    target_movement_fingerprint: targetMovementFingerprint,
    source_amount: '1',
    target_amount: '0.999',
  };
}

describe('applyLinkOverrides', () => {
  it('should confirm suggested link', () => {
    const transactions = [
      { id: 1, txFingerprint: sourceFingerprint },
      { id: 2, txFingerprint: targetFingerprint },
    ];

    const links = [
      {
        id: 'link-1',
        sourceTransactionId: 1,
        targetTransactionId: 2,
        assetSymbol: 'BTC',
        sourceAssetId,
        targetAssetId,
        sourceMovementFingerprint,
        targetMovementFingerprint,
        status: 'suggested' as const,
      },
    ];

    const payload = createLinkOverridePayload();

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
      { id: 1, txFingerprint: sourceFingerprint },
      { id: 2, txFingerprint: targetFingerprint },
    ];

    const links = [
      {
        id: 'link-1',
        sourceTransactionId: 1,
        targetTransactionId: 2,
        assetSymbol: 'BTC',
        sourceAssetId,
        targetAssetId,
        sourceMovementFingerprint,
        targetMovementFingerprint,
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
          resolved_link_fingerprint: resolvedLinkFingerprint,
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
      { id: 1, txFingerprint: sourceFingerprint },
      { id: 2, txFingerprint: targetFingerprint },
    ];

    // Empty links — algorithm didn't produce a match for this pair
    const links: {
      assetSymbol: string;
      id: string;
      sourceTransactionId: number;
      status: 'suggested';
      targetTransactionId: number;
    }[] = [];

    const payload = createLinkOverridePayload();

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
    const transactions = [{ id: 1, txFingerprint: sourceFingerprint }];

    const links = [
      {
        id: 'link-1',
        sourceTransactionId: 1,
        targetTransactionId: 2,
        assetSymbol: 'BTC',
        sourceAssetId,
        targetAssetId,
        sourceMovementFingerprint,
        targetMovementFingerprint,
        status: 'suggested' as const,
      },
    ];

    const payload = createLinkOverridePayload(unknownTargetFingerprint);

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
      { id: 1, txFingerprint: sourceFingerprint },
      { id: 2, txFingerprint: targetFingerprint },
    ];

    const links = [
      {
        id: 'link-1',
        sourceTransactionId: 1,
        targetTransactionId: 2,
        assetSymbol: 'BTC',
        sourceAssetId,
        targetAssetId,
        sourceMovementFingerprint,
        targetMovementFingerprint,
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

  it('should not create orphaned link when later unlinked (THE BUG)', () => {
    const transactions = [
      { id: 1, txFingerprint: sourceFingerprint },
      { id: 2, txFingerprint: targetFingerprint },
    ];

    const links: {
      assetSymbol: string;
      id: string;
      sourceTransactionId: number;
      status: 'suggested';
      targetTransactionId: number;
    }[] = []; // Algorithm didn't produce this link

    const overrides: OverrideEvent[] = [
      {
        id: 'override-1',
        created_at: '2024-01-15T10:00:00Z',
        actor: 'user',
        source: 'cli',
        scope: 'link',
        payload: createLinkOverridePayload(),
      },
      {
        id: 'override-2',
        created_at: '2024-01-15T11:00:00Z', // Later
        actor: 'user',
        source: 'cli',
        scope: 'unlink',
        payload: {
          type: 'unlink_override',
          resolved_link_fingerprint: resolvedLinkFingerprint,
        },
      },
    ];

    const result = applyLinkOverrides(links, overrides, transactions);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const { links: modifiedLinks, orphaned, unresolved } = result.value;
      expect(modifiedLinks).toHaveLength(0);
      expect(orphaned).toHaveLength(0); // Should NOT create orphaned link
      expect(unresolved).toHaveLength(0);
    }
  });

  it('should handle multiple state changes with last event winning', () => {
    const transactions = [
      { id: 1, txFingerprint: sourceFingerprint },
      { id: 2, txFingerprint: targetFingerprint },
    ];

    const links = [
      {
        id: 'link-1',
        sourceTransactionId: 1,
        targetTransactionId: 2,
        assetSymbol: 'BTC',
        sourceAssetId,
        targetAssetId,
        sourceMovementFingerprint,
        targetMovementFingerprint,
        status: 'suggested' as const,
      },
    ];

    const overrides: OverrideEvent[] = [
      {
        id: 'override-1',
        created_at: '2024-01-15T10:00:00Z',
        actor: 'user',
        source: 'cli',
        scope: 'link',
        payload: createLinkOverridePayload(),
      },
      {
        id: 'override-2',
        created_at: '2024-01-15T11:00:00Z',
        actor: 'user',
        source: 'cli',
        scope: 'unlink',
        payload: {
          type: 'unlink_override',
          resolved_link_fingerprint: resolvedLinkFingerprint,
        },
      },
      {
        id: 'override-3',
        created_at: '2024-01-15T12:00:00Z',
        actor: 'user',
        source: 'cli',
        scope: 'link',
        payload: createLinkOverridePayload(),
      },
    ];

    const result = applyLinkOverrides(links, overrides, transactions);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const { links: modifiedLinks, orphaned, unresolved } = result.value;
      expect(modifiedLinks).toHaveLength(1);
      expect(modifiedLinks[0]?.status).toBe('confirmed'); // Last event wins
      expect(modifiedLinks[0]?.reviewedBy).toBe('user');
      expect(orphaned).toHaveLength(0);
      expect(unresolved).toHaveLength(0);
    }
  });

  it('should apply final confirm state after reject', () => {
    const transactions = [
      { id: 1, txFingerprint: sourceFingerprint },
      { id: 2, txFingerprint: targetFingerprint },
    ];

    const links = [
      {
        id: 'link-1',
        sourceTransactionId: 1,
        targetTransactionId: 2,
        assetSymbol: 'BTC',
        sourceAssetId,
        targetAssetId,
        sourceMovementFingerprint,
        targetMovementFingerprint,
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
          resolved_link_fingerprint: resolvedLinkFingerprint,
        },
      },
      {
        id: 'override-2',
        created_at: '2024-01-15T11:00:00Z',
        actor: 'user',
        source: 'cli',
        scope: 'link',
        payload: createLinkOverridePayload(),
      },
    ];

    const result = applyLinkOverrides(links, overrides, transactions);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const { links: modifiedLinks } = result.value;
      expect(modifiedLinks[0]?.status).toBe('confirmed');
    }
  });
});
