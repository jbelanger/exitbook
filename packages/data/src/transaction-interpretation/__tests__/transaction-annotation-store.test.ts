import { assertOk } from '@exitbook/foundation/test-utils';
import {
  type AnnotationFingerprintInput,
  computeAnnotationFingerprint,
  type TransactionAnnotation,
} from '@exitbook/transaction-interpretation';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { KyselyDB } from '../../database.js';
import { seedAccount, seedProfile, seedTxFingerprint } from '../../repositories/__tests__/helpers.js';
import { createTestDatabase } from '../../utils/test-utils.js';
import { TransactionAnnotationStore } from '../transaction-annotation-store.js';

const DETECTOR_ID = 'bridge.detector';
const ACCOUNT_ID = 1;

interface MakeAnnotationOverrides {
  accountId?: number | undefined;
  transactionId: number;
  txFingerprint: string;
  kind?: TransactionAnnotation['kind'];
  tier?: TransactionAnnotation['tier'];
  role?: TransactionAnnotation['role'];
  detectorId?: string;
  groupKey?: string | undefined;
  protocolRefId?: string | undefined;
  protocolRefVersion?: string | undefined;
  derivedFromTxIds?: readonly [number, ...number[]];
  metadata?: Record<string, unknown> | undefined;
  provenanceInputs?: TransactionAnnotation['provenanceInputs'];
}

function makeAnnotation(overrides: MakeAnnotationOverrides): TransactionAnnotation {
  const kind = overrides.kind ?? 'bridge_participant';
  const tier = overrides.tier ?? 'asserted';
  const role = overrides.role ?? 'source';
  const protocolRefId = overrides.protocolRefId ?? 'wormhole';
  const detectorId = overrides.detectorId ?? DETECTOR_ID;
  const derivedFromTxIds = overrides.derivedFromTxIds ?? [overrides.transactionId];
  const provenanceInputs = overrides.provenanceInputs ?? (['processor'] as const);

  const fingerprintInput: AnnotationFingerprintInput = {
    kind,
    tier,
    txFingerprint: overrides.txFingerprint,
    target: { scope: 'transaction' },
    role,
    ...(protocolRefId === undefined
      ? {}
      : {
          protocolRef: {
            id: protocolRefId,
            ...(overrides.protocolRefVersion === undefined ? {} : { version: overrides.protocolRefVersion }),
          },
        }),
    ...(overrides.groupKey === undefined ? {} : { groupKey: overrides.groupKey }),
    ...(overrides.metadata === undefined ? {} : { metadata: overrides.metadata }),
  };

  const annotationFingerprint = assertOk(computeAnnotationFingerprint(fingerprintInput));

  return {
    annotationFingerprint,
    accountId: overrides.accountId ?? ACCOUNT_ID,
    transactionId: overrides.transactionId,
    txFingerprint: overrides.txFingerprint,
    kind,
    tier,
    target: { scope: 'transaction' },
    role,
    detectorId,
    derivedFromTxIds,
    provenanceInputs,
    ...(protocolRefId === undefined
      ? {}
      : {
          protocolRef: {
            id: protocolRefId,
            ...(overrides.protocolRefVersion === undefined ? {} : { version: overrides.protocolRefVersion }),
          },
        }),
    ...(overrides.groupKey === undefined ? {} : { groupKey: overrides.groupKey }),
    ...(overrides.metadata === undefined ? {} : { metadata: overrides.metadata }),
  };
}

async function seedTransactions(db: KyselyDB, count: number): Promise<string[]> {
  const fingerprints: string[] = [];
  for (let i = 1; i <= count; i++) {
    const fingerprint = seedTxFingerprint('kraken', ACCOUNT_ID, `tx-annotation-${i}`);
    fingerprints.push(fingerprint);
    await db
      .insertInto('transactions')
      .values({
        id: i,
        account_id: ACCOUNT_ID,
        platform_key: 'kraken',
        platform_kind: 'exchange',
        tx_fingerprint: fingerprint,
        transaction_status: 'success',
        transaction_datetime: '2025-01-01T00:00:00.000Z',
        excluded_from_accounting: false,
        created_at: new Date().toISOString(),
      })
      .execute();
  }
  return fingerprints;
}

