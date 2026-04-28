import { ok, parseCurrency, parseDecimal, type Result } from '@exitbook/foundation';
import { assertErr, assertOk } from '@exitbook/foundation/test-utils';
import { describe, expect, it } from 'vitest';

import type { LedgerTransferLinkingCandidate } from '../../candidates/candidate-construction.js';
import type { LedgerLinkingRelationshipDraft } from '../../relationships/relationship-materialization.js';
import {
  runLedgerDeterministicRecognizers,
  type LedgerDeterministicRecognizer,
  type LedgerDeterministicRecognizerResult,
} from '../deterministic-recognizer-runner.js';

const ETH = assertOk(parseCurrency('ETH'));

describe('runLedgerDeterministicRecognizers', () => {
  it('runs recognizers in order on unclaimed candidates only', () => {
    const seenCandidateIds: number[][] = [];
    const first = makeRecognizer('first', [1, 2], seenCandidateIds, [makeRelationship('first')]);
    const second = makeRecognizer('second', [3, 4], seenCandidateIds, [makeRelationship('second')]);

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

    expect(seenCandidateIds).toEqual([
      [1, 2, 3, 4],
      [3, 4],
    ]);
    expect(result.consumedCandidateIds).toEqual([1, 2, 3, 4]);
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

  it('rejects duplicate claims from one recognizer', () => {
    const result = runLedgerDeterministicRecognizers(
      [makeCandidate({ candidateId: 1, direction: 'source' })],
      [makeRecognizer('duplicate', [1, 1])]
    );

    expect(assertErr(result).message).toContain('claimed candidate 1 more than once');
  });

  it('rejects unavailable candidate claims instead of silently double-consuming candidates', () => {
    const first = makeRecognizer('first', [1]);
    const second = makeRecognizer('second', [1]);

    const result = runLedgerDeterministicRecognizers(
      [makeCandidate({ candidateId: 1, direction: 'source' }), makeCandidate({ candidateId: 2, direction: 'target' })],
      [first, second]
    );

    expect(assertErr(result).message).toContain('claimed unavailable candidate 1');
  });
});

function makeRecognizer(
  name: string,
  consumedCandidateIds: readonly number[],
  seenCandidateIds: number[][] = [],
  relationships: readonly LedgerLinkingRelationshipDraft[] = []
): LedgerDeterministicRecognizer<string> {
  return {
    name,
    recognize(candidates): Result<LedgerDeterministicRecognizerResult<string>, Error> {
      seenCandidateIds.push(candidates.map((candidate) => candidate.candidateId));
      return ok({
        consumedCandidateIds,
        payload: name,
        relationships,
      });
    },
  };
}

function makeRelationship(suffix: string): LedgerLinkingRelationshipDraft {
  return {
    relationshipStableKey: `relationship:${suffix}`,
    relationshipKind: 'internal_transfer',
    source: {
      sourceActivityFingerprint: `source_activity:v1:${suffix}:source`,
      journalFingerprint: `ledger_journal:v1:${suffix}:source`,
      postingFingerprint: `ledger_posting:v1:${suffix}:source`,
    },
    target: {
      sourceActivityFingerprint: `source_activity:v1:${suffix}:target`,
      journalFingerprint: `ledger_journal:v1:${suffix}:target`,
      postingFingerprint: `ledger_posting:v1:${suffix}:target`,
    },
  };
}

function makeCandidate(overrides: Partial<LedgerTransferLinkingCandidate>): LedgerTransferLinkingCandidate {
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
    amount: parseDecimal('1.25'),
    ...overrides,
  };
}
