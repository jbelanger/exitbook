import { err, ok, parseCurrency, parseDecimal } from '@exitbook/foundation';
import { assertErr, assertOk } from '@exitbook/foundation/test-utils';
import { describe, expect, it } from 'vitest';

import type { LedgerLinkingPostingInput } from '../../candidates/candidate-construction.js';
import type { LedgerLinkingRelationshipDraft } from '../../relationships/relationship-materialization.js';
import { runLedgerLinking, type LedgerLinkingRunPorts } from '../ledger-linking-runner.js';

const ETH = assertOk(parseCurrency('ETH'));

describe('runLedgerLinking', () => {
  it('loads ledger postings, recognizes exact-hash transfers, and materializes accepted relationships', async () => {
    const harness = makeHarness([
      makePosting({
        ownerAccountId: 1,
        sourceActivityFingerprint: 'source_activity:v1:kraken-withdrawal',
        journalFingerprint: 'ledger_journal:v1:kraken-withdrawal',
        postingFingerprint: 'ledger_posting:v1:kraken-withdrawal',
        quantity: '-1.25',
        platformKey: 'kraken',
        platformKind: 'exchange',
        blockchainTransactionHash: '0xabc123',
      }),
      makePosting({
        ownerAccountId: 2,
        sourceActivityFingerprint: 'source_activity:v1:ethereum-deposit',
        journalFingerprint: 'ledger_journal:v1:ethereum-deposit',
        postingFingerprint: 'ledger_posting:v1:ethereum-deposit',
        quantity: '1.25',
        platformKey: 'ethereum',
        platformKind: 'blockchain',
        blockchainTransactionHash: '0xABC123',
      }),
      makePosting({
        postingFingerprint: 'ledger_posting:v1:fee',
        quantity: '-0.01',
        role: 'fee',
      }),
    ]);

    const result = assertOk(await runLedgerLinking(1, harness.ports));

    expect(result).toMatchObject({
      postingInputCount: 3,
      transferCandidateCount: 2,
      sourceCandidateCount: 1,
      targetCandidateCount: 1,
    });
    expect(result.skippedCandidates).toEqual([
      {
        postingFingerprint: 'ledger_posting:v1:fee',
        reason: 'non_principal_role',
      },
    ]);
    expect(result.exactHashAmbiguities).toEqual([]);
    expect(result.exactHashMatches).toHaveLength(1);
    expect(result.materialization).toEqual({
      previousCount: 0,
      resolvedEndpointCount: 2,
      savedCount: 1,
      unresolvedEndpointCount: 0,
    });
    expect(harness.savedRelationships).toEqual([
      [
        {
          relationshipStableKey: result.acceptedRelationships[0]?.relationshipStableKey,
          relationshipKind: 'internal_transfer',
          source: {
            sourceActivityFingerprint: 'source_activity:v1:kraken-withdrawal',
            journalFingerprint: 'ledger_journal:v1:kraken-withdrawal',
            postingFingerprint: 'ledger_posting:v1:kraken-withdrawal',
          },
          target: {
            sourceActivityFingerprint: 'source_activity:v1:ethereum-deposit',
            journalFingerprint: 'ledger_journal:v1:ethereum-deposit',
            postingFingerprint: 'ledger_posting:v1:ethereum-deposit',
          },
        },
      ],
    ]);
  });

  it('does not materialize ambiguous exact-hash groups', async () => {
    const harness = makeHarness(
      [
        makePosting({
          ownerAccountId: 1,
          postingFingerprint: 'ledger_posting:v1:source',
          quantity: '-1',
        }),
        makePosting({
          ownerAccountId: 2,
          sourceActivityFingerprint: 'source_activity:v1:first-target',
          journalFingerprint: 'ledger_journal:v1:first-target',
          postingFingerprint: 'ledger_posting:v1:first-target',
          quantity: '1',
        }),
        makePosting({
          ownerAccountId: 3,
          sourceActivityFingerprint: 'source_activity:v1:second-target',
          journalFingerprint: 'ledger_journal:v1:second-target',
          postingFingerprint: 'ledger_posting:v1:second-target',
          quantity: '1',
        }),
      ],
      {
        previousCount: 2,
      }
    );

    const result = assertOk(await runLedgerLinking(1, harness.ports));

    expect(result.exactHashMatches).toEqual([]);
    expect(result.exactHashAmbiguities).toEqual([
      {
        candidateId: 1,
        direction: 'source',
        matchingCandidateIds: [2, 3],
        reason: 'multiple_exact_hash_counterparts',
      },
    ]);
    expect(result.acceptedRelationships).toEqual([]);
    expect(result.materialization).toEqual({
      previousCount: 2,
      resolvedEndpointCount: 0,
      savedCount: 0,
      unresolvedEndpointCount: 0,
    });
    expect(harness.savedRelationships).toEqual([[]]);
  });

  it('returns persistence failures without swallowing them', async () => {
    const harness = makeHarness(
      [
        makePosting({ ownerAccountId: 1, quantity: '-1' }),
        makePosting({
          ownerAccountId: 2,
          sourceActivityFingerprint: 'source_activity:v1:target',
          journalFingerprint: 'ledger_journal:v1:target',
          postingFingerprint: 'ledger_posting:v1:target',
          quantity: '1',
        }),
      ],
      {
        storeError: new Error('relationship table unavailable'),
      }
    );

    const result = await runLedgerLinking(1, harness.ports);

    expect(assertErr(result).message).toBe('relationship table unavailable');
    expect(harness.savedRelationships).toHaveLength(1);
  });

  it('rejects invalid profile ids before loading postings', async () => {
    const harness = makeHarness([]);

    const result = await runLedgerLinking(0, harness.ports);

    expect(assertErr(result).message).toContain('Profile id must be a positive integer');
    expect(harness.loadedProfileIds).toEqual([]);
    expect(harness.savedRelationships).toEqual([]);
  });
});

