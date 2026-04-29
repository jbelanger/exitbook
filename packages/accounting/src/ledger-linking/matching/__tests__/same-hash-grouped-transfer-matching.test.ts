import { parseCurrency, parseDecimal } from '@exitbook/foundation';
import { assertErr, assertOk } from '@exitbook/foundation/test-utils';
import { describe, expect, it } from 'vitest';

import { buildLedgerLinkingAssetIdentityResolver } from '../../asset-identity/asset-identity-resolution.js';
import type { LedgerTransferLinkingCandidate } from '../../candidates/candidate-construction.js';
import {
  buildLedgerSameHashGroupedTransferRecognizer,
  buildLedgerSameHashGroupedTransferRelationships,
} from '../same-hash-grouped-transfer-matching.js';

const ETH = assertOk(parseCurrency('ETH'));
const USDC = assertOk(parseCurrency('USDC'));

describe('buildLedgerSameHashGroupedTransferRelationships', () => {
  it('builds a same-hash carryover relationship for a strict balanced group', () => {
    const candidates = [
      makeCandidate({
        candidateId: 1,
        direction: 'source',
        postingFingerprint: 'ledger_posting:v1:source',
        amount: '3',
        ownerAccountId: 1,
      }),
      makeCandidate({
        candidateId: 2,
        direction: 'target',
        sourceActivityFingerprint: 'source_activity:v1:first-target',
        journalFingerprint: 'ledger_journal:v1:first-target',
        postingFingerprint: 'ledger_posting:v1:first-target',
        amount: '1',
        ownerAccountId: 2,
      }),
      makeCandidate({
        candidateId: 3,
        direction: 'target',
        sourceActivityFingerprint: 'source_activity:v1:second-target',
        journalFingerprint: 'ledger_journal:v1:second-target',
        postingFingerprint: 'ledger_posting:v1:second-target',
        amount: '2',
        ownerAccountId: 3,
      }),
    ];

    const result = assertOk(buildLedgerSameHashGroupedTransferRelationships(candidates, makeAssetIdentityResolver()));

    expect(result.unresolvedGroups).toEqual([]);
    expect(result.matches).toHaveLength(1);
    const relationshipStableKey = result.relationships[0]?.relationshipStableKey;
    expect(relationshipStableKey).toMatch(/^ledger-linking:same_hash_grouped_transfer:v1:[0-9a-f]{32}$/);
    expect(result.relationships).toEqual([
      {
        allocations: [
          {
            allocationSide: 'source',
            sourceActivityFingerprint: 'source_activity:v1:source',
            journalFingerprint: 'ledger_journal:v1:source',
            postingFingerprint: 'ledger_posting:v1:source',
            quantity: parseDecimal('3'),
          },
          {
            allocationSide: 'target',
            sourceActivityFingerprint: 'source_activity:v1:first-target',
            journalFingerprint: 'ledger_journal:v1:first-target',
            postingFingerprint: 'ledger_posting:v1:first-target',
            quantity: parseDecimal('1'),
          },
          {
            allocationSide: 'target',
            sourceActivityFingerprint: 'source_activity:v1:second-target',
            journalFingerprint: 'ledger_journal:v1:second-target',
            postingFingerprint: 'ledger_posting:v1:second-target',
            quantity: parseDecimal('2'),
          },
        ],
        confidenceScore: parseDecimal('1'),
        evidence: {
          assetSymbol: ETH,
          normalizedBlockchainTransactionHash: '0xabc123',
          sourceAmount: '3',
          sourceAssetIds: ['blockchain:ethereum:native'],
          sourcePostingFingerprints: ['ledger_posting:v1:source'],
          targetAmount: '3',
          targetAssetIds: ['blockchain:ethereum:native'],
          targetPostingFingerprints: ['ledger_posting:v1:first-target', 'ledger_posting:v1:second-target'],
        },
        recognitionStrategy: 'same_hash_grouped_transfer',
        relationshipStableKey,
        relationshipKind: 'same_hash_carryover',
      },
    ]);
    expect(result.matches[0]).toMatchObject({
      amount: '3',
      assetSymbol: ETH,
      normalizedBlockchainTransactionHash: '0xabc123',
      sourceAssetIds: ['blockchain:ethereum:native'],
      sourceCandidateIds: [1],
      sourcePostingFingerprints: ['ledger_posting:v1:source'],
      strategy: 'same_hash_grouped_transfer',
      targetAssetIds: ['blockchain:ethereum:native'],
      targetCandidateIds: [2, 3],
      targetPostingFingerprints: ['ledger_posting:v1:first-target', 'ledger_posting:v1:second-target'],
    });
  });

  it('uses accepted asset identity assertions across exchange and chain asset ids', () => {
    const assetIdentityResolver = makeAssetIdentityResolver([
      {
        assetIdA: 'exchange:kucoin:usdc',
        assetIdB: 'blockchain:ethereum:token:usdc',
        evidenceKind: 'manual',
        relationshipKind: 'internal_transfer',
      },
    ]);
    const result = assertOk(
      buildLedgerSameHashGroupedTransferRelationships(
        [
          makeCandidate({
            candidateId: 1,
            direction: 'source',
            postingFingerprint: 'ledger_posting:v1:kucoin-withdrawal',
            amount: '3',
            assetId: 'exchange:kucoin:usdc',
            assetSymbol: USDC,
            ownerAccountId: 1,
            platformKey: 'kucoin',
            platformKind: 'exchange',
          }),
          makeCandidate({
            candidateId: 2,
            direction: 'target',
            sourceActivityFingerprint: 'source_activity:v1:first-chain-deposit',
            journalFingerprint: 'ledger_journal:v1:first-chain-deposit',
            postingFingerprint: 'ledger_posting:v1:first-chain-deposit',
            amount: '1',
            assetId: 'blockchain:ethereum:token:usdc',
            assetSymbol: USDC,
            ownerAccountId: 2,
          }),
          makeCandidate({
            candidateId: 3,
            direction: 'target',
            sourceActivityFingerprint: 'source_activity:v1:second-chain-deposit',
            journalFingerprint: 'ledger_journal:v1:second-chain-deposit',
            postingFingerprint: 'ledger_posting:v1:second-chain-deposit',
            amount: '2',
            assetId: 'blockchain:ethereum:token:usdc',
            assetSymbol: USDC,
            ownerAccountId: 3,
          }),
        ],
        assetIdentityResolver
      )
    );

    expect(result.relationships).toHaveLength(1);
    expect(result.unresolvedGroups).toEqual([]);
    expect(result.matches[0]).toMatchObject({
      sourceAssetIds: ['exchange:kucoin:usdc'],
      targetAssetIds: ['blockchain:ethereum:token:usdc'],
    });
  });

  it('leaves partial same-hash groups unresolved until residual quantities are modeled', () => {
    const result = assertOk(
      buildLedgerSameHashGroupedTransferRelationships(
        [
          makeCandidate({
            candidateId: 1,
            direction: 'source',
            postingFingerprint: 'ledger_posting:v1:source',
            amount: '3',
            ownerAccountId: 1,
          }),
          makeCandidate({
            candidateId: 2,
            direction: 'target',
            sourceActivityFingerprint: 'source_activity:v1:first-target',
            journalFingerprint: 'ledger_journal:v1:first-target',
            postingFingerprint: 'ledger_posting:v1:first-target',
            amount: '1',
            ownerAccountId: 2,
          }),
          makeCandidate({
            candidateId: 3,
            direction: 'target',
            sourceActivityFingerprint: 'source_activity:v1:second-target',
            journalFingerprint: 'ledger_journal:v1:second-target',
            postingFingerprint: 'ledger_posting:v1:second-target',
            amount: '1.5',
            ownerAccountId: 3,
          }),
        ],
        makeAssetIdentityResolver()
      )
    );

    expect(result.relationships).toEqual([]);
    expect(result.matches).toEqual([]);
    expect(result.unresolvedGroups).toEqual([
      {
        assetSymbol: ETH,
        normalizedBlockchainTransactionHash: '0xabc123',
        reason: 'unbalanced_amounts',
        sourceAmount: '3',
        sourceCandidateIds: [1],
        targetAmount: '2.5',
        targetCandidateIds: [2, 3],
      },
    ]);
  });

  it('leaves one-to-one same-hash pairs for the exact-hash recognizer', () => {
    const result = assertOk(
      buildLedgerSameHashGroupedTransferRelationships(
        [
          makeCandidate({
            candidateId: 1,
            direction: 'source',
            amount: '1',
            ownerAccountId: 1,
          }),
          makeCandidate({
            candidateId: 2,
            direction: 'target',
            sourceActivityFingerprint: 'source_activity:v1:target',
            journalFingerprint: 'ledger_journal:v1:target',
            postingFingerprint: 'ledger_posting:v1:target',
            amount: '1',
            ownerAccountId: 2,
          }),
        ],
        makeAssetIdentityResolver()
      )
    );

    expect(result.relationships).toEqual([]);
    expect(result.unresolvedGroups).toEqual([
      {
        assetSymbol: ETH,
        normalizedBlockchainTransactionHash: '0xabc123',
        reason: 'single_pair',
        sourceAmount: '1',
        sourceCandidateIds: [1],
        targetAmount: '1',
        targetCandidateIds: [2],
      },
    ]);
  });

  it('does not group candidates with blank blockchain transaction hashes', () => {
    const result = assertOk(
      buildLedgerSameHashGroupedTransferRelationships(
        [
          makeCandidate({
            candidateId: 1,
            direction: 'source',
            amount: '3',
            blockchainTransactionHash: ' ',
            ownerAccountId: 1,
          }),
          makeCandidate({
            candidateId: 2,
            direction: 'target',
            sourceActivityFingerprint: 'source_activity:v1:first-target',
            journalFingerprint: 'ledger_journal:v1:first-target',
            postingFingerprint: 'ledger_posting:v1:first-target',
            amount: '1',
            blockchainTransactionHash: '',
            ownerAccountId: 2,
          }),
          makeCandidate({
            candidateId: 3,
            direction: 'target',
            sourceActivityFingerprint: 'source_activity:v1:second-target',
            journalFingerprint: 'ledger_journal:v1:second-target',
            postingFingerprint: 'ledger_posting:v1:second-target',
            amount: '2',
            blockchainTransactionHash: undefined,
            ownerAccountId: 3,
          }),
        ],
        makeAssetIdentityResolver()
      )
    );

    expect(result.matches).toEqual([]);
    expect(result.relationships).toEqual([]);
    expect(result.unresolvedGroups).toEqual([]);
  });

  it('exposes consumed candidate ids through the deterministic recognizer boundary', () => {
    const recognizer = buildLedgerSameHashGroupedTransferRecognizer(makeAssetIdentityResolver());
    const result = assertOk(
      recognizer.recognize([
        makeCandidate({
          candidateId: 1,
          direction: 'source',
          postingFingerprint: 'ledger_posting:v1:source',
          amount: '3',
          ownerAccountId: 1,
        }),
        makeCandidate({
          candidateId: 2,
          direction: 'target',
          sourceActivityFingerprint: 'source_activity:v1:first-target',
          journalFingerprint: 'ledger_journal:v1:first-target',
          postingFingerprint: 'ledger_posting:v1:first-target',
          amount: '1',
          ownerAccountId: 2,
        }),
        makeCandidate({
          candidateId: 3,
          direction: 'target',
          sourceActivityFingerprint: 'source_activity:v1:second-target',
          journalFingerprint: 'ledger_journal:v1:second-target',
          postingFingerprint: 'ledger_posting:v1:second-target',
          amount: '2',
          ownerAccountId: 3,
        }),
      ])
    );

    expect(result.consumedCandidateIds).toEqual([1, 2, 3]);
    expect(result.relationships).toHaveLength(1);
  });

  it('rejects malformed candidates instead of silently ignoring them', () => {
    const result = buildLedgerSameHashGroupedTransferRelationships(
      [makeCandidate({ candidateId: 1 }), makeCandidate({ candidateId: 1 })],
      makeAssetIdentityResolver()
    );

    expect(assertErr(result).message).toContain('Duplicate ledger linking candidate id 1');
  });
});

function makeAssetIdentityResolver(assertions: Parameters<typeof buildLedgerLinkingAssetIdentityResolver>[0] = []) {
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
    ownerAccountId: 1,
    sourceActivityFingerprint: 'source_activity:v1:source',
    journalFingerprint: 'ledger_journal:v1:source',
    postingFingerprint: 'ledger_posting:v1:source',
    direction: 'source',
    platformKey: 'ethereum',
    platformKind: 'blockchain',
    activityDatetime: new Date('2026-04-23T00:00:00.000Z'),
    blockchainTransactionHash: '0xABC123-819',
    fromAddress: '0xfrom',
    toAddress: '0xto',
    assetId: 'blockchain:ethereum:native',
    assetSymbol: ETH,
    amount: parseDecimal(amount ?? '1'),
    ...candidateOverrides,
  };
}
