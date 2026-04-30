import { parseCurrency, parseDecimal } from '@exitbook/foundation';
import { assertErr, assertOk } from '@exitbook/foundation/test-utils';
import { describe, expect, it } from 'vitest';

import { buildLedgerLinkingAssetIdentityResolver } from '../../asset-identity/asset-identity-resolution.js';
import type { LedgerTransferLinkingCandidate } from '../../candidates/candidate-construction.js';
import {
  buildLedgerStrictExchangeAmountTimeTransferRecognizer,
  buildLedgerStrictExchangeAmountTimeTransferRelationships,
} from '../strict-exchange-amount-time-transfer-matching.js';

const ETH = assertOk(parseCurrency('ETH'));
const USDC = assertOk(parseCurrency('USDC'));

describe('buildLedgerStrictExchangeAmountTimeTransferRelationships', () => {
  it('builds an internal-transfer relationship for one strict exchange amount/time pair', () => {
    const assetIdentityResolver = assertOk(
      buildLedgerLinkingAssetIdentityResolver([
        {
          assetIdA: 'exchange:kraken:eth',
          assetIdB: 'blockchain:ethereum:native',
          evidenceKind: 'manual',
          relationshipKind: 'internal_transfer',
        },
      ])
    );

    const result = assertOk(
      buildLedgerStrictExchangeAmountTimeTransferRelationships(
        [
          makeCandidate({
            assetId: 'exchange:kraken:eth',
            candidateId: 1,
            direction: 'source',
            journalFingerprint: 'ledger_journal:v1:kraken-withdrawal',
            platformKey: 'kraken',
            platformKind: 'exchange',
            postingFingerprint: 'ledger_posting:v1:kraken-withdrawal',
            sourceActivityFingerprint: 'source_activity:v1:kraken-withdrawal',
          }),
          makeCandidate({
            activityDatetime: new Date('2026-04-23T00:30:00.000Z'),
            assetId: 'blockchain:ethereum:native',
            candidateId: 2,
            direction: 'target',
            journalFingerprint: 'ledger_journal:v1:ethereum-deposit',
            ownerAccountId: 2,
            postingFingerprint: 'ledger_posting:v1:ethereum-deposit',
            sourceActivityFingerprint: 'source_activity:v1:ethereum-deposit',
          }),
        ],
        assetIdentityResolver
      )
    );

    expect(result.ambiguities).toEqual([]);
    expect(result.matches).toHaveLength(1);
    const relationshipStableKey = result.relationships[0]?.relationshipStableKey;
    expect(relationshipStableKey).toMatch(/^ledger-linking:strict_exchange_amount_time_transfer:v1:[0-9a-f]{32}$/);
    expect(result.relationships).toEqual([
      {
        allocations: [
          {
            allocationSide: 'source',
            journalFingerprint: 'ledger_journal:v1:kraken-withdrawal',
            postingFingerprint: 'ledger_posting:v1:kraken-withdrawal',
            quantity: parseDecimal('1.25'),
            sourceActivityFingerprint: 'source_activity:v1:kraken-withdrawal',
          },
          {
            allocationSide: 'target',
            journalFingerprint: 'ledger_journal:v1:ethereum-deposit',
            postingFingerprint: 'ledger_posting:v1:ethereum-deposit',
            quantity: parseDecimal('1.25'),
            sourceActivityFingerprint: 'source_activity:v1:ethereum-deposit',
          },
        ],
        confidenceScore: parseDecimal('1'),
        evidence: {
          amount: '1.25',
          assetIdentityEvidenceKind: 'manual',
          assetIdentityReason: 'accepted_assertion',
          assetSymbol: ETH,
          sourceActivityDatetime: '2026-04-23T00:00:00.000Z',
          sourceAssetId: 'exchange:kraken:eth',
          sourcePlatformKey: 'kraken',
          sourcePlatformKind: 'exchange',
          sourcePostingFingerprint: 'ledger_posting:v1:kraken-withdrawal',
          targetActivityDatetime: '2026-04-23T00:30:00.000Z',
          targetAssetId: 'blockchain:ethereum:native',
          targetPlatformKey: 'ethereum',
          targetPlatformKind: 'blockchain',
          targetPostingFingerprint: 'ledger_posting:v1:ethereum-deposit',
          timeDistanceSeconds: 1800,
        },
        recognitionStrategy: 'strict_exchange_amount_time_transfer',
        relationshipKind: 'internal_transfer',
        relationshipStableKey,
      },
    ]);
    expect(result.matches[0]).toMatchObject({
      amount: '1.25',
      assetIdentityResolution: {
        reason: 'accepted_assertion',
        status: 'accepted',
      },
      assetSymbol: ETH,
      sourceCandidateId: 1,
      sourcePlatformKey: 'kraken',
      sourcePlatformKind: 'exchange',
      strategy: 'strict_exchange_amount_time_transfer',
      targetCandidateId: 2,
      targetPlatformKey: 'ethereum',
      targetPlatformKind: 'blockchain',
      timeDistanceSeconds: 1800,
    });
  });

  it('accepts tiny display-precision truncation when the pair is otherwise strict', () => {
    const assetIdentityResolver = assertOk(
      buildLedgerLinkingAssetIdentityResolver([
        {
          assetIdA: 'exchange:kraken:usdc',
          assetIdB: 'exchange:kucoin:usdc',
          evidenceKind: 'manual',
          relationshipKind: 'internal_transfer',
        },
      ])
    );

    const result = assertOk(
      buildLedgerStrictExchangeAmountTimeTransferRelationships(
        [
          makeCandidate({
            amount: '270.7758064',
            assetId: 'exchange:kraken:usdc',
            assetSymbol: USDC,
            candidateId: 1,
            direction: 'source',
            journalFingerprint: 'ledger_journal:v1:kraken-withdrawal',
            platformKey: 'kraken',
            platformKind: 'exchange',
            postingFingerprint: 'ledger_posting:v1:kraken-withdrawal',
            sourceActivityFingerprint: 'source_activity:v1:kraken-withdrawal',
          }),
          makeCandidate({
            activityDatetime: new Date('2026-04-23T00:04:00.000Z'),
            amount: '270.775806',
            assetId: 'exchange:kucoin:usdc',
            assetSymbol: USDC,
            candidateId: 2,
            direction: 'target',
            journalFingerprint: 'ledger_journal:v1:kucoin-deposit',
            ownerAccountId: 2,
            platformKey: 'kucoin',
            platformKind: 'exchange',
            postingFingerprint: 'ledger_posting:v1:kucoin-deposit',
            sourceActivityFingerprint: 'source_activity:v1:kucoin-deposit',
          }),
        ],
        assetIdentityResolver
      )
    );

    expect(result.matches[0]).toMatchObject({
      amount: '270.775806',
      amountMatchKind: 'precision_truncated',
      sourceCandidateId: 1,
      targetCandidateId: 2,
    });
    expect(result.relationships[0]?.allocations).toEqual([
      {
        allocationSide: 'source',
        journalFingerprint: 'ledger_journal:v1:kraken-withdrawal',
        postingFingerprint: 'ledger_posting:v1:kraken-withdrawal',
        quantity: parseDecimal('270.7758064'),
        sourceActivityFingerprint: 'source_activity:v1:kraken-withdrawal',
      },
      {
        allocationSide: 'target',
        journalFingerprint: 'ledger_journal:v1:kucoin-deposit',
        postingFingerprint: 'ledger_posting:v1:kucoin-deposit',
        quantity: parseDecimal('270.775806'),
        sourceActivityFingerprint: 'source_activity:v1:kucoin-deposit',
      },
    ]);
    expect(result.relationships[0]?.evidence).toMatchObject({
      amount: '270.775806',
      amountDifference: '0.0000004',
      amountMatchKind: 'precision_truncated',
      normalizedAmount: '270.775806',
      normalizedDecimalPlaces: 6,
      sourceAmount: '270.7758064',
      targetAmount: '270.775806',
    });
  });

  it('does not match loose amount/time shapes', () => {
    const assetIdentityResolver = assertOk(
      buildLedgerLinkingAssetIdentityResolver([
        {
          assetIdA: 'exchange:kraken:eth',
          assetIdB: 'blockchain:ethereum:native',
          evidenceKind: 'manual',
          relationshipKind: 'internal_transfer',
        },
      ])
    );
    const source = makeCandidate({
      assetId: 'exchange:kraken:eth',
      candidateId: 1,
      direction: 'source',
      platformKey: 'kraken',
      platformKind: 'exchange',
      postingFingerprint: 'ledger_posting:v1:source',
      sourceActivityFingerprint: 'source_activity:v1:source',
    });

    const result = assertOk(
      buildLedgerStrictExchangeAmountTimeTransferRelationships(
        [
          source,
          makeCandidate({
            activityDatetime: new Date('2026-04-23T01:00:01.000Z'),
            assetId: 'blockchain:ethereum:native',
            candidateId: 2,
            direction: 'target',
            ownerAccountId: 2,
            postingFingerprint: 'ledger_posting:v1:after-window',
            sourceActivityFingerprint: 'source_activity:v1:after-window',
          }),
          makeCandidate({
            activityDatetime: new Date('2026-04-22T23:59:00.000Z'),
            assetId: 'blockchain:ethereum:native',
            candidateId: 3,
            direction: 'target',
            ownerAccountId: 2,
            postingFingerprint: 'ledger_posting:v1:target-before-source',
            sourceActivityFingerprint: 'source_activity:v1:target-before-source',
          }),
          makeCandidate({
            activityDatetime: new Date('2026-04-23T00:30:00.000Z'),
            assetId: 'exchange:kraken:eth',
            candidateId: 4,
            direction: 'target',
            ownerAccountId: 2,
            platformKey: 'coinbase',
            platformKind: 'exchange',
            postingFingerprint: 'ledger_posting:v1:same-asset-id-only',
            sourceActivityFingerprint: 'source_activity:v1:same-asset-id-only',
          }),
          makeCandidate({
            activityDatetime: new Date('2026-04-23T00:30:00.000Z'),
            assetId: 'blockchain:polygon:native',
            candidateId: 5,
            direction: 'target',
            ownerAccountId: 3,
            platformKey: 'polygon',
            platformKind: 'blockchain',
            postingFingerprint: 'ledger_posting:v1:missing-assertion',
            sourceActivityFingerprint: 'source_activity:v1:missing-assertion',
          }),
          makeCandidate({
            activityDatetime: new Date('2026-04-23T00:30:00.000Z'),
            assetId: 'exchange:kraken:eth',
            candidateId: 6,
            direction: 'target',
            ownerAccountId: 1,
            platformKey: 'kraken',
            platformKind: 'exchange',
            postingFingerprint: 'ledger_posting:v1:same-platform',
            sourceActivityFingerprint: 'source_activity:v1:same-platform',
          }),
          makeCandidate({
            activityDatetime: new Date('2026-04-23T00:30:00.000Z'),
            amount: '1.24',
            assetId: 'blockchain:ethereum:native',
            candidateId: 7,
            direction: 'target',
            ownerAccountId: 2,
            postingFingerprint: 'ledger_posting:v1:different-amount',
            sourceActivityFingerprint: 'source_activity:v1:different-amount',
          }),
          makeCandidate({
            activityDatetime: new Date('2026-04-23T00:30:00.000Z'),
            assetId: 'blockchain:ethereum:native',
            assetSymbol: USDC,
            candidateId: 8,
            direction: 'target',
            ownerAccountId: 2,
            postingFingerprint: 'ledger_posting:v1:different-symbol',
            sourceActivityFingerprint: 'source_activity:v1:different-symbol',
          }),
        ],
        assetIdentityResolver
      )
    );

    expect(result.matches).toEqual([]);
    expect(result.relationships).toEqual([]);
    expect(result.ambiguities).toEqual([]);
  });

  it('does not treat low-precision amount differences as display truncation', () => {
    const assetIdentityResolver = assertOk(
      buildLedgerLinkingAssetIdentityResolver([
        {
          assetIdA: 'exchange:kraken:eth',
          assetIdB: 'blockchain:ethereum:native',
          evidenceKind: 'manual',
          relationshipKind: 'internal_transfer',
        },
      ])
    );

    const result = assertOk(
      buildLedgerStrictExchangeAmountTimeTransferRelationships(
        [
          makeCandidate({
            amount: '1.25',
            assetId: 'exchange:kraken:eth',
            candidateId: 1,
            direction: 'source',
            platformKey: 'kraken',
            platformKind: 'exchange',
            postingFingerprint: 'ledger_posting:v1:source',
            sourceActivityFingerprint: 'source_activity:v1:source',
          }),
          makeCandidate({
            activityDatetime: new Date('2026-04-23T00:30:00.000Z'),
            amount: '1.2',
            assetId: 'blockchain:ethereum:native',
            candidateId: 2,
            direction: 'target',
            ownerAccountId: 2,
            postingFingerprint: 'ledger_posting:v1:target',
            sourceActivityFingerprint: 'source_activity:v1:target',
          }),
        ],
        assetIdentityResolver
      )
    );

    expect(result.matches).toEqual([]);
    expect(result.relationships).toEqual([]);
    expect(result.ambiguities).toEqual([]);
  });

  it('leaves amount/time pairs unresolved when the counterpart is ambiguous', () => {
    const assetIdentityResolver = assertOk(
      buildLedgerLinkingAssetIdentityResolver([
        {
          assetIdA: 'exchange:kraken:eth',
          assetIdB: 'blockchain:ethereum:native',
          evidenceKind: 'manual',
          relationshipKind: 'internal_transfer',
        },
      ])
    );

    const result = assertOk(
      buildLedgerStrictExchangeAmountTimeTransferRelationships(
        [
          makeCandidate({
            assetId: 'exchange:kraken:eth',
            candidateId: 1,
            direction: 'source',
            platformKey: 'kraken',
            platformKind: 'exchange',
            postingFingerprint: 'ledger_posting:v1:source',
            sourceActivityFingerprint: 'source_activity:v1:source',
          }),
          makeCandidate({
            activityDatetime: new Date('2026-04-23T00:30:00.000Z'),
            assetId: 'blockchain:ethereum:native',
            candidateId: 2,
            direction: 'target',
            ownerAccountId: 2,
            postingFingerprint: 'ledger_posting:v1:first-target',
            sourceActivityFingerprint: 'source_activity:v1:first-target',
          }),
          makeCandidate({
            activityDatetime: new Date('2026-04-23T00:45:00.000Z'),
            assetId: 'blockchain:ethereum:native',
            candidateId: 3,
            direction: 'target',
            ownerAccountId: 3,
            postingFingerprint: 'ledger_posting:v1:second-target',
            sourceActivityFingerprint: 'source_activity:v1:second-target',
          }),
        ],
        assetIdentityResolver
      )
    );

    expect(result.matches).toEqual([]);
    expect(result.relationships).toEqual([]);
    expect(result.ambiguities).toEqual([
      {
        candidateId: 1,
        direction: 'source',
        matchingCandidateIds: [2, 3],
        reason: 'multiple_strict_exchange_amount_time_counterparts',
      },
    ]);
  });

  it('uses precision-truncated amount pairs when checking broader uniqueness', () => {
    const assetIdentityResolver = assertOk(
      buildLedgerLinkingAssetIdentityResolver([
        {
          assetIdA: 'exchange:kraken:usdc',
          assetIdB: 'exchange:kucoin:usdc',
          evidenceKind: 'manual',
          relationshipKind: 'internal_transfer',
        },
      ])
    );

    const result = assertOk(
      buildLedgerStrictExchangeAmountTimeTransferRelationships(
        [
          makeCandidate({
            amount: '270.7758064',
            assetId: 'exchange:kraken:usdc',
            assetSymbol: USDC,
            candidateId: 1,
            direction: 'source',
            platformKey: 'kraken',
            platformKind: 'exchange',
            postingFingerprint: 'ledger_posting:v1:source',
            sourceActivityFingerprint: 'source_activity:v1:source',
          }),
          makeCandidate({
            activityDatetime: new Date('2026-04-23T00:04:00.000Z'),
            amount: '270.775806',
            assetId: 'exchange:kucoin:usdc',
            assetSymbol: USDC,
            candidateId: 2,
            direction: 'target',
            ownerAccountId: 2,
            platformKey: 'kucoin',
            platformKind: 'exchange',
            postingFingerprint: 'ledger_posting:v1:first-target',
            sourceActivityFingerprint: 'source_activity:v1:first-target',
          }),
          makeCandidate({
            activityDatetime: new Date('2026-04-23T00:45:00.000Z'),
            amount: '270.775806',
            assetId: 'exchange:kucoin:usdc',
            assetSymbol: USDC,
            candidateId: 3,
            direction: 'target',
            ownerAccountId: 3,
            platformKey: 'kucoin',
            platformKind: 'exchange',
            postingFingerprint: 'ledger_posting:v1:second-target',
            sourceActivityFingerprint: 'source_activity:v1:second-target',
          }),
        ],
        assetIdentityResolver
      )
    );

    expect(result.matches).toEqual([]);
    expect(result.relationships).toEqual([]);
    expect(result.ambiguities).toEqual([
      {
        candidateId: 1,
        direction: 'source',
        matchingCandidateIds: [2, 3],
        reason: 'multiple_strict_exchange_amount_time_counterparts',
      },
    ]);
  });

  it('requires broader amount/time uniqueness before materializing a strict pair', () => {
    const assetIdentityResolver = assertOk(
      buildLedgerLinkingAssetIdentityResolver([
        {
          assetIdA: 'exchange:kraken:eth',
          assetIdB: 'blockchain:ethereum:native',
          evidenceKind: 'manual',
          relationshipKind: 'internal_transfer',
        },
      ])
    );

    const result = assertOk(
      buildLedgerStrictExchangeAmountTimeTransferRelationships(
        [
          makeCandidate({
            assetId: 'exchange:kraken:eth',
            candidateId: 1,
            direction: 'source',
            platformKey: 'kraken',
            platformKind: 'exchange',
            postingFingerprint: 'ledger_posting:v1:kraken-source',
            sourceActivityFingerprint: 'source_activity:v1:kraken-source',
          }),
          makeCandidate({
            activityDatetime: new Date('2026-04-23T00:30:00.000Z'),
            assetId: 'blockchain:ethereum:native',
            candidateId: 2,
            direction: 'target',
            ownerAccountId: 2,
            postingFingerprint: 'ledger_posting:v1:chain-target',
            sourceActivityFingerprint: 'source_activity:v1:chain-target',
          }),
          makeCandidate({
            activityDatetime: new Date('2026-04-23T01:30:00.000Z'),
            assetId: 'blockchain:ethereum:native',
            candidateId: 3,
            direction: 'source',
            ownerAccountId: 3,
            postingFingerprint: 'ledger_posting:v1:chain-source',
            sourceActivityFingerprint: 'source_activity:v1:chain-source',
          }),
        ],
        assetIdentityResolver
      )
    );

    expect(result.matches).toEqual([]);
    expect(result.relationships).toEqual([]);
    expect(result.ambiguities).toEqual([
      {
        candidateId: 2,
        direction: 'target',
        matchingCandidateIds: [1, 3],
        reason: 'multiple_strict_exchange_amount_time_counterparts',
      },
    ]);
  });

  it('rejects invalid dates instead of silently skipping candidates', () => {
    const assetIdentityResolver = assertOk(
      buildLedgerLinkingAssetIdentityResolver([
        {
          assetIdA: 'exchange:kraken:eth',
          assetIdB: 'blockchain:ethereum:native',
          evidenceKind: 'manual',
          relationshipKind: 'internal_transfer',
        },
      ])
    );

    const result = buildLedgerStrictExchangeAmountTimeTransferRelationships(
      [
        makeCandidate({
          activityDatetime: new Date('invalid'),
          assetId: 'exchange:kraken:eth',
          candidateId: 1,
          direction: 'source',
          platformKey: 'kraken',
          platformKind: 'exchange',
          postingFingerprint: 'ledger_posting:v1:invalid-source-date',
          sourceActivityFingerprint: 'source_activity:v1:invalid-source-date',
        }),
        makeCandidate({
          assetId: 'blockchain:ethereum:native',
          candidateId: 2,
          direction: 'target',
          ownerAccountId: 2,
          postingFingerprint: 'ledger_posting:v1:target',
          sourceActivityFingerprint: 'source_activity:v1:target',
        }),
      ],
      assetIdentityResolver
    );

    expect(assertErr(result).message).toContain(
      'Strict exchange amount/time source candidate 1 has invalid activity datetime'
    );
  });
});

