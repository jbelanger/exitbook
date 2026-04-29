import { ok, parseCurrency, parseDecimal, type Result } from '@exitbook/foundation';
import { assertErr, assertOk } from '@exitbook/foundation/test-utils';
import { describe, expect, it } from 'vitest';

import type { LedgerTransferLinkingCandidate } from '../../candidates/candidate-construction.js';
import type { LedgerLinkingRelationshipDraft } from '../../relationships/relationship-materialization.js';
import {
  runLedgerDeterministicRecognizers,
  type LedgerDeterministicCandidateClaim,
  type LedgerDeterministicRecognizer,
  type LedgerDeterministicRecognizerResult,
} from '../deterministic-recognizer-runner.js';

const ETH = assertOk(parseCurrency('ETH'));

describe('runLedgerDeterministicRecognizers', () => {
  it('runs recognizers in order on unclaimed candidates only', () => {
    const seenCandidates: { amount: string; candidateId: number }[][] = [];
    const first = makeRecognizer('first', fullClaims([1, 2]), seenCandidates, [makeRelationship('first')]);
    const second = makeRecognizer('second', fullClaims([3, 4]), seenCandidates, [makeRelationship('second')]);

    const result = assertOk(
      runLedgerDeterministicRecognizers(
        [
          makeCandidate({ candidateId: 1, direction: 'source' }),
          makeCandidate({ candidateId: 2, direction: 'target' }),
          makeCandidate({ candidateId: 3, direction: 'source' }),
          makeCandidate({ candidateId: 4, direction: 'target' }),
        ],
        [first, second]
      )
    );

    expect(seenCandidates).toEqual([
      [
        { amount: '1.25', candidateId: 1 },
        { amount: '1.25', candidateId: 2 },
        { amount: '1.25', candidateId: 3 },
        { amount: '1.25', candidateId: 4 },
      ],
      [
        { amount: '1.25', candidateId: 3 },
        { amount: '1.25', candidateId: 4 },
      ],
    ]);
    expect(result.consumedCandidateIds).toEqual([1, 2, 3, 4]);
    expect(formatClaims(result.candidateClaims)).toEqual([
      { candidateId: 1, quantity: '1.25' },
      { candidateId: 2, quantity: '1.25' },
      { candidateId: 3, quantity: '1.25' },
      { candidateId: 4, quantity: '1.25' },
    ]);
    expect(result.relationships.map((relationship) => relationship.relationshipStableKey)).toEqual([
      'relationship:first',
      'relationship:second',
    ]);
    expect(result.runs).toMatchObject([
      {
        consumedCandidateIds: [1, 2],
        name: 'first',
        relationshipCount: 1,
      },
      {
        consumedCandidateIds: [3, 4],
        name: 'second',
        relationshipCount: 1,
      },
    ]);
  });

  it('passes remaining candidate quantities to later recognizers', () => {
    const seenCandidates: { amount: string; candidateId: number }[][] = [];
    const first = makeRecognizer('first', [{ candidateId: 1, quantity: parseDecimal('1') }], seenCandidates);
    const second = makeRecognizer('second', [{ candidateId: 1, quantity: parseDecimal('2') }], seenCandidates);

    const result = assertOk(
      runLedgerDeterministicRecognizers(
        [makeCandidate({ amount: '3', candidateId: 1, direction: 'source' })],
        [first, second]
      )
    );

    expect(seenCandidates).toEqual([[{ amount: '3', candidateId: 1 }], [{ amount: '2', candidateId: 1 }]]);
    expect(formatClaims(result.candidateClaims)).toEqual([
      { candidateId: 1, quantity: '1' },
      { candidateId: 1, quantity: '2' },
    ]);
    expect(result.runs).toMatchObject([
      {
        consumedCandidateIds: [],
        name: 'first',
      },
      {
        consumedCandidateIds: [1],
        name: 'second',
      },
    ]);
    expect(result.consumedCandidateIds).toEqual([1]);
  });

  it('rejects overclaims from one recognizer', () => {
    const result = runLedgerDeterministicRecognizers(
      [makeCandidate({ candidateId: 1, direction: 'source' })],
      [
        makeRecognizer('overclaim', [
          { candidateId: 1, quantity: parseDecimal('1') },
          { candidateId: 1, quantity: parseDecimal('1') },
        ]),
      ]
    );

    expect(assertErr(result).message).toContain('overclaimed candidate 1');
  });

  it('rejects unavailable candidate claims instead of silently double-consuming candidates', () => {
    const first = makeRecognizer('first', fullClaims([1]));
    const second = makeRecognizer('second', fullClaims([1]));

    const result = runLedgerDeterministicRecognizers(
      [makeCandidate({ candidateId: 1, direction: 'source' }), makeCandidate({ candidateId: 2, direction: 'target' })],
      [first, second]
    );

    expect(assertErr(result).message).toContain('claimed unavailable candidate 1');
  });
});

function makeRecognizer(
  name: string,
  candidateClaims: readonly LedgerDeterministicCandidateClaim[],
  seenCandidates: { amount: string; candidateId: number }[][] = [],
  relationships: readonly LedgerLinkingRelationshipDraft[] = []
): LedgerDeterministicRecognizer<string> {
  return {
    name,
    recognize(candidates): Result<LedgerDeterministicRecognizerResult<string>, Error> {
      seenCandidates.push(
        candidates.map((candidate) => ({
          amount: candidate.amount.toFixed(),
          candidateId: candidate.candidateId,
        }))
      );
      return ok({
        candidateClaims,
        payload: name,
        relationships,
      });
    },
  };
}

function fullClaims(candidateIds: readonly number[]): LedgerDeterministicCandidateClaim[] {
  return candidateIds.map((candidateId) => ({
    candidateId,
    quantity: parseDecimal('1.25'),
  }));
}

function formatClaims(
  claims: readonly LedgerDeterministicCandidateClaim[]
): { candidateId: number; quantity: string }[] {
  return claims.map((claim) => ({
    candidateId: claim.candidateId,
    quantity: claim.quantity.toFixed(),
  }));
}

function makeRelationship(suffix: string): LedgerLinkingRelationshipDraft {
  return {
    allocations: [
      {
        allocationSide: 'source',
        sourceActivityFingerprint: `source_activity:v1:${suffix}:source`,
        journalFingerprint: `ledger_journal:v1:${suffix}:source`,
        postingFingerprint: `ledger_posting:v1:${suffix}:source`,
        quantity: parseDecimal('1'),
      },
      {
        allocationSide: 'target',
        sourceActivityFingerprint: `source_activity:v1:${suffix}:target`,
        journalFingerprint: `ledger_journal:v1:${suffix}:target`,
        postingFingerprint: `ledger_posting:v1:${suffix}:target`,
        quantity: parseDecimal('1'),
      },
    ],
    confidenceScore: parseDecimal('1'),
    evidence: { suffix },
    recognitionStrategy: 'test_recognizer',
    relationshipStableKey: `relationship:${suffix}`,
    relationshipKind: 'internal_transfer',
  };
}

function makeCandidate(
  overrides: Partial<Omit<LedgerTransferLinkingCandidate, 'amount'>> & { amount?: string | undefined }
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
    blockchainTransactionHash: '0xabc123',
    fromAddress: '0xfrom',
    toAddress: '0xto',
    assetId: 'blockchain:ethereum:native',
    assetSymbol: ETH,
    amount: parseDecimal(amount ?? '1.25'),
    ...candidateOverrides,
  };
}
