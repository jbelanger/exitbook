import type { FeeMovement, Transaction } from '@exitbook/core';
import { buildAssetMovementCanonicalMaterial, buildFeeMovementCanonicalMaterial } from '@exitbook/core';
import type { Currency } from '@exitbook/foundation';
import { parseDecimal, sha256Hex } from '@exitbook/foundation';
import { ok } from '@exitbook/foundation';
import { assertOk } from '@exitbook/foundation/test-utils';
import { describe, expect, it, vi } from 'vitest';

import { buildAssetReviewSummaries } from '../asset-review-service.js';

function materializeMovementFingerprint(
  txFingerprint: string,
  canonicalMaterial: string,
  duplicateOccurrence: number
): string {
  return `movement:${sha256Hex(`${txFingerprint}|${canonicalMaterial}`)}:${duplicateOccurrence}`;
}

function createTransaction(params: {
  assetId: string;
  assetSymbol: string;
  diagnostics?: Transaction['diagnostics'];
  fees?: { assetId: string; assetSymbol: string }[] | undefined;
  id: number;
  includeFeeWithSameAsset?: boolean | undefined;
  platformKey?: string | undefined;
  txFingerprint: string;
}): Transaction {
  const inflows = [
    {
      assetId: params.assetId,
      assetSymbol: params.assetSymbol as Currency,
      grossAmount: parseDecimal('100'),
      movementFingerprint: materializeMovementFingerprint(
        params.txFingerprint,
        buildAssetMovementCanonicalMaterial({
          movementType: 'inflow',
          assetId: params.assetId,
          grossAmount: parseDecimal('100'),
        }),
        1
      ),
    },
  ];
  const fees: FeeMovement[] = [
    ...(params.includeFeeWithSameAsset
      ? [
          {
            assetId: params.assetId,
            assetSymbol: params.assetSymbol as Currency,
            amount: parseDecimal('1'),
            movementFingerprint: materializeMovementFingerprint(
              params.txFingerprint,
              buildFeeMovementCanonicalMaterial({
                assetId: params.assetId,
                amount: parseDecimal('1'),
                scope: 'platform',
                settlement: 'balance',
              }),
              1
            ),
            scope: 'platform' as const,
            settlement: 'balance' as const,
          },
        ]
      : []),
    ...((params.fees ?? []).map((fee, index) => ({
      assetId: fee.assetId,
      assetSymbol: fee.assetSymbol as Currency,
      amount: parseDecimal('1'),
      movementFingerprint: materializeMovementFingerprint(
        params.txFingerprint,
        buildFeeMovementCanonicalMaterial({
          assetId: fee.assetId,
          amount: parseDecimal('1'),
          scope: 'platform',
          settlement: 'balance',
        }),
        index + (params.includeFeeWithSameAsset ? 2 : 1)
      ),
      scope: 'platform' as const,
      settlement: 'balance' as const,
    })) as FeeMovement[]),
  ];

  return {
    id: params.id,
    accountId: 1,
    txFingerprint: params.txFingerprint,
    datetime: '2025-01-01T00:00:00.000Z',
    timestamp: Date.parse('2025-01-01T00:00:00.000Z'),
    platformKey: params.platformKey ?? 'ethereum',
    platformKind: 'blockchain',
    status: 'success',
    movements: {
      inflows,
      outflows: [],
    },
    fees,
    operation: {
      category: 'transfer',
      type: 'deposit',
    },
    diagnostics: params.diagnostics,
  };
}

