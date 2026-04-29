import { err, ok, parseCurrency, parseDecimal } from '@exitbook/foundation';
import { assertErr, assertOk } from '@exitbook/foundation/test-utils';
import { describe, expect, it } from 'vitest';

import type { LedgerLinkingAssetIdentityAssertion } from '../../asset-identity/asset-identity-resolution.js';
import type { LedgerLinkingPostingInput } from '../../candidates/candidate-construction.js';
import type { LedgerLinkingRelationshipDraft } from '../../relationships/relationship-materialization.js';
import { runLedgerLinking, type LedgerLinkingRunPorts } from '../ledger-linking-runner.js';

const ETH = assertOk(parseCurrency('ETH'));

describe('runLedgerLinking', () => {
  it('loads ledger postings, recognizes exact-hash transfers, and materializes accepted relationships', async () => {
    const harness = makeHarness([
      makePosting({
        ownerAccountId: 1,
        sourceActivityFingerprint: 'source_activity:v1:ethereum-wallet-outflow',
        journalFingerprint: 'ledger_journal:v1:ethereum-wallet-outflow',
        postingFingerprint: 'ledger_posting:v1:ethereum-wallet-outflow',
        quantity: '-1.25',
        platformKey: 'ethereum',
        platformKind: 'blockchain',
        blockchainTransactionHash: '0xabc123',
      }),
      makePosting({
        ownerAccountId: 2,
        sourceActivityFingerprint: 'source_activity:v1:ethereum-wallet-inflow',
        journalFingerprint: 'ledger_journal:v1:ethereum-wallet-inflow',
        postingFingerprint: 'ledger_posting:v1:ethereum-wallet-inflow',
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
      deterministicRecognizerStats: [
        {
          consumedCandidateCount: 2,
          name: 'exact_hash_transfer',
          relationshipCount: 1,
        },
        {
          consumedCandidateCount: 0,
          name: 'same_hash_grouped_transfer',
          relationshipCount: 0,
        },
        {
          consumedCandidateCount: 0,
          name: 'counterparty_roundtrip',
          relationshipCount: 0,
        },
      ],
      matchedSourceCandidateCount: 1,
      matchedTargetCandidateCount: 1,
      postingInputCount: 3,
      sourceCandidateCount: 1,
      targetCandidateCount: 1,
      transferCandidateCount: 2,
      unmatchedSourceCandidateCount: 0,
      unmatchedTargetCandidateCount: 0,
    });
    expect(result.skippedCandidates).toEqual([
      {
        postingFingerprint: 'ledger_posting:v1:fee',
        reason: 'non_principal_role',
      },
    ]);
    expect(result.assetIdentitySuggestions).toEqual([]);
    expect(result.exactHashAmbiguities).toEqual([]);
    expect(result.exactHashAssetIdentityBlocks).toEqual([]);
    expect(result.exactHashMatches).toHaveLength(1);
    expect(result.sameHashGroupedMatches).toEqual([]);
    expect(result.sameHashGroupedUnresolvedGroups).toEqual([]);
    expect(result.counterpartyRoundtripMatches).toEqual([]);
    expect(result.counterpartyRoundtripAmbiguities).toEqual([]);
    expect(result.persistence).toEqual({
      mode: 'persisted',
      materialization: {
        previousCount: 0,
        resolvedAllocationCount: 2,
        savedCount: 1,
        unresolvedAllocationCount: 0,
      },
    });
    expect(harness.savedRelationships).toEqual([
      [
        {
          allocations: [
            {
              allocationSide: 'source',
              sourceActivityFingerprint: 'source_activity:v1:ethereum-wallet-outflow',
              journalFingerprint: 'ledger_journal:v1:ethereum-wallet-outflow',
              postingFingerprint: 'ledger_posting:v1:ethereum-wallet-outflow',
              quantity: parseDecimal('1.25'),
            },
            {
              allocationSide: 'target',
              sourceActivityFingerprint: 'source_activity:v1:ethereum-wallet-inflow',
              journalFingerprint: 'ledger_journal:v1:ethereum-wallet-inflow',
              postingFingerprint: 'ledger_posting:v1:ethereum-wallet-inflow',
              quantity: parseDecimal('1.25'),
            },
          ],
          confidenceScore: parseDecimal('1'),
          evidence: {
            amount: '1.25',
            assetIdentityReason: 'same_asset_id',
            sourceAssetId: 'blockchain:ethereum:native',
            sourceBlockchainTransactionHash: '0xabc123',
            sourcePostingFingerprint: 'ledger_posting:v1:ethereum-wallet-outflow',
            targetAssetId: 'blockchain:ethereum:native',
            targetBlockchainTransactionHash: '0xABC123',
            targetPostingFingerprint: 'ledger_posting:v1:ethereum-wallet-inflow',
          },
          recognitionStrategy: 'exact_hash_transfer',
          relationshipStableKey: result.acceptedRelationships[0]?.relationshipStableKey,
          relationshipKind: 'internal_transfer',
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
    expect(result).toMatchObject({
      deterministicRecognizerStats: [
        {
          consumedCandidateCount: 0,
          name: 'exact_hash_transfer',
          relationshipCount: 0,
        },
        {
          consumedCandidateCount: 0,
          name: 'same_hash_grouped_transfer',
          relationshipCount: 0,
        },
        {
          consumedCandidateCount: 0,
          name: 'counterparty_roundtrip',
          relationshipCount: 0,
        },
      ],
      matchedSourceCandidateCount: 0,
      matchedTargetCandidateCount: 0,
      unmatchedSourceCandidateCount: 1,
      unmatchedTargetCandidateCount: 2,
    });
    expect(result.exactHashAmbiguities).toEqual([
      {
        candidateId: 1,
        direction: 'source',
        matchingCandidateIds: [2, 3],
        reason: 'multiple_exact_hash_counterparts',
      },
    ]);
    expect(result.counterpartyRoundtripMatches).toEqual([]);
    expect(result.counterpartyRoundtripAmbiguities).toEqual([]);
    expect(result.sameHashGroupedMatches).toEqual([]);
    expect(result.sameHashGroupedUnresolvedGroups).toEqual([
      {
        assetSymbol: ETH,
        normalizedBlockchainTransactionHash: '0xabc123',
        reason: 'partial_amount_ambiguous',
        sourceAmount: '1',
        sourceCandidateIds: [1],
        targetAmount: '2',
        targetCandidateIds: [2, 3],
      },
    ]);
    expect(result.acceptedRelationships).toEqual([]);
    expect(result.persistence).toEqual({
      mode: 'persisted',
      materialization: {
        previousCount: 2,
        resolvedAllocationCount: 0,
        savedCount: 0,
        unresolvedAllocationCount: 0,
      },
    });
    expect(harness.savedRelationships).toEqual([[]]);
  });

  it('reports exact-hash asset identity blocks without materializing them', async () => {
    const harness = makeHarness([
      makePosting({
        ownerAccountId: 1,
        sourceActivityFingerprint: 'source_activity:v1:kraken-withdrawal',
        journalFingerprint: 'ledger_journal:v1:kraken-withdrawal',
        postingFingerprint: 'ledger_posting:v1:kraken-withdrawal',
        quantity: '-1.25',
        platformKey: 'kraken',
        platformKind: 'exchange',
        assetId: 'exchange:kraken:eth',
      }),
      makePosting({
        ownerAccountId: 2,
        sourceActivityFingerprint: 'source_activity:v1:ethereum-deposit',
        journalFingerprint: 'ledger_journal:v1:ethereum-deposit',
        postingFingerprint: 'ledger_posting:v1:ethereum-deposit',
        quantity: '1.25',
        platformKey: 'ethereum',
        platformKind: 'blockchain',
        assetId: 'blockchain:ethereum:native',
      }),
    ]);

    const result = assertOk(await runLedgerLinking(1, harness.ports));

    expect(result.acceptedRelationships).toEqual([]);
    expect(result.exactHashMatches).toEqual([]);
    expect(result).toMatchObject({
      matchedSourceCandidateCount: 0,
      matchedTargetCandidateCount: 0,
      unmatchedSourceCandidateCount: 1,
      unmatchedTargetCandidateCount: 1,
    });
    expect(result.exactHashAssetIdentityBlocks).toEqual([
      {
        amount: '1.25',
        assetSymbol: ETH,
        reason: 'same_symbol_different_asset_ids',
        sourceAssetId: 'exchange:kraken:eth',
        sourceBlockchainTransactionHash: '0xabc123',
        sourceCandidateId: 1,
        sourcePostingFingerprint: 'ledger_posting:v1:kraken-withdrawal',
        targetAssetId: 'blockchain:ethereum:native',
        targetBlockchainTransactionHash: '0xabc123',
        targetCandidateId: 2,
        targetPostingFingerprint: 'ledger_posting:v1:ethereum-deposit',
      },
    ]);
    expect(result.sameHashGroupedMatches).toEqual([]);
    expect(result.sameHashGroupedUnresolvedGroups).toEqual([
      {
        assetSymbol: ETH,
        normalizedBlockchainTransactionHash: '0xabc123',
        reason: 'asset_identity_blocked',
        sourceAmount: '1.25',
        sourceCandidateIds: [1],
        targetAmount: '1.25',
        targetCandidateIds: [2],
      },
    ]);
    expect(result.assetIdentitySuggestions).toEqual([
      {
        assetIdA: 'blockchain:ethereum:native',
        assetIdB: 'exchange:kraken:eth',
        assetSymbol: ETH,
        blockCount: 1,
        examples: [
          {
            amount: '1.25',
            sourceBlockchainTransactionHash: '0xabc123',
            sourcePostingFingerprint: 'ledger_posting:v1:kraken-withdrawal',
            targetBlockchainTransactionHash: '0xabc123',
            targetPostingFingerprint: 'ledger_posting:v1:ethereum-deposit',
          },
        ],
        relationshipKind: 'internal_transfer',
      },
    ]);
    expect(result.persistence).toEqual({
      mode: 'persisted',
      materialization: {
        previousCount: 0,
        resolvedAllocationCount: 0,
        savedCount: 0,
        unresolvedAllocationCount: 0,
      },
    });
    expect(harness.savedRelationships).toEqual([[]]);
  });

  it('uses accepted asset identity assertions to materialize exact-hash exchange-chain transfers', async () => {
    const harness = makeHarness(
      [
        makePosting({
          ownerAccountId: 1,
          sourceActivityFingerprint: 'source_activity:v1:kraken-withdrawal',
          journalFingerprint: 'ledger_journal:v1:kraken-withdrawal',
          postingFingerprint: 'ledger_posting:v1:kraken-withdrawal',
          quantity: '-1.25',
          platformKey: 'kraken',
          platformKind: 'exchange',
          assetId: 'exchange:kraken:eth',
        }),
        makePosting({
          ownerAccountId: 2,
          sourceActivityFingerprint: 'source_activity:v1:ethereum-deposit',
          journalFingerprint: 'ledger_journal:v1:ethereum-deposit',
          postingFingerprint: 'ledger_posting:v1:ethereum-deposit',
          quantity: '1.25',
          platformKey: 'ethereum',
          platformKind: 'blockchain',
          assetId: 'blockchain:ethereum:native',
        }),
      ],
      {
        assetIdentityAssertions: [
          {
            assetIdA: 'exchange:kraken:eth',
            assetIdB: 'blockchain:ethereum:native',
            evidenceKind: 'manual',
            relationshipKind: 'internal_transfer',
          },
        ],
      }
    );

    const result = assertOk(await runLedgerLinking(1, harness.ports));

    expect(result.acceptedRelationships).toHaveLength(1);
    expect(result.exactHashAssetIdentityBlocks).toEqual([]);
    expect(result.exactHashMatches[0]).toMatchObject({
      assetIdentityResolution: {
        assertion: {
          assetIdA: 'blockchain:ethereum:native',
          assetIdB: 'exchange:kraken:eth',
          evidenceKind: 'manual',
          relationshipKind: 'internal_transfer',
        },
        reason: 'accepted_assertion',
        status: 'accepted',
      },
      sourceAssetId: 'exchange:kraken:eth',
      targetAssetId: 'blockchain:ethereum:native',
    });
    expect(harness.savedRelationships).toHaveLength(1);
  });

  it('materializes strict same-hash grouped transfers after exact-hash matching', async () => {
    const harness = makeHarness([
      makePosting({
        ownerAccountId: 1,
        sourceActivityFingerprint: 'source_activity:v1:exchange-withdrawal',
        journalFingerprint: 'ledger_journal:v1:exchange-withdrawal',
        postingFingerprint: 'ledger_posting:v1:exchange-withdrawal',
        quantity: '-3',
      }),
      makePosting({
        ownerAccountId: 2,
        sourceActivityFingerprint: 'source_activity:v1:first-chain-deposit',
        journalFingerprint: 'ledger_journal:v1:first-chain-deposit',
        postingFingerprint: 'ledger_posting:v1:first-chain-deposit',
        quantity: '1',
      }),
      makePosting({
        ownerAccountId: 3,
        sourceActivityFingerprint: 'source_activity:v1:second-chain-deposit',
        journalFingerprint: 'ledger_journal:v1:second-chain-deposit',
        postingFingerprint: 'ledger_posting:v1:second-chain-deposit',
        quantity: '2',
      }),
    ]);

    const result = assertOk(await runLedgerLinking(1, harness.ports));

    expect(result.exactHashMatches).toEqual([]);
    expect(result.sameHashGroupedMatches).toHaveLength(1);
    expect(result).toMatchObject({
      deterministicRecognizerStats: [
        {
          consumedCandidateCount: 0,
          name: 'exact_hash_transfer',
          relationshipCount: 0,
        },
        {
          consumedCandidateCount: 3,
          name: 'same_hash_grouped_transfer',
          relationshipCount: 1,
        },
        {
          consumedCandidateCount: 0,
          name: 'counterparty_roundtrip',
          relationshipCount: 0,
        },
      ],
      matchedSourceCandidateCount: 1,
      matchedTargetCandidateCount: 2,
      unmatchedSourceCandidateCount: 0,
      unmatchedTargetCandidateCount: 0,
    });
    expect(result.acceptedRelationships[0]).toMatchObject({
      relationshipKind: 'same_hash_carryover',
      allocations: [
        {
          allocationSide: 'source',
          sourceActivityFingerprint: 'source_activity:v1:exchange-withdrawal',
          quantity: parseDecimal('3'),
        },
        {
          allocationSide: 'target',
          sourceActivityFingerprint: 'source_activity:v1:first-chain-deposit',
          quantity: parseDecimal('1'),
        },
        {
          allocationSide: 'target',
          sourceActivityFingerprint: 'source_activity:v1:second-chain-deposit',
          quantity: parseDecimal('2'),
        },
      ],
    });
    expect(result.persistence).toEqual({
      mode: 'persisted',
      materialization: {
        previousCount: 0,
        resolvedAllocationCount: 3,
        savedCount: 1,
        unresolvedAllocationCount: 0,
      },
    });
    expect(harness.savedRelationships).toEqual([result.acceptedRelationships]);
  });

  it('materializes strict counterparty roundtrips after hash-based recognizers', async () => {
    const harness = makeHarness([
      makePosting({
        ownerAccountId: 15,
        sourceActivityFingerprint: 'source_activity:v1:wallet-to-service',
        journalFingerprint: 'ledger_journal:v1:wallet-to-service',
        postingFingerprint: 'ledger_posting:v1:wallet-to-service',
        quantity: '-165',
        platformKey: 'solana',
        platformKind: 'blockchain',
        blockchainTransactionHash: 'source-hash',
        fromAddress: 'user-address',
        toAddress: 'service-address',
      }),
      makePosting({
        ownerAccountId: 15,
        sourceActivityFingerprint: 'source_activity:v1:service-to-wallet',
        journalFingerprint: 'ledger_journal:v1:service-to-wallet',
        postingFingerprint: 'ledger_posting:v1:service-to-wallet',
        quantity: '165',
        platformKey: 'solana',
        platformKind: 'blockchain',
        activityDatetime: new Date('2026-04-23T12:00:00.000Z'),
        blockchainTransactionHash: 'target-hash',
        fromAddress: 'service-address',
        toAddress: 'user-address',
      }),
    ]);

    const result = assertOk(await runLedgerLinking(1, harness.ports));

    expect(result.exactHashMatches).toEqual([]);
    expect(result.sameHashGroupedMatches).toEqual([]);
    expect(result.counterpartyRoundtripMatches).toHaveLength(1);
    expect(result).toMatchObject({
      deterministicRecognizerStats: [
        {
          consumedCandidateCount: 0,
          name: 'exact_hash_transfer',
          relationshipCount: 0,
        },
        {
          consumedCandidateCount: 0,
          name: 'same_hash_grouped_transfer',
          relationshipCount: 0,
        },
        {
          consumedCandidateCount: 2,
          name: 'counterparty_roundtrip',
          relationshipCount: 1,
        },
      ],
      matchedSourceCandidateCount: 1,
      matchedTargetCandidateCount: 1,
      unmatchedSourceCandidateCount: 0,
      unmatchedTargetCandidateCount: 0,
    });
    expect(result.acceptedRelationships[0]).toMatchObject({
      recognitionStrategy: 'counterparty_roundtrip',
      relationshipKind: 'external_transfer',
      allocations: [
        {
          allocationSide: 'source',
          sourceActivityFingerprint: 'source_activity:v1:wallet-to-service',
          quantity: parseDecimal('165'),
        },
        {
          allocationSide: 'target',
          sourceActivityFingerprint: 'source_activity:v1:service-to-wallet',
          quantity: parseDecimal('165'),
        },
      ],
    });
    expect(result.persistence).toEqual({
      mode: 'persisted',
      materialization: {
        previousCount: 0,
        resolvedAllocationCount: 2,
        savedCount: 1,
        unresolvedAllocationCount: 0,
      },
    });
    expect(harness.savedRelationships).toEqual([result.acceptedRelationships]);
  });

  it('can preview accepted relationships without replacing persisted relationships', async () => {
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
        previousCount: 5,
      }
    );

    const result = assertOk(await runLedgerLinking(1, harness.ports, { dryRun: true }));

    expect(result.acceptedRelationships).toHaveLength(1);
    expect(result).toMatchObject({
      matchedSourceCandidateCount: 1,
      matchedTargetCandidateCount: 1,
      unmatchedSourceCandidateCount: 0,
      unmatchedTargetCandidateCount: 0,
    });
    expect(result.persistence).toEqual({
      mode: 'dry_run',
      plannedRelationshipCount: 1,
    });
    expect(harness.savedRelationships).toEqual([]);
  });

  it('can include read-only unmatched diagnostics in dry-run mode', async () => {
    const harness = makeHarness([
      makePosting({
        ownerAccountId: 1,
        sourceActivityFingerprint: 'source_activity:v1:source',
        journalFingerprint: 'ledger_journal:v1:source',
        postingFingerprint: 'ledger_posting:v1:source',
        quantity: '-1',
        blockchainTransactionHash: 'source-hash',
      }),
      makePosting({
        ownerAccountId: 2,
        sourceActivityFingerprint: 'source_activity:v1:target',
        journalFingerprint: 'ledger_journal:v1:target',
        postingFingerprint: 'ledger_posting:v1:target',
        quantity: '1',
        activityDatetime: new Date('2026-04-23T00:30:00.000Z'),
        blockchainTransactionHash: 'target-hash',
      }),
    ]);

    const result = assertOk(
      await runLedgerLinking(1, harness.ports, {
        amountTimeProposalWindowMinutes: 60,
        dryRun: true,
        includeDiagnostics: true,
      })
    );

    expect(result.acceptedRelationships).toEqual([]);
    expect(result.diagnostics?.unmatchedCandidates.map((candidate) => candidate.candidateId)).toEqual([1, 2]);
    expect(result.diagnostics?.amountTimeProposals).toHaveLength(1);
    expect(result.diagnostics?.amountTimeProposals[0]).toMatchObject({
      amount: '1',
      source: {
        candidateId: 1,
        platformKey: 'ethereum',
      },
      target: {
        candidateId: 2,
        platformKey: 'ethereum',
      },
      timeDistanceSeconds: 1800,
      uniqueness: 'unique_pair',
    });
    expect(result.persistence).toEqual({
      mode: 'dry_run',
      plannedRelationshipCount: 0,
    });
    expect(harness.savedRelationships).toEqual([]);
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
  assetIdentityAssertions?: readonly LedgerLinkingAssetIdentityAssertion[] | undefined;
  previousCount?: number | undefined;
  storeError?: Error | undefined;
}

function makeHarness(postings: readonly LedgerLinkingPostingInput[], options: HarnessOptions = {}) {
  const loadedProfileIds: number[] = [];
  const savedRelationships: LedgerLinkingRelationshipDraft[][] = [];

  const ports: LedgerLinkingRunPorts = {
    assetIdentityAssertionReader: {
      async loadLedgerLinkingAssetIdentityAssertions() {
        return ok([...(options.assetIdentityAssertions ?? [])]);
      },
    },
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
          resolvedAllocationCount: relationships.reduce(
            (sum, relationship) => sum + relationship.allocations.length,
            0
          ),
          savedCount: relationships.length,
          unresolvedAllocationCount: 0,
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