interface HarnessOptions {
  previousCount?: number | undefined;
  storeError?: Error | undefined;
}

function makeHarness(postings: readonly LedgerLinkingPostingInput[], options: HarnessOptions = {}) {
  const loadedProfileIds: number[] = [];
  const savedRelationships: LedgerLinkingRelationshipDraft[][] = [];

  const ports: LedgerLinkingRunPorts = {
    candidateSourceReader: {
      async loadLedgerLinkingPostingInputs(profileId) {
        loadedProfileIds.push(profileId);
        return ok([...postings]);
      },
    },
    relationshipStore: {
      async replaceLedgerLinkingRelationships(_profileId, relationships) {
        savedRelationships.push([...relationships]);
        if (options.storeError !== undefined) {
          return err(options.storeError);
        }

        return ok({
          previousCount: options.previousCount ?? 0,
          resolvedEndpointCount: relationships.length * 2,
          savedCount: relationships.length,
          unresolvedEndpointCount: 0,
        });
      },
    },
  };

  return {
    loadedProfileIds,
    ports,
    savedRelationships,
  };
}

function makePosting(
  overrides: Partial<Omit<LedgerLinkingPostingInput, 'quantity'>> & {
    quantity?: string | undefined;
  } = {}
): LedgerLinkingPostingInput {
  const { quantity, ...postingOverrides } = overrides;

  return {
    ownerAccountId: 1,
    sourceActivityFingerprint: 'source_activity:v1:source',
    journalFingerprint: 'ledger_journal:v1:source',
    journalKind: 'transfer',
    postingFingerprint: 'ledger_posting:v1:source',
    platformKey: 'ethereum',
    platformKind: 'blockchain',
    activityDatetime: new Date('2026-04-23T00:00:00.000Z'),
    blockchainTransactionHash: '0xabc123',
    fromAddress: '0xfrom',
    toAddress: '0xto',
    assetId: 'blockchain:ethereum:native',
    assetSymbol: ETH,
    quantity: parseDecimal(quantity ?? '-1'),
    role: 'principal',
    balanceCategory: 'liquid',
    ...postingOverrides,
  };
}