function createMultiAssetTransaction(params: {
  diagnostics?: Transaction['diagnostics'];
  fees?: { assetId: string; assetSymbol: string }[] | undefined;
  id: number;
  platformKey?: string | undefined;
  primaryAssets: { assetId: string; assetSymbol: string }[];
  txFingerprint: string;
}): Transaction {
  const inflows = params.primaryAssets.map((asset, index) => ({
    assetId: asset.assetId,
    assetSymbol: asset.assetSymbol as Currency,
    grossAmount: parseDecimal('100'),
    movementFingerprint: materializeMovementFingerprint(params.txFingerprint, 'inflow', index),
  }));
  const fees: FeeMovement[] = (params.fees ?? []).map((fee, index) => ({
    assetId: fee.assetId,
    assetSymbol: fee.assetSymbol as Currency,
    amount: parseDecimal('1'),
    movementFingerprint: materializeMovementFingerprint(params.txFingerprint, 'fee', index),
    scope: 'platform' as const,
    settlement: 'balance' as const,
  }));

  return {
    id: params.id,
    accountId: 1,
    txFingerprint: params.txFingerprint,
    datetime: '2025-01-01T00:00:00.000Z',
    timestamp: Date.parse('2025-01-01T00:00:00.000Z'),
    platformKey: params.platformKey ?? 'ethereum',
    platformKind: 'blockchain',
    status: 'success',
    movements: {
      inflows,
      outflows: [],
    },
    fees,
    operation: {
      category: 'transfer',
      type: 'deposit',
    },
    diagnostics: params.diagnostics,
  };
}

