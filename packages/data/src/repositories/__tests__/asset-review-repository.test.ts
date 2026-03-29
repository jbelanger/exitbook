import type { AssetReviewSummary } from '@exitbook/core';
import { assertOk } from '@exitbook/foundation/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { KyselyDB } from '../../database.js';
import { createTestDatabase } from '../../utils/test-utils.js';
import { AssetReviewRepository } from '../asset-review-repository.js';

import { seedProfile } from './helpers.js';

const PROFILE_ID = 1;

function createSummary(assetId: string, overrides: Partial<AssetReviewSummary> = {}): AssetReviewSummary {
  return {
    assetId,
    reviewStatus: 'needs-review',
    referenceStatus: 'unknown',
    evidenceFingerprint: `asset-review:v1:${assetId}`,
    confirmationIsStale: false,
    accountingBlocked: true,
    warningSummary: 'Suspicious asset evidence requires review',
    evidence: [
      {
        kind: 'spam-flag',
        severity: 'error',
        message: 'Processed transactions marked this asset as spam',
      },
    ],
    ...overrides,
  };
}

describe('AssetReviewRepository', () => {
  let db: KyselyDB;
  let repo: AssetReviewRepository;

  beforeEach(async () => {
    db = await createTestDatabase();
    await seedProfile(db);
    repo = new AssetReviewRepository(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('replaces and reloads the full asset review projection', async () => {
    assertOk(
      await repo.replaceAll(PROFILE_ID, [
        createSummary('blockchain:ethereum:0xscam', {
          evidence: [
            {
              kind: 'same-symbol-ambiguity',
              severity: 'warning',
              message: 'Same-chain symbol ambiguity on ethereum:usdc',
              metadata: {
                chain: 'ethereum',
                conflictingAssetIds: ['blockchain:ethereum:0xaaa', 'blockchain:ethereum:0xbbb'],
                normalizedSymbol: 'usdc',
              },
            },
            {
              kind: 'spam-flag',
              severity: 'error',
              message: 'Processed transactions marked this asset as spam',
            },
          ],
        }),
        createSummary('exchange:kraken:btc', {
          reviewStatus: 'clear',
          warningSummary: undefined,
          evidence: [],
          accountingBlocked: false,
        }),
      ])
    );

    const summaries = assertOk(await repo.listAll(PROFILE_ID));

    expect(summaries).toHaveLength(2);
    expect(summaries[0]).toMatchObject({
      assetId: 'blockchain:ethereum:0xscam',
      accountingBlocked: true,
      reviewStatus: 'needs-review',
    });
    expect(summaries[0]?.evidence).toEqual([
      {
        kind: 'same-symbol-ambiguity',
        severity: 'warning',
        message: 'Same-chain symbol ambiguity on ethereum:usdc',
        metadata: {
          chain: 'ethereum',
          conflictingAssetIds: ['blockchain:ethereum:0xaaa', 'blockchain:ethereum:0xbbb'],
          normalizedSymbol: 'usdc',
        },
      },
      {
        kind: 'spam-flag',
        severity: 'error',
        message: 'Processed transactions marked this asset as spam',
      },
    ]);
    expect(summaries[1]).toMatchObject({
      assetId: 'exchange:kraken:btc',
      reviewStatus: 'clear',
      accountingBlocked: false,
      evidence: [],
    });
  });

  it('replaces old rows instead of appending to them', async () => {
    assertOk(await repo.replaceAll(PROFILE_ID, [createSummary('blockchain:ethereum:0xold')]));
    assertOk(
      await repo.replaceAll(PROFILE_ID, [createSummary('blockchain:ethereum:0xnew', { accountingBlocked: false })])
    );

    const summaries = assertOk(await repo.listAll(PROFILE_ID));

    expect(summaries.map((summary) => summary.assetId)).toEqual(['blockchain:ethereum:0xnew']);
  });

  it('loads a filtered map by asset ids', async () => {
    assertOk(
      await repo.replaceAll(PROFILE_ID, [
        createSummary('blockchain:ethereum:0xscam'),
        createSummary('exchange:kraken:btc', { accountingBlocked: false, reviewStatus: 'clear', evidence: [] }),
      ])
    );

    const summaries = assertOk(await repo.getByAssetIds(PROFILE_ID, ['exchange:kraken:btc']));

    expect([...summaries.keys()]).toEqual(['exchange:kraken:btc']);
    expect(summaries.get('exchange:kraken:btc')).toMatchObject({
      assetId: 'exchange:kraken:btc',
      accountingBlocked: false,
    });
  });

  it('returns an error when persisted evidence metadata is malformed', async () => {
    await db
      .insertInto('asset_review_state')
      .values({
        profile_id: PROFILE_ID,
        asset_id: 'blockchain:ethereum:0xscam',
        review_status: 'needs-review',
        reference_status: 'unknown',
        warning_summary: undefined,
        evidence_fingerprint: 'asset-review:v1:blockchain:ethereum:0xscam',
        confirmed_evidence_fingerprint: undefined,
        confirmation_is_stale: false,
        accounting_blocked: true,
        computed_at: new Date().toISOString(),
      })
      .execute();

    await db
      .insertInto('asset_review_evidence')
      .values({
        profile_id: PROFILE_ID,
        asset_id: 'blockchain:ethereum:0xscam',
        position: 0,
        kind: 'spam-flag',
        severity: 'error',
        message: 'bad metadata row',
        metadata_json: '[]',
      })
      .execute();

    const result = await repo.listAll(PROFILE_ID);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('blockchain:ethereum:0xscam');
      expect(result.error.message).toContain('position 0');
    }
  });

  it('tracks the latest computed timestamp', async () => {
    expect(assertOk(await repo.findLatestComputedAt(PROFILE_ID))).toBeNull();

    assertOk(await repo.replaceAll(PROFILE_ID, [createSummary('blockchain:ethereum:0xscam')]));

    const latest = assertOk(await repo.findLatestComputedAt(PROFILE_ID));
    expect(latest).toBeInstanceOf(Date);
  });

  it('replaces large projections without exceeding SQLite variable limits', async () => {
    const totalSummaries = 250;
    const summaries = Array.from({ length: totalSummaries }, (_, index) =>
      createSummary(`blockchain:ethereum:0x${index.toString(16).padStart(4, '0')}`, {
        evidence: [
          {
            kind: 'same-symbol-ambiguity',
            severity: 'warning',
            message: `Ambiguous asset ${index}`,
            metadata: {
              chain: 'ethereum',
              conflictingAssetIds: [`blockchain:ethereum:0x${index.toString(16).padStart(4, '0')}`],
            },
          },
          {
            kind: 'spam-flag',
            severity: 'error',
            message: `Spam asset ${index}`,
          },
        ],
      })
    );

    assertOk(await repo.replaceAll(PROFILE_ID, summaries));

    const persisted = assertOk(await repo.listAll(PROFILE_ID));
    expect(persisted).toHaveLength(totalSummaries);
    expect(persisted[0]?.assetId).toBe('blockchain:ethereum:0x0000');
    expect(persisted.at(-1)?.assetId).toBe(
      `blockchain:ethereum:0x${(totalSummaries - 1).toString(16).padStart(4, '0')}`
    );
  });
});
