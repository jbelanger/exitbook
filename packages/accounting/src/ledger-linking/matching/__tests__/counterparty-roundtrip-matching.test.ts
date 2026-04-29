import { parseCurrency, parseDecimal } from '@exitbook/foundation';
import { assertErr, assertOk } from '@exitbook/foundation/test-utils';
import { describe, expect, it } from 'vitest';

import {
  buildLedgerLinkingAssetIdentityResolver,
  type LedgerLinkingAssetIdentityAssertion,
} from '../../asset-identity/asset-identity-resolution.js';
import type { LedgerTransferLinkingCandidate } from '../../candidates/candidate-construction.js';
import {
  buildLedgerCounterpartyRoundtripRecognizer,
  buildLedgerCounterpartyRoundtripRelationships,
} from '../counterparty-roundtrip-matching.js';

const ETH = assertOk(parseCurrency('ETH'));
const USDC = assertOk(parseCurrency('USDC'));

describe('buildLedgerCounterpartyRoundtripRelationships', () => {
  it('builds an external-transfer relationship for one strict same-counterparty return flow', () => {
    const result = assertOk(
      buildLedgerCounterpartyRoundtripRelationships(
        [
          makeCandidate({
            candidateId: 1,
            direction: 'source',
            sourceActivityFingerprint: 'source_activity:v1:wallet-to-service',
            journalFingerprint: 'ledger_journal:v1:wallet-to-service',
            postingFingerprint: 'ledger_posting:v1:wallet-to-service',
            activityDatetime: new Date('2026-03-13T00:24:54.000Z'),
            fromAddress: 'Afn6A9Vom27wd8AUYqDf2DyUqYWvA34AFGHqcqCgXvMm',
            toAddress: '5hbEYpnexwWRMDyPS3ZxjCS9dfVjxHJQV6URZ7cJ6QcU',
          }),
          makeCandidate({
            candidateId: 2,
            direction: 'target',
            sourceActivityFingerprint: 'source_activity:v1:service-to-wallet',
            journalFingerprint: 'ledger_journal:v1:service-to-wallet',
            postingFingerprint: 'ledger_posting:v1:service-to-wallet',
            activityDatetime: new Date('2026-03-24T21:41:00.000Z'),
            blockchainTransactionHash: 'target-hash',
            fromAddress: '5hbEYpnexwWRMDyPS3ZxjCS9dfVjxHJQV6URZ7cJ6QcU',
            toAddress: 'Afn6A9Vom27wd8AUYqDf2DyUqYWvA34AFGHqcqCgXvMm',
          }),
        ],
        makeAssetIdentityResolver()
      )
    );

    expect(result.ambiguities).toEqual([]);
    expect(result.matches).toHaveLength(1);
    const relationshipStableKey = result.relationships[0]?.relationshipStableKey;
    expect(relationshipStableKey).toMatch(/^ledger-linking:counterparty_roundtrip:v1:[0-9a-f]{32}$/);
    expect(result.relationships).toEqual([
      {
        allocations: [
          {
            allocationSide: 'source',
            sourceActivityFingerprint: 'source_activity:v1:wallet-to-service',
            journalFingerprint: 'ledger_journal:v1:wallet-to-service',
            postingFingerprint: 'ledger_posting:v1:wallet-to-service',
            quantity: parseDecimal('165'),
          },
          {
            allocationSide: 'target',
            sourceActivityFingerprint: 'source_activity:v1:service-to-wallet',
            journalFingerprint: 'ledger_journal:v1:service-to-wallet',
            postingFingerprint: 'ledger_posting:v1:service-to-wallet',
            quantity: parseDecimal('165'),
          },
        ],
        confidenceScore: parseDecimal('1'),
        evidence: {
          amount: '165',
          assetIdentityReason: 'same_asset_id',
          counterpartyAddress: '5hbEYpnexwWRMDyPS3ZxjCS9dfVjxHJQV6URZ7cJ6QcU',
          platformKey: 'solana',
          selfAddress: 'Afn6A9Vom27wd8AUYqDf2DyUqYWvA34AFGHqcqCgXvMm',
          sourceActivityDatetime: '2026-03-13T00:24:54.000Z',
          sourceBlockchainTransactionHash: 'source-hash',
          sourcePostingFingerprint: 'ledger_posting:v1:wallet-to-service',
          sourceRawFromAddress: 'Afn6A9Vom27wd8AUYqDf2DyUqYWvA34AFGHqcqCgXvMm',
          sourceRawToAddress: '5hbEYpnexwWRMDyPS3ZxjCS9dfVjxHJQV6URZ7cJ6QcU',
          targetActivityDatetime: '2026-03-24T21:41:00.000Z',
          targetBlockchainTransactionHash: 'target-hash',
          targetPostingFingerprint: 'ledger_posting:v1:service-to-wallet',
          targetRawFromAddress: '5hbEYpnexwWRMDyPS3ZxjCS9dfVjxHJQV6URZ7cJ6QcU',
          targetRawToAddress: 'Afn6A9Vom27wd8AUYqDf2DyUqYWvA34AFGHqcqCgXvMm',
          timingHours: '285.268333',
        },
        recognitionStrategy: 'counterparty_roundtrip',
        relationshipStableKey,
        relationshipKind: 'external_transfer',
      },
    ]);
    expect(result.matches[0]).toMatchObject({
      amount: '165',
      counterpartyAddress: '5hbEYpnexwWRMDyPS3ZxjCS9dfVjxHJQV6URZ7cJ6QcU',
      selfAddress: 'Afn6A9Vom27wd8AUYqDf2DyUqYWvA34AFGHqcqCgXvMm',
      sourceCandidateId: 1,
      strategy: 'counterparty_roundtrip',
      targetCandidateId: 2,
      timingHours: '285.268333',
    });
  });

  it('matches hex addresses case-insensitively without lowercasing case-sensitive addresses', () => {
    const hexResult = assertOk(
      buildLedgerCounterpartyRoundtripRelationships(
        [
          makeCandidate({
            candidateId: 1,
            direction: 'source',
            fromAddress: '0xABC123',
            toAddress: '0xF00D',
            platformKey: 'ethereum',
          }),
          makeCandidate({
            candidateId: 2,
            direction: 'target',
            sourceActivityFingerprint: 'source_activity:v1:target',
            journalFingerprint: 'ledger_journal:v1:target',
            postingFingerprint: 'ledger_posting:v1:target',
            fromAddress: '0xf00d',
            toAddress: '0xabc123',
            platformKey: 'ethereum',
          }),
        ],
        makeAssetIdentityResolver()
      )
    );
    expect(hexResult.matches).toHaveLength(1);
    expect(hexResult.matches[0]?.counterpartyAddress).toBe('0xf00d');

    const caseSensitiveResult = assertOk(
      buildLedgerCounterpartyRoundtripRelationships(
        [
          makeCandidate({
            candidateId: 1,
            direction: 'source',
            fromAddress: 'Afn6A9Vom27wd8AUYqDf2DyUqYWvA34AFGHqcqCgXvMm',
            toAddress: '5hbEYpnexwWRMDyPS3ZxjCS9dfVjxHJQV6URZ7cJ6QcU',
          }),
          makeCandidate({
            candidateId: 2,
            direction: 'target',
            sourceActivityFingerprint: 'source_activity:v1:target',
            journalFingerprint: 'ledger_journal:v1:target',
            postingFingerprint: 'ledger_posting:v1:target',
            fromAddress: '5hbeypnexwwrmdyps3zxjcs9dfvjxhjqv6urz7cj6qcu',
            toAddress: 'afn6a9vom27wd8auyqdf2dyuqywva34afghqcqcgxvmm',
          }),
        ],
        makeAssetIdentityResolver()
      )
    );
    expect(caseSensitiveResult.matches).toEqual([]);
  });

  it('requires complete strict roundtrip evidence', () => {
    const result = assertOk(
      buildLedgerCounterpartyRoundtripRelationships(
        [
          makeCandidate({
            candidateId: 1,
            direction: 'source',
            fromAddress: 'user-address',
            toAddress: 'service-a',
          }),
          makeCandidate({
            candidateId: 2,
            direction: 'target',
            sourceActivityFingerprint: 'source_activity:v1:different-counterparty',
            journalFingerprint: 'ledger_journal:v1:different-counterparty',
            postingFingerprint: 'ledger_posting:v1:different-counterparty',
            fromAddress: 'service-b',
            toAddress: 'user-address',
          }),
          makeCandidate({
            candidateId: 3,
            direction: 'target',
            sourceActivityFingerprint: 'source_activity:v1:different-self-address',
            journalFingerprint: 'ledger_journal:v1:different-self-address',
            postingFingerprint: 'ledger_posting:v1:different-self-address',
            fromAddress: 'service-a',
            toAddress: 'different-user-address',
          }),
          makeCandidate({
            candidateId: 4,
            direction: 'target',
            sourceActivityFingerprint: 'source_activity:v1:outside-window',
            journalFingerprint: 'ledger_journal:v1:outside-window',
            postingFingerprint: 'ledger_posting:v1:outside-window',
            activityDatetime: new Date('2026-05-24T21:45:36.000Z'),
            fromAddress: 'service-a',
            toAddress: 'user-address',
          }),
          makeCandidate({
            candidateId: 5,
            direction: 'target',
            sourceActivityFingerprint: 'source_activity:v1:missing-address',
            journalFingerprint: 'ledger_journal:v1:missing-address',
            postingFingerprint: 'ledger_posting:v1:missing-address',
            fromAddress: undefined,
            toAddress: 'user-address',
          }),
        ],
        makeAssetIdentityResolver()
      )
    );

    expect(result.matches).toEqual([]);
    expect(result.relationships).toEqual([]);
    expect(result.ambiguities).toEqual([]);
  });

  it('does not materialize ambiguous one-to-many roundtrips', () => {
    const result = assertOk(
      buildLedgerCounterpartyRoundtripRelationships(
        [
          makeCandidate({
            candidateId: 1,
            direction: 'source',
            fromAddress: 'user-address',
            toAddress: 'service-a',
          }),
          makeCandidate({
            candidateId: 2,
            direction: 'target',
            sourceActivityFingerprint: 'source_activity:v1:first-target',
            journalFingerprint: 'ledger_journal:v1:first-target',
            postingFingerprint: 'ledger_posting:v1:first-target',
            fromAddress: 'service-a',
            toAddress: 'user-address',
          }),
          makeCandidate({
            candidateId: 3,
            direction: 'target',
            sourceActivityFingerprint: 'source_activity:v1:second-target',
            journalFingerprint: 'ledger_journal:v1:second-target',
            postingFingerprint: 'ledger_posting:v1:second-target',
            fromAddress: 'service-a',
            toAddress: 'user-address',
          }),
        ],
        makeAssetIdentityResolver()
      )
    );

    expect(result.matches).toEqual([]);
    expect(result.relationships).toEqual([]);
    expect(result.ambiguities).toEqual([
      {
        candidateId: 1,
        direction: 'source',
        matchingCandidateIds: [2, 3],
        reason: 'multiple_counterparty_roundtrip_counterparts',
      },
    ]);
  });

  it('uses external-transfer scoped asset identity assertions', () => {
    const result = assertOk(
      buildLedgerCounterpartyRoundtripRelationships(
        [
          makeCandidate({
            candidateId: 1,
            direction: 'source',
            assetId: 'blockchain:ethereum:token:usdc-old',
            assetSymbol: USDC,
            platformKey: 'ethereum',
            fromAddress: '0xabc123',
            toAddress: '0xf00d',
          }),
          makeCandidate({
            candidateId: 2,
            direction: 'target',
            sourceActivityFingerprint: 'source_activity:v1:target',
            journalFingerprint: 'ledger_journal:v1:target',
            postingFingerprint: 'ledger_posting:v1:target',
            assetId: 'blockchain:ethereum:token:usdc-new',
            assetSymbol: USDC,
            platformKey: 'ethereum',
            fromAddress: '0xf00d',
            toAddress: '0xabc123',
          }),
        ],
        makeAssetIdentityResolver([
          {
            assetIdA: 'blockchain:ethereum:token:usdc-new',
            assetIdB: 'blockchain:ethereum:token:usdc-old',
            evidenceKind: 'manual',
            relationshipKind: 'external_transfer',
          },
        ])
      )
    );

    expect(result.relationships).toHaveLength(1);
    expect(result.matches[0]).toMatchObject({
      assetIdentityResolution: {
        reason: 'accepted_assertion',
        status: 'accepted',
      },
    });
  });

  it('exposes consumed candidate ids through the deterministic recognizer boundary', () => {
    const recognizer = buildLedgerCounterpartyRoundtripRecognizer(makeAssetIdentityResolver());
    const result = assertOk(
      recognizer.recognize([
        makeCandidate({
          candidateId: 1,
          direction: 'source',
          fromAddress: 'user-address',
          toAddress: 'service-a',
        }),
        makeCandidate({
          candidateId: 2,
          direction: 'target',
          sourceActivityFingerprint: 'source_activity:v1:target',
          journalFingerprint: 'ledger_journal:v1:target',
          postingFingerprint: 'ledger_posting:v1:target',
          fromAddress: 'service-a',
          toAddress: 'user-address',
        }),
      ])
    );

    expect(result.consumedCandidateIds).toEqual([1, 2]);
    expect(result.relationships).toHaveLength(1);
    expect(result.payload.matches).toHaveLength(1);
  });

  it('rejects malformed candidates instead of silently ignoring them', () => {
    const result = buildLedgerCounterpartyRoundtripRelationships(
      [
        makeCandidate({ candidateId: 1 }),
        makeCandidate({ candidateId: 1, postingFingerprint: 'ledger_posting:v1:duplicate' }),
      ],
      makeAssetIdentityResolver()
    );

    expect(assertErr(result).message).toContain('Duplicate ledger linking candidate id 1');
  });
});

function makeAssetIdentityResolver(assertions: readonly LedgerLinkingAssetIdentityAssertion[] = []) {
  return assertOk(buildLedgerLinkingAssetIdentityResolver(assertions));
}

function makeCandidate(
  overrides: Partial<Omit<LedgerTransferLinkingCandidate, 'amount'>> & {
    amount?: string | undefined;
  } = {}
): LedgerTransferLinkingCandidate {
  const { amount, ...candidateOverrides } = overrides;

  return {
    candidateId: 1,
    ownerAccountId: 15,
    sourceActivityFingerprint: 'source_activity:v1:source',
    journalFingerprint: 'ledger_journal:v1:source',
    postingFingerprint: 'ledger_posting:v1:source',
    direction: 'source',
    platformKey: 'solana',
    platformKind: 'blockchain',
    activityDatetime: new Date('2026-03-13T00:24:54.000Z'),
    blockchainTransactionHash: 'source-hash',
    fromAddress: 'user-address',
    toAddress: 'service-address',
    assetId: 'blockchain:solana:Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
    assetSymbol: ETH,
    amount: parseDecimal(amount ?? '165'),
    ...candidateOverrides,
  };
}
