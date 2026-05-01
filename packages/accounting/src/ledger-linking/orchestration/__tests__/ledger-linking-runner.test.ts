import { err, ok, parseCurrency, parseDecimal } from '@exitbook/foundation';
import { assertErr, assertOk } from '@exitbook/foundation/test-utils';
import { describe, expect, it } from 'vitest';

import type { LedgerLinkingAssetIdentityAssertion } from '../../asset-identity/asset-identity-resolution.js';
import type { LedgerLinkingPostingInput } from '../../candidates/candidate-construction.js';
import type { LedgerLinkingReviewedRelationshipOverride } from '../../matching/reviewed-relationship-override-matching.js';
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
          name: 'fee_adjusted_exact_hash_transfer',
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
        {
          consumedCandidateCount: 0,
          name: 'strict_exchange_amount_time_transfer',
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
    expect(result.feeAdjustedExactHashAssetIdentityBlocks).toEqual([]);
    expect(result.feeAdjustedExactHashMatches).toEqual([]);
    expect(result.feeAdjustedExactHashAmbiguities).toEqual([]);
    expect(result.sameHashGroupedMatches).toEqual([]);
    expect(result.sameHashGroupedUnresolvedGroups).toEqual([]);
    expect(result.counterpartyRoundtripMatches).toEqual([]);
    expect(result.counterpartyRoundtripAmbiguities).toEqual([]);
    expect(result.strictExchangeAmountTimeTransferMatches).toEqual([]);
    expect(result.strictExchangeAmountTimeTransferAmbiguities).toEqual([]);
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
          name: 'fee_adjusted_exact_hash_transfer',
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
        {
          consumedCandidateCount: 0,
          name: 'strict_exchange_amount_time_transfer',
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
    expect(result.strictExchangeAmountTimeTransferMatches).toEqual([]);
    expect(result.strictExchangeAmountTimeTransferAmbiguities).toEqual([]);
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
        evidenceKind: 'exact_hash_observed',
        examples: [
          {
            amount: '1.25',
            sourceBlockchainTransactionHash: '0xabc123',
            sourceCandidateId: 1,
            sourcePostingFingerprint: 'ledger_posting:v1:kraken-withdrawal',
            targetBlockchainTransactionHash: '0xabc123',
            targetCandidateId: 2,
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

  it('suggests asset identity for fee-adjusted exact-hash exchange withdrawals before materialization', async () => {
    const harness = makeHarness([
      makePosting({
        ownerAccountId: 1,
        sourceActivityFingerprint: 'source_activity:v1:coinbase-withdrawal',
        journalFingerprint: 'ledger_journal:v1:coinbase-withdrawal',
        postingFingerprint: 'ledger_posting:v1:coinbase-withdrawal',
        quantity: '-1.26',
        platformKey: 'coinbase',
        platformKind: 'exchange',
        assetId: 'exchange:coinbase:eth',
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
        activityDatetime: new Date('2026-04-23T00:01:00.000Z'),
      }),
    ]);

    const result = assertOk(await runLedgerLinking(1, harness.ports));

    expect(result.acceptedRelationships).toEqual([]);
    expect(result.feeAdjustedExactHashMatches).toEqual([]);
    expect(result.feeAdjustedExactHashAssetIdentityBlocks).toEqual([
      {
        amount: '1.25',
        assetSymbol: ETH,
        reason: 'same_symbol_different_asset_ids',
        residualAmount: '0.01',
        residualSide: 'source',
        sourceAmount: '1.26',
        sourceAssetId: 'exchange:coinbase:eth',
        sourceBlockchainTransactionHash: '0xabc123',
        sourceCandidateId: 1,
        sourcePostingFingerprint: 'ledger_posting:v1:coinbase-withdrawal',
        targetAmount: '1.25',
        targetAssetId: 'blockchain:ethereum:native',
        targetBlockchainTransactionHash: '0xabc123',
        targetCandidateId: 2,
        targetPostingFingerprint: 'ledger_posting:v1:ethereum-deposit',
        timeDistanceSeconds: 60,
      },
    ]);
    expect(result.assetIdentitySuggestions).toEqual([
      {
        assetIdA: 'blockchain:ethereum:native',
        assetIdB: 'exchange:coinbase:eth',
        assetSymbol: ETH,
        blockCount: 1,
        evidenceKind: 'exact_hash_observed',
        examples: [
          {
            amount: '1.25',
            residualAmount: '0.01',
            residualSide: 'source',
            sourceAmount: '1.26',
            sourceBlockchainTransactionHash: '0xabc123',
            sourceCandidateId: 1,
            sourcePostingFingerprint: 'ledger_posting:v1:coinbase-withdrawal',
            targetAmount: '1.25',
            targetBlockchainTransactionHash: '0xabc123',
            targetCandidateId: 2,
            targetPostingFingerprint: 'ledger_posting:v1:ethereum-deposit',
            timeDistanceSeconds: 60,
          },
        ],
        relationshipKind: 'internal_transfer',
      },
    ]);
    expect(harness.savedRelationships).toEqual([[]]);
  });

  it('materializes fee-adjusted exact-hash transfers with accepted asset identity and leaves source residual unmatched', async () => {
    const harness = makeHarness(
      [
        makePosting({
          ownerAccountId: 1,
          sourceActivityFingerprint: 'source_activity:v1:coinbase-withdrawal',
          journalFingerprint: 'ledger_journal:v1:coinbase-withdrawal',
          postingFingerprint: 'ledger_posting:v1:coinbase-withdrawal',
          quantity: '-1.26',
          platformKey: 'coinbase',
          platformKind: 'exchange',
          assetId: 'exchange:coinbase:eth',
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
          activityDatetime: new Date('2026-04-23T00:01:00.000Z'),
        }),
      ],
      {
        assetIdentityAssertions: [
          {
            assetIdA: 'exchange:coinbase:eth',
            assetIdB: 'blockchain:ethereum:native',
            evidenceKind: 'exact_hash_observed',
            relationshipKind: 'internal_transfer',
          },
        ],
      }
    );

    const result = assertOk(await runLedgerLinking(1, harness.ports, { includeDiagnostics: true }));

    expect(result.acceptedRelationships).toHaveLength(1);
    expect(result.feeAdjustedExactHashMatches).toHaveLength(1);
    expect(result.feeAdjustedExactHashMatches[0]).toMatchObject({
      amount: '1.25',
      residualAmount: '0.01',
      residualSide: 'source',
      sourceCandidateId: 1,
      targetCandidateId: 2,
    });
    expect(result.matchedSourceCandidateCount).toBe(1);
    expect(result.matchedTargetCandidateCount).toBe(1);
    expect(result.unmatchedSourceCandidateCount).toBe(1);
    expect(result.unmatchedTargetCandidateCount).toBe(0);
    expect(result.diagnostics?.unmatchedCandidates).toEqual([
      expect.objectContaining({
        candidateId: 1,
        claimedAmount: '1.25',
        direction: 'source',
        originalAmount: '1.26',
        remainingAmount: '0.01',
      }),
    ]);
    expect(harness.savedRelationships[0]?.[0]).toMatchObject({
      allocations: [
        {
          allocationSide: 'source',
          postingFingerprint: 'ledger_posting:v1:coinbase-withdrawal',
          quantity: parseDecimal('1.25'),
        },
        {
          allocationSide: 'target',
          postingFingerprint: 'ledger_posting:v1:ethereum-deposit',
          quantity: parseDecimal('1.25'),
        },
      ],
      evidence: {
        amount: '1.25',
        residualAmount: '0.01',
        residualSide: 'source',
        sourceAmount: '1.26',
        targetAmount: '1.25',
        timeDistanceSeconds: 60,
      },
      recognitionStrategy: 'fee_adjusted_exact_hash_transfer',
      relationshipKind: 'internal_transfer',
    });
  });

  it('suggests amount/time asset identity assertions when exact-hash evidence is unavailable', async () => {
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
        blockchainTransactionHash: undefined,
        fromAddress: undefined,
        toAddress: undefined,
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
        activityDatetime: new Date('2026-04-23T00:30:00.000Z'),
        blockchainTransactionHash: '0xtarget',
      }),
    ]);

    const result = assertOk(await runLedgerLinking(1, harness.ports, { dryRun: true }));

    expect(result.exactHashAssetIdentityBlocks).toEqual([]);
    expect(result.assetIdentitySuggestions).toEqual([
      {
        assetIdA: 'blockchain:ethereum:native',
        assetIdB: 'exchange:kraken:eth',
        assetSymbol: ETH,
        blockCount: 1,
        evidenceKind: 'amount_time_observed',
        examples: [
          {
            amount: '1.25',
            sourceCandidateId: 1,
            sourcePostingFingerprint: 'ledger_posting:v1:kraken-withdrawal',
            targetBlockchainTransactionHash: '0xtarget',
            targetCandidateId: 2,
            targetPostingFingerprint: 'ledger_posting:v1:ethereum-deposit',
            timeDistanceSeconds: 1800,
          },
        ],
        relationshipKind: 'internal_transfer',
      },
    ]);
    expect(result.persistence).toEqual({
      mode: 'dry_run',
      plannedRelationshipCount: 0,
    });
    expect(harness.savedRelationships).toEqual([]);
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
          consumedCandidateCount: 0,
          name: 'fee_adjusted_exact_hash_transfer',
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
        {
          consumedCandidateCount: 0,
          name: 'strict_exchange_amount_time_transfer',
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
          name: 'fee_adjusted_exact_hash_transfer',
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
        {
          consumedCandidateCount: 0,
          name: 'strict_exchange_amount_time_transfer',
          relationshipCount: 0,
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

  it('materializes strict exchange amount/time transfers after stronger recognizers', async () => {
    const harness = makeHarness(
      [
        makePosting({
          assetId: 'exchange:kraken:eth',
          blockchainTransactionHash: undefined,
          journalFingerprint: 'ledger_journal:v1:kraken-withdrawal',
          platformKey: 'kraken',
          platformKind: 'exchange',
          postingFingerprint: 'ledger_posting:v1:kraken-withdrawal',
          quantity: '-1',
          sourceActivityFingerprint: 'source_activity:v1:kraken-withdrawal',
        }),
        makePosting({
          activityDatetime: new Date('2026-04-23T00:30:00.000Z'),
          assetId: 'blockchain:ethereum:native',
          blockchainTransactionHash: '0xdef456',
          journalFingerprint: 'ledger_journal:v1:ethereum-deposit',
          ownerAccountId: 2,
          postingFingerprint: 'ledger_posting:v1:ethereum-deposit',
          quantity: '1',
          sourceActivityFingerprint: 'source_activity:v1:ethereum-deposit',
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

    expect(result.exactHashMatches).toEqual([]);
    expect(result.sameHashGroupedMatches).toEqual([]);
    expect(result.counterpartyRoundtripMatches).toEqual([]);
    expect(result.strictExchangeAmountTimeTransferMatches).toHaveLength(1);
    expect(result).toMatchObject({
      deterministicRecognizerStats: [
        {
          consumedCandidateCount: 0,
          name: 'exact_hash_transfer',
          relationshipCount: 0,
        },
        {
          consumedCandidateCount: 0,
          name: 'fee_adjusted_exact_hash_transfer',
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
        {
          consumedCandidateCount: 2,
          name: 'strict_exchange_amount_time_transfer',
          relationshipCount: 1,
        },
      ],
      matchedSourceCandidateCount: 1,
      matchedTargetCandidateCount: 1,
      unmatchedSourceCandidateCount: 0,
      unmatchedTargetCandidateCount: 0,
    });
    expect(result.acceptedRelationships[0]).toMatchObject({
      recognitionStrategy: 'strict_exchange_amount_time_transfer',
      relationshipKind: 'internal_transfer',
      evidence: {
        assetIdentityReason: 'accepted_assertion',
        sourcePlatformKey: 'kraken',
        targetPlatformKey: 'ethereum',
        timeDistanceSeconds: 1800,
      },
      allocations: [
        {
          allocationSide: 'source',
          sourceActivityFingerprint: 'source_activity:v1:kraken-withdrawal',
          quantity: parseDecimal('1'),
        },
        {
          allocationSide: 'target',
          sourceActivityFingerprint: 'source_activity:v1:ethereum-deposit',
          quantity: parseDecimal('1'),
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

  it('replays reviewed relationship overrides before deterministic recognizers', async () => {
    const reviewedRelationshipOverride = makeReviewedRelationshipOverride();
    const harness = makeHarness(
      [
        makePosting({
          assetId: 'exchange:kraken:eth',
          blockchainTransactionHash: undefined,
          journalFingerprint: 'ledger_journal:v1:reviewed-source',
          platformKey: 'kraken',
          platformKind: 'exchange',
          postingFingerprint: 'ledger_posting:v1:reviewed-source',
          quantity: '-1',
          sourceActivityFingerprint: 'source_activity:v1:reviewed-source',
        }),
        makePosting({
          assetId: 'blockchain:ethereum:native',
          blockchainTransactionHash: undefined,
          journalFingerprint: 'ledger_journal:v1:reviewed-target',
          postingFingerprint: 'ledger_posting:v1:reviewed-target',
          quantity: '1',
          sourceActivityFingerprint: 'source_activity:v1:reviewed-target',
        }),
      ],
      {
        reviewedRelationshipOverrides: [reviewedRelationshipOverride],
      }
    );

    const result = assertOk(await runLedgerLinking(1, harness.ports));

    expect(result.reviewedRelationshipOverrideMatches).toEqual([
      {
        allocations: [
          {
            allocationSide: 'source',
            candidateId: 1,
            postingFingerprint: 'ledger_posting:v1:reviewed-source',
            quantity: '1',
          },
          {
            allocationSide: 'target',
            candidateId: 2,
            postingFingerprint: 'ledger_posting:v1:reviewed-target',
            quantity: '1',
          },
        ],
        overrideEventId: 'override-event-1',
        relationshipStableKey: result.acceptedRelationships[0]?.relationshipStableKey,
        reviewId: 'lp_test_1',
      },
    ]);
    expect(result.deterministicRecognizerStats[0]).toMatchObject({
      claimedCandidateCount: 2,
      consumedCandidateCount: 2,
      name: 'reviewed_relationship',
      relationshipCount: 1,
    });
    expect(result.deterministicRecognizerStats.map((stats) => stats.name)).toEqual([
      'reviewed_relationship',
      'exact_hash_transfer',
      'fee_adjusted_exact_hash_transfer',
      'same_hash_grouped_transfer',
      'counterparty_roundtrip',
      'strict_exchange_amount_time_transfer',
    ]);
    expect(result.exactHashMatches).toEqual([]);
    expect(result.acceptedRelationships[0]).toMatchObject({
      evidence: {
        overrideEventId: 'override-event-1',
        reviewId: 'lp_test_1',
      },
      recognitionStrategy: 'reviewed_relationship',
      relationshipKind: 'internal_transfer',
    });
    expect(harness.savedRelationships).toEqual([result.acceptedRelationships]);
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
  reviewedRelationshipOverrides?: readonly LedgerLinkingReviewedRelationshipOverride[] | undefined;
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
    ...(options.reviewedRelationshipOverrides !== undefined
      ? {
          reviewedRelationshipOverrideReader: {
            async loadReviewedLedgerLinkingRelationshipOverrides() {
              return ok([...options.reviewedRelationshipOverrides!]);
            },
          },
        }
      : {}),
  };

  return {
    loadedProfileIds,
    ports,
    savedRelationships,
  };
}

function makeReviewedRelationshipOverride(): LedgerLinkingReviewedRelationshipOverride {
  return {
    acceptedAt: '2026-04-29T00:00:00.000Z',
    allocations: [
      {
        allocationSide: 'source',
        assetId: 'exchange:kraken:eth',
        assetSymbol: ETH,
        journalFingerprint: 'ledger_journal:v1:reviewed-source',
        postingFingerprint: 'ledger_posting:v1:reviewed-source',
        quantity: parseDecimal('1'),
        sourceActivityFingerprint: 'source_activity:v1:reviewed-source',
      },
      {
        allocationSide: 'target',
        assetId: 'blockchain:ethereum:native',
        assetSymbol: ETH,
        journalFingerprint: 'ledger_journal:v1:reviewed-target',
        postingFingerprint: 'ledger_posting:v1:reviewed-target',
        quantity: parseDecimal('1'),
        sourceActivityFingerprint: 'source_activity:v1:reviewed-target',
      },
    ],
    evidence: {
      assetIdentityReason: 'accepted_assertion',
      matchedAmount: '1',
      proposalUniqueness: 'unique_pair',
      timeDirection: 'source_before_target',
      timeDistanceSeconds: 1800,
    },
    overrideEventId: 'override-event-1',
    proposalKind: 'amount_time',
    relationshipKind: 'internal_transfer',
    reviewId: 'lp_test_1',
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
