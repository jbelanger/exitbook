import type { Currency, UniversalTransactionData } from '@exitbook/core';
import { parseDecimal } from '@exitbook/core';
import { ok } from '@exitbook/core';
import { assertOk } from '@exitbook/core/test-utils';
import { describe, expect, it, vi } from 'vitest';

import { buildAssetReviewSummaries } from '../asset-review-service.js';

function createTransaction(params: {
  assetId: string;
  assetSymbol: string;
  externalId: string;
  fees?: { assetId: string; assetSymbol: string }[] | undefined;
  id: number;
  includeFeeWithSameAsset?: boolean | undefined;
  isSpam?: boolean | undefined;
  notes?: UniversalTransactionData['notes'];
  source?: string | undefined;
}): UniversalTransactionData {
  return {
    id: params.id,
    accountId: 1,
    externalId: params.externalId,
    datetime: '2025-01-01T00:00:00.000Z',
    timestamp: Date.parse('2025-01-01T00:00:00.000Z'),
    source: params.source ?? 'ethereum',
    sourceType: 'blockchain',
    status: 'success',
    isSpam: params.isSpam,
    movements: {
      inflows: [
        {
          assetId: params.assetId,
          assetSymbol: params.assetSymbol as Currency,
          grossAmount: parseDecimal('100'),
        },
      ],
      outflows: [],
    },
    fees: [
      ...(params.includeFeeWithSameAsset
        ? [
            {
              assetId: params.assetId,
              assetSymbol: params.assetSymbol as Currency,
              amount: parseDecimal('1'),
              scope: 'platform' as const,
              settlement: 'balance' as const,
            },
          ]
        : []),
      ...((params.fees ?? []).map((fee) => ({
        assetId: fee.assetId,
        assetSymbol: fee.assetSymbol as Currency,
        amount: parseDecimal('1'),
        scope: 'platform' as const,
        settlement: 'balance' as const,
      })) as UniversalTransactionData['fees']),
    ],
    operation: {
      category: 'transfer',
      type: 'deposit',
    },
    notes: params.notes,
  };
}