describe('TransactionAnnotationStore', () => {
  let db: KyselyDB;
  let store: TransactionAnnotationStore;
  let fingerprints: string[];

  beforeEach(async () => {
    db = await createTestDatabase();
    await seedProfile(db);
    await seedAccount(db, ACCOUNT_ID, 'exchange-api', 'kraken');
    fingerprints = await seedTransactions(db, 3);
    store = new TransactionAnnotationStore(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  describe('readAnnotations', () => {
    it('rejects empty kinds', async () => {
      const result = await store.readAnnotations({ kinds: [], tiers: ['asserted'] });
      expect(result.isErr()).toBe(true);
      if (result.isErr()) expect(result.error.message).toContain('kinds');
    });

    it('rejects empty tiers', async () => {
      const result = await store.readAnnotations({ kinds: ['bridge_participant'], tiers: [] });
      expect(result.isErr()).toBe(true);
      if (result.isErr()) expect(result.error.message).toContain('tiers');
    });

    it('filters by kind and tier', async () => {
      const asserted = makeAnnotation({ transactionId: 1, txFingerprint: fingerprints[0]! });
      const heuristic = makeAnnotation({
        transactionId: 2,
        txFingerprint: fingerprints[1]!,
        tier: 'heuristic',
        role: 'target',
      });

      assertOk(await store.replaceForTransaction({ transactionId: 1, annotations: [asserted] }));
      assertOk(await store.replaceForTransaction({ transactionId: 2, annotations: [heuristic] }));

      const assertedOnly = assertOk(
        await store.readAnnotations({ kinds: ['bridge_participant'], tiers: ['asserted'] })
      );
      expect(assertedOnly).toHaveLength(1);
      expect(assertedOnly[0]?.annotationFingerprint).toBe(asserted.annotationFingerprint);

      const both = assertOk(
        await store.readAnnotations({ kinds: ['bridge_participant'], tiers: ['asserted', 'heuristic'] })
      );
      expect(both).toHaveLength(2);
    });

    it('filters by transactionId, protocolRefId, and groupKey', async () => {
      const a = makeAnnotation({
        transactionId: 1,
        txFingerprint: fingerprints[0]!,
        protocolRefId: 'wormhole',
        groupKey: 'group-a',
      });
      const b = makeAnnotation({
        transactionId: 2,
        txFingerprint: fingerprints[1]!,
        protocolRefId: 'stargate',
        groupKey: 'group-b',
      });
      assertOk(await store.replaceForTransaction({ transactionId: 1, annotations: [a] }));
      assertOk(await store.replaceForTransaction({ transactionId: 2, annotations: [b] }));

      const byTx = assertOk(
        await store.readAnnotations({ kinds: ['bridge_participant'], tiers: ['asserted'], transactionId: 2 })
      );
      expect(byTx).toHaveLength(1);
      expect(byTx[0]?.transactionId).toBe(2);

      const byProtocol = assertOk(
        await store.readAnnotations({
          kinds: ['bridge_participant'],
          tiers: ['asserted'],
          protocolRefId: 'stargate',
        })
      );
      expect(byProtocol).toHaveLength(1);
      expect(byProtocol[0]?.protocolRef?.id).toBe('stargate');

      const byGroup = assertOk(
        await store.readAnnotations({
          kinds: ['bridge_participant'],
          tiers: ['asserted'],
          groupKey: 'group-a',
        })
      );
      expect(byGroup).toHaveLength(1);
      expect(byGroup[0]?.groupKey).toBe('group-a');
    });

    it('filters by transactionIds', async () => {
      const first = makeAnnotation({ transactionId: 1, txFingerprint: fingerprints[0]! });
      const second = makeAnnotation({ transactionId: 2, txFingerprint: fingerprints[1]!, role: 'target' });
      const third = makeAnnotation({ transactionId: 3, txFingerprint: fingerprints[2]!, role: 'source' });

      assertOk(await store.replaceForTransaction({ transactionId: 1, annotations: [first] }));
      assertOk(await store.replaceForTransaction({ transactionId: 2, annotations: [second] }));
      assertOk(await store.replaceForTransaction({ transactionId: 3, annotations: [third] }));

      const filtered = assertOk(
        await store.readAnnotations({
          kinds: ['bridge_participant'],
          tiers: ['asserted'],
          transactionIds: [1, 3],
        })
      );

      expect(filtered.map((annotation) => annotation.transactionId)).toEqual([1, 3]);
    });

    it('filters by accountIds', async () => {
      await seedAccount(db, 2, 'blockchain', 'ethereum');
      const secondFingerprint = seedTxFingerprint('ethereum', 2, 'tx-annotation-account-2');
      await db
        .insertInto('transactions')
        .values({
          id: 4,
          account_id: 2,
          platform_key: 'ethereum',
          platform_kind: 'blockchain',
          tx_fingerprint: secondFingerprint,
          transaction_status: 'success',
          transaction_datetime: '2025-01-01T00:00:00.000Z',
          excluded_from_accounting: false,
          created_at: new Date().toISOString(),
        })
        .execute();

      const first = makeAnnotation({ transactionId: 1, txFingerprint: fingerprints[0]!, accountId: 1 });
      const second = makeAnnotation({ transactionId: 4, txFingerprint: secondFingerprint, accountId: 2 });

      assertOk(await store.replaceForTransaction({ transactionId: 1, annotations: [first] }));
      assertOk(await store.replaceForTransaction({ transactionId: 4, annotations: [second] }));

      const filtered = assertOk(
        await store.readAnnotations({
          accountIds: [2],
          kinds: ['bridge_participant'],
          tiers: ['asserted'],
        })
      );

      expect(filtered).toHaveLength(1);
      expect(filtered[0]?.accountId).toBe(2);
      expect(filtered[0]?.transactionId).toBe(4);
    });

    it('round-trips full annotation shape including metadata and protocol version', async () => {
      const annotation = makeAnnotation({
        transactionId: 1,
        txFingerprint: fingerprints[0]!,
        protocolRefId: 'wormhole',
        protocolRefVersion: 'v2',
        metadata: { nested: { count: 3 }, tag: 'alpha' },
      });
      assertOk(await store.replaceForTransaction({ transactionId: 1, annotations: [annotation] }));

      const read = assertOk(await store.readAnnotations({ kinds: ['bridge_participant'], tiers: ['asserted'] }));
      expect(read).toHaveLength(1);
      expect(read[0]).toEqual(annotation);
    });
  });

  describe('replaceForTransaction', () => {
    it('inserts new annotations', async () => {
      const a = makeAnnotation({ transactionId: 1, txFingerprint: fingerprints[0]!, role: 'source' });
      assertOk(await store.replaceForTransaction({ transactionId: 1, annotations: [a] }));

      const read = assertOk(
        await store.readAnnotations({ kinds: ['bridge_participant'], tiers: ['asserted'], transactionId: 1 })
      );
      expect(read).toHaveLength(1);
      expect(read[0]?.annotationFingerprint).toBe(a.annotationFingerprint);
    });

    it('replaces existing annotations for the same transaction', async () => {
      const first = makeAnnotation({ transactionId: 1, txFingerprint: fingerprints[0]!, role: 'source' });
      const second = makeAnnotation({ transactionId: 1, txFingerprint: fingerprints[0]!, role: 'target' });

      assertOk(await store.replaceForTransaction({ transactionId: 1, annotations: [first] }));
      assertOk(await store.replaceForTransaction({ transactionId: 1, annotations: [second] }));

      const read = assertOk(
        await store.readAnnotations({ kinds: ['bridge_participant'], tiers: ['asserted'], transactionId: 1 })
      );
      expect(read).toHaveLength(1);
      expect(read[0]?.role).toBe('target');
      expect(read[0]?.annotationFingerprint).toBe(second.annotationFingerprint);
    });

    it('clears annotations when given an empty list', async () => {
      const annotation = makeAnnotation({ transactionId: 1, txFingerprint: fingerprints[0]! });
      assertOk(await store.replaceForTransaction({ transactionId: 1, annotations: [annotation] }));
      assertOk(await store.replaceForTransaction({ transactionId: 1, annotations: [] }));

      const read = assertOk(
        await store.readAnnotations({ kinds: ['bridge_participant'], tiers: ['asserted'], transactionId: 1 })
      );
      expect(read).toHaveLength(0);
    });

    it('rejects annotations whose transactionId does not match the replacement scope', async () => {
      const bad = makeAnnotation({ transactionId: 2, txFingerprint: fingerprints[1]! });
      const result = await store.replaceForTransaction({ transactionId: 1, annotations: [bad] });
      expect(result.isErr()).toBe(true);
      if (result.isErr()) expect(result.error.message).toContain('replacement scope');
    });

    it('does not affect other transactions', async () => {
      const a = makeAnnotation({ transactionId: 1, txFingerprint: fingerprints[0]! });
      const b = makeAnnotation({ transactionId: 2, txFingerprint: fingerprints[1]!, role: 'target' });
      assertOk(await store.replaceForTransaction({ transactionId: 1, annotations: [a] }));
      assertOk(await store.replaceForTransaction({ transactionId: 2, annotations: [b] }));

      assertOk(await store.replaceForTransaction({ transactionId: 1, annotations: [] }));

      const remaining = assertOk(await store.readAnnotations({ kinds: ['bridge_participant'], tiers: ['asserted'] }));
      expect(remaining).toHaveLength(1);
      expect(remaining[0]?.transactionId).toBe(2);
    });
  });

  describe('replaceForDetectorInputs', () => {
    it('replaces by (detectorId, canonical derivedFromTxIds) regardless of order', async () => {
      const ann = makeAnnotation({
        transactionId: 1,
        txFingerprint: fingerprints[0]!,
        derivedFromTxIds: [1, 2, 3],
        role: 'source',
      });
      assertOk(
        await store.replaceForDetectorInputs({
          detectorId: DETECTOR_ID,
          derivedFromTxIds: [1, 2, 3],
          annotations: [ann],
        })
      );

      const replacement = makeAnnotation({
        transactionId: 1,
        txFingerprint: fingerprints[0]!,
        derivedFromTxIds: [3, 1, 2],
        role: 'target',
      });
      assertOk(
        await store.replaceForDetectorInputs({
          detectorId: DETECTOR_ID,
          derivedFromTxIds: [3, 2, 1],
          annotations: [replacement],
        })
      );

      const read = assertOk(await store.readAnnotations({ kinds: ['bridge_participant'], tiers: ['asserted'] }));
      expect(read).toHaveLength(1);
      expect(read[0]?.role).toBe('target');
      expect([...(read[0]?.derivedFromTxIds ?? [])]).toEqual([1, 2, 3]);
    });

    it('rejects annotations whose detectorId does not match', async () => {
      const bad = makeAnnotation({
        transactionId: 1,
        txFingerprint: fingerprints[0]!,
        detectorId: 'other.detector',
      });
      const result = await store.replaceForDetectorInputs({
        detectorId: DETECTOR_ID,
        derivedFromTxIds: [1],
        annotations: [bad],
      });
      expect(result.isErr()).toBe(true);
      if (result.isErr()) expect(result.error.message).toContain('detector');
    });

    it('rejects annotations whose derivedFromTxIds do not match', async () => {
      const bad = makeAnnotation({
        transactionId: 1,
        txFingerprint: fingerprints[0]!,
        derivedFromTxIds: [1, 2],
      });
      const result = await store.replaceForDetectorInputs({
        detectorId: DETECTOR_ID,
        derivedFromTxIds: [1, 3],
        annotations: [bad],
      });
      expect(result.isErr()).toBe(true);
      if (result.isErr()) expect(result.error.message).toContain('derivedFromTxIds');
    });

    it('does not touch annotations for other derivedFromTxIds keys', async () => {
      const keep = makeAnnotation({
        transactionId: 1,
        txFingerprint: fingerprints[0]!,
        derivedFromTxIds: [1],
      });
      assertOk(
        await store.replaceForDetectorInputs({
          detectorId: DETECTOR_ID,
          derivedFromTxIds: [1],
          annotations: [keep],
        })
      );
      assertOk(
        await store.replaceForDetectorInputs({
          detectorId: DETECTOR_ID,
          derivedFromTxIds: [2, 3],
          annotations: [],
        })
      );

      const read = assertOk(await store.readAnnotations({ kinds: ['bridge_participant'], tiers: ['asserted'] }));
      expect(read).toHaveLength(1);
      expect(read[0]?.annotationFingerprint).toBe(keep.annotationFingerprint);
    });
  });

  describe('replaceForDetectorGroup', () => {
    it('replaces by (detectorId, accountId, groupKey)', async () => {
      const a = makeAnnotation({
        transactionId: 1,
        txFingerprint: fingerprints[0]!,
        groupKey: 'group-a',
        role: 'source',
      });
      const b = makeAnnotation({
        transactionId: 2,
        txFingerprint: fingerprints[1]!,
        groupKey: 'group-a',
        role: 'target',
      });

      assertOk(
        await store.replaceForDetectorGroup({
          detectorId: DETECTOR_ID,
          accountId: ACCOUNT_ID,
          groupKey: 'group-a',
          annotations: [a, b],
        })
      );

      const replacement = makeAnnotation({
        transactionId: 1,
        txFingerprint: fingerprints[0]!,
        groupKey: 'group-a',
        role: 'claim',
      });
      assertOk(
        await store.replaceForDetectorGroup({
          detectorId: DETECTOR_ID,
          accountId: ACCOUNT_ID,
          groupKey: 'group-a',
          annotations: [replacement],
        })
      );

      const read = assertOk(
        await store.readAnnotations({
          kinds: ['bridge_participant'],
          tiers: ['asserted'],
          groupKey: 'group-a',
        })
      );
      expect(read).toHaveLength(1);
      expect(read[0]?.role).toBe('claim');
    });

    it('rejects annotations whose groupKey does not match', async () => {
      const bad = makeAnnotation({
        transactionId: 1,
        txFingerprint: fingerprints[0]!,
        groupKey: 'other-group',
      });
      const result = await store.replaceForDetectorGroup({
        detectorId: DETECTOR_ID,
        accountId: ACCOUNT_ID,
        groupKey: 'group-a',
        annotations: [bad],
      });
      expect(result.isErr()).toBe(true);
      if (result.isErr()) expect(result.error.message).toContain('groupKey');
    });

    it('rejects annotations whose accountId does not match', async () => {
      const bad = makeAnnotation({
        transactionId: 1,
        txFingerprint: fingerprints[0]!,
        groupKey: 'group-a',
      });
      const result = await store.replaceForDetectorGroup({
        detectorId: DETECTOR_ID,
        accountId: 999,
        groupKey: 'group-a',
        annotations: [bad],
      });
      expect(result.isErr()).toBe(true);
      if (result.isErr()) expect(result.error.message).toContain('account');
    });

    it('does not touch annotations for a different groupKey', async () => {
      const keep = makeAnnotation({
        transactionId: 1,
        txFingerprint: fingerprints[0]!,
        groupKey: 'group-keep',
      });
      assertOk(
        await store.replaceForDetectorGroup({
          detectorId: DETECTOR_ID,
          accountId: ACCOUNT_ID,
          groupKey: 'group-keep',
          annotations: [keep],
        })
      );

      assertOk(
        await store.replaceForDetectorGroup({
          detectorId: DETECTOR_ID,
          accountId: ACCOUNT_ID,
          groupKey: 'group-other',
          annotations: [],
        })
      );

      const read = assertOk(await store.readAnnotations({ kinds: ['bridge_participant'], tiers: ['asserted'] }));
      expect(read).toHaveLength(1);
      expect(read[0]?.groupKey).toBe('group-keep');
    });
  });

  describe('fingerprint uniqueness', () => {
    it('rejects inserting two rows with the same annotation_fingerprint', async () => {
      const a = makeAnnotation({ transactionId: 1, txFingerprint: fingerprints[0]! });
      assertOk(await store.replaceForTransaction({ transactionId: 1, annotations: [a] }));

      // Compute a second annotation on a different transaction but force an identical fingerprint
      // by using the same fingerprint material explicitly. This simulates a bug where two detector
      // outputs collide in the id space.
      const colliding: TransactionAnnotation = {
        ...a,
        transactionId: 2,
        txFingerprint: fingerprints[1]!,
        derivedFromTxIds: [2],
      };
      const result = await store.replaceForTransaction({ transactionId: 2, annotations: [colliding] });
      expect(result.isErr()).toBe(true);
    });
  });
});