describe('buildAssetReviewSummaries', () => {
  it('flags explicit scam note evidence without double-counting duplicate asset entries in a transaction', async () => {
    const assetId = 'blockchain:ethereum:0xscam';
    const result = await buildAssetReviewSummaries([
      createTransaction({
        id: 1,
        txFingerprint: 'tx-1',
        assetId,
        assetSymbol: 'SCAM',
        includeFeeWithSameAsset: true,
        diagnostics: [
          {
            code: 'SCAM_TOKEN',
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
    expect(summary?.evidence.map((item) => item.kind)).toEqual(['scam-diagnostic']);
  });

  it('does not smear token scam evidence onto an unrelated fee asset in the same transaction', async () => {
    const scamAssetId = 'blockchain:ethereum:0xscam';
    const nativeAssetId = 'blockchain:ethereum:native';

    const result = await buildAssetReviewSummaries([
      createTransaction({
        id: 1,
        txFingerprint: 'tx-1',
        assetId: scamAssetId,
        assetSymbol: 'SCAM',
        fees: [{ assetId: nativeAssetId, assetSymbol: 'ETH' }],
        diagnostics: [
          {
            code: 'SCAM_TOKEN',
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
    expect(summaries.get(scamAssetId)?.evidence.map((item) => item.kind)).toEqual(['scam-diagnostic']);
    expect(summaries.get(nativeAssetId)).toMatchObject({
      reviewStatus: 'clear',
      accountingBlocked: false,
      evidence: [],
    });
  });

  it('applies symbol-targeted scam notes to the uniquely matching asset in a multi-asset transaction', async () => {
    const scamAssetId = 'blockchain:ethereum:0xscam';
    const otherAssetId = 'blockchain:ethereum:0xother';

    const result = await buildAssetReviewSummaries([
      createMultiAssetTransaction({
        id: 1,
        txFingerprint: 'tx-1',
        primaryAssets: [
          { assetId: scamAssetId, assetSymbol: 'SCAM' },
          { assetId: otherAssetId, assetSymbol: 'OTHER' },
        ],
        diagnostics: [
          {
            code: 'SCAM_TOKEN',
            severity: 'warning',
            message: 'Symbol-targeted scam note',
            metadata: {
              assetSymbol: 'SCAM',
            },
          },
        ],
      }),
    ]);

    const summaries = assertOk(result);

    expect(summaries.get(scamAssetId)).toMatchObject({
      reviewStatus: 'needs-review',
      accountingBlocked: false,
    });
    expect(summaries.get(scamAssetId)?.evidence.map((item) => item.kind)).toEqual(['scam-diagnostic']);
    expect(summaries.get(otherAssetId)).toMatchObject({
      reviewStatus: 'clear',
      accountingBlocked: false,
      evidence: [],
    });
  });

  it('does not smear symbol-targeted scam notes across multiple assets that share the same symbol', async () => {
    const firstAssetId = 'exchange:kraken:scam-one';
    const secondAssetId = 'exchange:coinbase:scam-two';

    const result = await buildAssetReviewSummaries([
      createMultiAssetTransaction({
        id: 1,
        txFingerprint: 'tx-1',
        platformKey: 'kraken',
        primaryAssets: [
          { assetId: firstAssetId, assetSymbol: 'SCAM' },
          { assetId: secondAssetId, assetSymbol: 'SCAM' },
        ],
        diagnostics: [
          {
            code: 'SCAM_TOKEN',
            severity: 'warning',
            message: 'Ambiguous symbol-targeted scam note',
            metadata: {
              assetSymbol: 'SCAM',
            },
          },
        ],
      }),
    ]);

    const summaries = assertOk(result);

    expect(summaries.get(firstAssetId)).toMatchObject({
      reviewStatus: 'clear',
      accountingBlocked: false,
      evidence: [],
    });
    expect(summaries.get(secondAssetId)).toMatchObject({
      reviewStatus: 'clear',
      accountingBlocked: false,
      evidence: [],
    });
  });

  it('flags same-chain same-symbol ambiguity when multiple blockchain token refs share a symbol', async () => {
    const firstAssetId = 'blockchain:solana:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
    const secondAssetId = 'blockchain:solana:So11111111111111111111111111111111111111112';

    const result = await buildAssetReviewSummaries([
      createTransaction({
        id: 1,
        txFingerprint: 'tx-1',
        assetId: firstAssetId,
        assetSymbol: 'USDC',
      }),
      createTransaction({
        id: 2,
        txFingerprint: 'tx-2',
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

  it('queries non-EVM token refs through metadata and reference readers without pre-filtering', async () => {
    const mint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
    const assetId = `blockchain:solana:${mint}`;
    const tokenMetadataReader = {
      getByTokenRefs: vi.fn().mockResolvedValue(ok(new Map([[mint, undefined]]))),
    };
    const referenceResolver = {
      resolveBatch: vi.fn().mockResolvedValue(
        ok(
          new Map([
            [
              mint,
              {
                provider: 'coingecko',
                referenceStatus: 'matched',
                externalAssetId: 'usd-coin',
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
          txFingerprint: 'tx-1',
          assetId,
          assetSymbol: 'USDC',
          platformKey: 'solana',
        }),
      ],
      {
        tokenMetadataReader,
        referenceResolver,
      }
    );

    expect(tokenMetadataReader.getByTokenRefs).toHaveBeenCalledWith('solana', [mint]);
    expect(referenceResolver.resolveBatch).toHaveBeenCalledWith('solana', [mint]);
    expect(assertOk(result).get(assetId)).toMatchObject({
      referenceStatus: 'matched',
      reviewStatus: 'clear',
    });
  });

  it('flags unmatched canonical references for review without blocking accounting', async () => {
    const assetId = 'blockchain:ethereum:0xdeadbeef';
    const referenceResolver = {
      resolveBatch: vi.fn().mockResolvedValue(
        ok(
          new Map([
            [
              '0xdeadbeef',
              {
                provider: 'coingecko',
                referenceStatus: 'unmatched',
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
          txFingerprint: 'tx-1',
          assetId,
          assetSymbol: 'UNDG',
        }),
      ],
      { referenceResolver }
    );

    expect(assertOk(result).get(assetId)).toMatchObject({
      referenceStatus: 'unmatched',
      reviewStatus: 'needs-review',
      accountingBlocked: false,
      warningSummary: "Provider 'coingecko' could not match this token to a canonical asset",
      evidence: [
        {
          kind: 'unmatched-reference',
          severity: 'warning',
          message: "Provider 'coingecko' could not match this token to a canonical asset",
          metadata: {
            provider: 'coingecko',
          },
        },
      ],
    });
  });

  it('keeps same-symbol ambiguity blocking even when one contract has a matched canonical reference', async () => {
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
          txFingerprint: 'tx-1',
          assetId: firstAssetId,
          assetSymbol: 'USDC',
        }),
        createTransaction({
          id: 2,
          txFingerprint: 'tx-2',
          assetId: secondAssetId,
          assetSymbol: 'USDC',
        }),
      ],
      { referenceResolver }
    );

    const summaries = assertOk(result);

    expect(summaries.get(firstAssetId)).toMatchObject({
      reviewStatus: 'needs-review',
      referenceStatus: 'matched',
      accountingBlocked: true,
    });
    expect(summaries.get(firstAssetId)?.evidence.map((item) => item.kind)).toEqual(['same-symbol-ambiguity']);
    expect(summaries.get(secondAssetId)?.evidence.map((item) => item.kind)).toEqual(['same-symbol-ambiguity']);
  });

  it('marks suspicious assets reviewed when the stored confirmation fingerprint still matches', async () => {
    const assetId = 'blockchain:ethereum:0xscam';
    const initialResult = await buildAssetReviewSummaries([
      createTransaction({
        id: 1,
        txFingerprint: 'tx-1',
        assetId,
        assetSymbol: 'SCAM',
        diagnostics: [
          {
            code: 'SCAM_TOKEN',
            severity: 'error',
            message: 'Provider marked this token as scam',
          },
        ],
      }),
    ]);
    const initialFingerprint = assertOk(initialResult).get(assetId)?.evidenceFingerprint;

    const result = await buildAssetReviewSummaries(
      [
        createTransaction({
          id: 1,
          txFingerprint: 'tx-1',
          assetId,
          assetSymbol: 'SCAM',
          diagnostics: [
            {
              code: 'SCAM_TOKEN',
              severity: 'error',
              message: 'Provider marked this token as scam',
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
        txFingerprint: 'tx-1',
        assetId,
        assetSymbol: 'SCAM',
        diagnostics: [
          {
            code: 'SCAM_TOKEN',
            severity: 'error',
            message: 'Provider marked this token as scam',
          },
        ],
      }),
    ]);
    const initialFingerprint = assertOk(initialResult).get(assetId)?.evidenceFingerprint;

    const result = await buildAssetReviewSummaries(
      [
        createTransaction({
          id: 1,
          txFingerprint: 'tx-1',
          assetId,
          assetSymbol: 'SCAM',
          diagnostics: [
            {
              code: 'SCAM_TOKEN',
              severity: 'error',
              message: 'Provider marked this token as scam',
            },
            {
              code: 'SUSPICIOUS_AIRDROP',
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
      accountingBlocked: true,
      confirmedEvidenceFingerprint: initialFingerprint,
    });
    expect(summary?.evidence.map((item) => item.kind)).toEqual(['scam-diagnostic', 'suspicious-airdrop-diagnostic']);
  });

  it('keeps warning-only evidence visible without blocking accounting', async () => {
    const assetId = 'blockchain:ethereum:0xwarn';

    const result = await buildAssetReviewSummaries([
      createTransaction({
        id: 1,
        txFingerprint: 'tx-1',
        assetId,
        assetSymbol: 'WARN',
        diagnostics: [
          {
            code: 'SUSPICIOUS_AIRDROP',
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
    expect(summary?.evidence.map((item) => item.kind)).toEqual(['suspicious-airdrop-diagnostic']);
  });

  it('does not project transaction-scoped suspicious airdrop diagnostics onto the primary asset', async () => {
    const assetId = 'blockchain:injective:native';

    const result = await buildAssetReviewSummaries([
      createTransaction({
        id: 1,
        txFingerprint: 'tx-1',
        assetId,
        assetSymbol: 'INJ',
        platformKey: 'injective',
        diagnostics: [
          {
            code: 'SUSPICIOUS_AIRDROP',
            severity: 'warning',
            message: 'Suspicious promo memo on inbound transfer: airdrop/eligibility URL',
            metadata: {
              detectionSource: 'memo',
              targetScope: 'transaction',
            },
          },
        ],
      }),
    ]);

    const summary = assertOk(result).get(assetId);

    expect(summary).toMatchObject({
      reviewStatus: 'clear',
      accountingBlocked: false,
      evidence: [],
    });
  });

  it('does not turn warning-only SCAM_TOKEN diagnostics into blocking error evidence', async () => {
    const assetId = 'blockchain:ethereum:0xwarn';

    const result = await buildAssetReviewSummaries([
      createTransaction({
        id: 1,
        txFingerprint: 'tx-1',
        assetId,
        assetSymbol: 'WARN',
        diagnostics: [
          {
            code: 'SCAM_TOKEN',
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
        kind: 'scam-diagnostic',
        severity: 'warning',
        message: '1 processed transaction(s) carried SCAM_TOKEN warnings',
        metadata: {
          count: 1,
        },
      },
    ]);
  });
});