describe('buildAssetReviewSummaries', () => {
  it('flags explicit scam note evidence without double-counting duplicate asset entries in a transaction', async () => {
    const assetId = 'blockchain:ethereum:0xscam';
    const result = await buildAssetReviewSummaries([
      createTransaction({
        id: 1,
        externalId: 'tx-1',
        assetId,
        assetSymbol: 'SCAM',
        includeFeeWithSameAsset: true,
        notes: [
          {
            type: 'SCAM_TOKEN',
            severity: 'error',
            message: 'Provider marked this token as scam',
          },
        ],
      }),
    ]);

    const summary = assertOk(result).get(assetId);

    expect(summary).toMatchObject({
      reviewStatus: 'needs-review',
      referenceStatus: 'unknown',
      confirmationIsStale: false,
      accountingBlocked: true,
      warningSummary: '1 processed transaction(s) carried SCAM_TOKEN warnings',
    });
    expect(summary?.evidence.map((item) => item.kind)).toEqual(['scam-note']);
  });

  it('does not smear token scam evidence onto an unrelated fee asset in the same transaction', async () => {
    const scamAssetId = 'blockchain:ethereum:0xscam';
    const nativeAssetId = 'blockchain:ethereum:native';

    const result = await buildAssetReviewSummaries([
      createTransaction({
        id: 1,
        externalId: 'tx-1',
        assetId: scamAssetId,
        assetSymbol: 'SCAM',
        isSpam: true,
        fees: [{ assetId: nativeAssetId, assetSymbol: 'ETH' }],
        notes: [
          {
            type: 'SCAM_TOKEN',
            severity: 'error',
            message: 'Provider marked this token as scam',
            metadata: {
              assetSymbol: 'SCAM',
              contractAddress: '0xscam',
            },
          },
        ],
      }),
    ]);

    const summaries = assertOk(result);

    expect(summaries.get(scamAssetId)).toMatchObject({
      reviewStatus: 'needs-review',
      accountingBlocked: true,
    });
    expect(summaries.get(scamAssetId)?.evidence.map((item) => item.kind)).toEqual(['scam-note', 'spam-flag']);
    expect(summaries.get(nativeAssetId)).toMatchObject({
      reviewStatus: 'clear',
      accountingBlocked: false,
      evidence: [],
    });
  });

  it('flags same-chain same-symbol ambiguity when multiple EVM contracts share a symbol', async () => {
    const firstAssetId = 'blockchain:ethereum:0xaaa';
    const secondAssetId = 'blockchain:ethereum:0xbbb';

    const result = await buildAssetReviewSummaries([
      createTransaction({
        id: 1,
        externalId: 'tx-1',
        assetId: firstAssetId,
        assetSymbol: 'USDC',
      }),
      createTransaction({
        id: 2,
        externalId: 'tx-2',
        assetId: secondAssetId,
        assetSymbol: 'USDC',
      }),
    ]);

    const summaries = assertOk(result);

    expect(summaries.get(firstAssetId)?.evidence.map((item) => item.kind)).toEqual(['same-symbol-ambiguity']);
    expect(summaries.get(secondAssetId)?.evidence.map((item) => item.kind)).toEqual(['same-symbol-ambiguity']);
    expect(summaries.get(firstAssetId)?.reviewStatus).toBe('needs-review');
    expect(summaries.get(secondAssetId)?.reviewStatus).toBe('needs-review');
    expect(summaries.get(firstAssetId)?.accountingBlocked).toBe(true);
    expect(summaries.get(secondAssetId)?.accountingBlocked).toBe(true);
  });

  it('suppresses ambiguity evidence for a contract with a matched canonical reference', async () => {
    const firstAssetId = 'blockchain:ethereum:0xaaa';
    const secondAssetId = 'blockchain:ethereum:0xbbb';
    const referenceResolver = {
      resolveBatch: vi.fn().mockResolvedValue(
        ok(
          new Map([
            [
              '0xaaa',
              {
                provider: 'coingecko',
                referenceStatus: 'matched',
                externalAssetId: 'usd-coin',
              },
            ],
            [
              '0xbbb',
              {
                provider: 'coingecko',
                referenceStatus: 'unknown',
              },
            ],
          ])
        )
      ),
    };

    const result = await buildAssetReviewSummaries(
      [
        createTransaction({
          id: 1,
          externalId: 'tx-1',
          assetId: firstAssetId,
          assetSymbol: 'USDC',
        }),
        createTransaction({
          id: 2,
          externalId: 'tx-2',
          assetId: secondAssetId,
          assetSymbol: 'USDC',
        }),
      ],
      { referenceResolver }
    );

    const summaries = assertOk(result);

    expect(summaries.get(firstAssetId)).toMatchObject({
      reviewStatus: 'clear',
      referenceStatus: 'matched',
      accountingBlocked: false,
      warningSummary: undefined,
      evidence: [],
    });
    expect(summaries.get(secondAssetId)?.evidence.map((item) => item.kind)).toEqual(['same-symbol-ambiguity']);
  });

  it('marks suspicious assets reviewed when the stored confirmation fingerprint still matches', async () => {
    const assetId = 'blockchain:ethereum:0xscam';
    const initialResult = await buildAssetReviewSummaries([
      createTransaction({
        id: 1,
        externalId: 'tx-1',
        assetId,
        assetSymbol: 'SCAM',
        isSpam: true,
      }),
    ]);
    const initialFingerprint = assertOk(initialResult).get(assetId)?.evidenceFingerprint;

    const result = await buildAssetReviewSummaries(
      [
        createTransaction({
          id: 1,
          externalId: 'tx-1',
          assetId,
          assetSymbol: 'SCAM',
          isSpam: true,
        }),
      ],
      {
        reviewDecisions: new Map([
          [
            assetId,
            {
              action: 'confirm',
              evidenceFingerprint: initialFingerprint,
            },
          ],
        ]),
      }
    );

    const summary = assertOk(result).get(assetId);

    expect(summary).toMatchObject({
      reviewStatus: 'reviewed',
      confirmationIsStale: false,
      accountingBlocked: false,
      confirmedEvidenceFingerprint: initialFingerprint,
    });
  });

  it('reopens a reviewed asset when the evidence fingerprint changes', async () => {
    const assetId = 'blockchain:ethereum:0xscam';
    const initialResult = await buildAssetReviewSummaries([
      createTransaction({
        id: 1,
        externalId: 'tx-1',
        assetId,
        assetSymbol: 'SCAM',
        isSpam: true,
      }),
    ]);
    const initialFingerprint = assertOk(initialResult).get(assetId)?.evidenceFingerprint;

    const result = await buildAssetReviewSummaries(
      [
        createTransaction({
          id: 1,
          externalId: 'tx-1',
          assetId,
          assetSymbol: 'SCAM',
          isSpam: true,
          notes: [
            {
              type: 'SUSPICIOUS_AIRDROP',
              severity: 'warning',
              message: 'Unsolicited token airdrop',
            },
          ],
        }),
      ],
      {
        reviewDecisions: new Map([
          [
            assetId,
            {
              action: 'confirm',
              evidenceFingerprint: initialFingerprint,
            },
          ],
        ]),
      }
    );

    const summary = assertOk(result).get(assetId);

    expect(summary).toMatchObject({
      reviewStatus: 'needs-review',
      confirmationIsStale: true,
      accountingBlocked: false,
      confirmedEvidenceFingerprint: initialFingerprint,
    });
    expect(summary?.evidence.map((item) => item.kind)).toEqual(['suspicious-airdrop-note']);
  });

  it('keeps warning-only evidence visible without blocking accounting', async () => {
    const assetId = 'blockchain:ethereum:0xwarn';

    const result = await buildAssetReviewSummaries([
      createTransaction({
        id: 1,
        externalId: 'tx-1',
        assetId,
        assetSymbol: 'WARN',
        notes: [
          {
            type: 'SUSPICIOUS_AIRDROP',
            severity: 'warning',
            message: 'Unsolicited token airdrop',
            metadata: {
              assetSymbol: 'WARN',
              contractAddress: '0xwarn',
            },
          },
        ],
      }),
    ]);

    const summary = assertOk(result).get(assetId);

    expect(summary).toMatchObject({
      reviewStatus: 'needs-review',
      accountingBlocked: false,
    });
    expect(summary?.evidence.map((item) => item.kind)).toEqual(['suspicious-airdrop-note']);
  });

  it('does not turn warning-only SCAM_TOKEN notes into blocking error evidence', async () => {
    const assetId = 'blockchain:ethereum:0xwarn';

    const result = await buildAssetReviewSummaries([
      createTransaction({
        id: 1,
        externalId: 'tx-1',
        assetId,
        assetSymbol: 'WARN',
        notes: [
          {
            type: 'SCAM_TOKEN',
            severity: 'warning',
            message: 'Suspicious symbol-based token warning',
            metadata: {
              assetSymbol: 'WARN',
              contractAddress: '0xwarn',
            },
          },
        ],
      }),
    ]);

    const summary = assertOk(result).get(assetId);

    expect(summary).toMatchObject({
      reviewStatus: 'needs-review',
      accountingBlocked: false,
      warningSummary: '1 processed transaction(s) carried SCAM_TOKEN warnings',
    });
    expect(summary?.evidence).toEqual([
      {
        kind: 'scam-note',
        severity: 'warning',
        message: '1 processed transaction(s) carried SCAM_TOKEN warnings',
        metadata: {
          count: 1,
        },
      },
    ]);
  });
});