describe('buildLedgerStrictExchangeAmountTimeTransferRecognizer', () => {
  it('claims full quantities for strict exchange amount/time matches', () => {
    const assetIdentityResolver = assertOk(
      buildLedgerLinkingAssetIdentityResolver([
        {
          assetIdA: 'exchange:kraken:eth',
          assetIdB: 'blockchain:ethereum:native',
          evidenceKind: 'manual',
          relationshipKind: 'internal_transfer',
        },
      ])
    );
    const recognizer = buildLedgerStrictExchangeAmountTimeTransferRecognizer(assetIdentityResolver);
    const result = assertOk(
      recognizer.recognize([
        makeCandidate({
          assetId: 'exchange:kraken:eth',
          candidateId: 1,
          direction: 'source',
          platformKey: 'kraken',
          platformKind: 'exchange',
          postingFingerprint: 'ledger_posting:v1:source',
          sourceActivityFingerprint: 'source_activity:v1:source',
        }),
        makeCandidate({
          activityDatetime: new Date('2026-04-23T00:30:00.000Z'),
          assetId: 'blockchain:ethereum:native',
          candidateId: 2,
          direction: 'target',
          ownerAccountId: 2,
          postingFingerprint: 'ledger_posting:v1:target',
          sourceActivityFingerprint: 'source_activity:v1:target',
        }),
      ])
    );

    expect(
      result.candidateClaims.map((claim) => ({ candidateId: claim.candidateId, quantity: claim.quantity.toFixed() }))
    ).toEqual([
      { candidateId: 1, quantity: '1.25' },
      { candidateId: 2, quantity: '1.25' },
    ]);
    expect(result.relationships).toHaveLength(1);
    expect(result.payload.matches).toHaveLength(1);
  });
});

function makeCandidate(
  overrides: Partial<Omit<LedgerTransferLinkingCandidate, 'amount'>> & {
    amount?: string | undefined;
  } = {}
): LedgerTransferLinkingCandidate {
  const { amount, ...candidateOverrides } = overrides;

  return {
    activityDatetime: new Date('2026-04-23T00:00:00.000Z'),
    amount: parseDecimal(amount ?? '1.25'),
    assetId: 'blockchain:ethereum:native',
    assetSymbol: ETH,
    blockchainTransactionHash: undefined,
    candidateId: 1,
    direction: 'source',
    fromAddress: undefined,
    journalFingerprint: 'ledger_journal:v1:source',
    ownerAccountId: 1,
    platformKey: 'ethereum',
    platformKind: 'blockchain',
    postingFingerprint: 'ledger_posting:v1:source',
    sourceActivityFingerprint: 'source_activity:v1:source',
    toAddress: undefined,
    ...candidateOverrides,
  };
}
