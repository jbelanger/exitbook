import { ok } from '@exitbook/foundation';
import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CliAppRuntime } from '../../../../runtime/app-runtime.js';

const {
  mockBuildLedgerLinkingReviewQueue,
  mockBuildLedgerLinkingAssetIdentityAssertionReader,
  mockBuildLedgerLinkingAssetIdentityAssertionStore,
  mockBuildLedgerLinkingRelationshipReader,
  mockBuildLedgerLinkingRunPorts,
  mockCtx,
  mockExitCliFailure,
  mockLoadLedgerLinkingAssetIdentityAssertions,
  mockLoadLedgerLinkingRelationships,
  mockMaterializeStoredLedgerLinkingAssetIdentityAssertions,
  mockOutputSuccess,
  mockOverrideStoreAppend,
  mockOverrideStoreConstructor,
  mockReadResolvedLedgerLinkingGapResolutionKeys,
  mockResolveCommandProfile,
  mockRunCommand,
  mockRunLedgerLinking,
  mockReplaceLedgerLinkingAssetIdentityAssertions,
  mockSaveLedgerLinkingAssetIdentityAssertion,
} = vi.hoisted(() => ({
  mockBuildLedgerLinkingReviewQueue: vi.fn(),
  mockBuildLedgerLinkingAssetIdentityAssertionReader: vi.fn(),
  mockBuildLedgerLinkingAssetIdentityAssertionStore: vi.fn(),
  mockBuildLedgerLinkingRelationshipReader: vi.fn(),
  mockBuildLedgerLinkingRunPorts: vi.fn(),
  mockCtx: {
    openDatabaseSession: vi.fn(),
  },
  mockExitCliFailure: vi.fn(),
  mockLoadLedgerLinkingAssetIdentityAssertions: vi.fn(),
  mockLoadLedgerLinkingRelationships: vi.fn(),
  mockMaterializeStoredLedgerLinkingAssetIdentityAssertions: vi.fn(),
  mockOutputSuccess: vi.fn(),
  mockOverrideStoreAppend: vi.fn(),
  mockOverrideStoreConstructor: vi.fn(),
  mockReadResolvedLedgerLinkingGapResolutionKeys: vi.fn(),
  mockResolveCommandProfile: vi.fn(),
  mockRunCommand: vi.fn(),
  mockRunLedgerLinking: vi.fn(),
  mockReplaceLedgerLinkingAssetIdentityAssertions: vi.fn(),
  mockSaveLedgerLinkingAssetIdentityAssertion: vi.fn(),
}));

vi.mock('@exitbook/accounting/ledger-linking', () => ({
  buildLedgerLinkingGapResolutionKey: ({ postingFingerprint }: { postingFingerprint: string }) =>
    `ledger_linking_v2:${postingFingerprint}`,
  buildLedgerLinkingReviewQueue: mockBuildLedgerLinkingReviewQueue,
  buildReviewedLedgerLinkingRelationshipStableKey: () => 'ledger-linking:reviewed_relationship:v2:test',
  canonicalizeLedgerLinkingAssetIdentityPair: (assetIdA: string, assetIdB: string) => {
    const sorted = [assetIdA.trim(), assetIdB.trim()].sort();
    const canonicalAssetIdA = sorted[0];
    const canonicalAssetIdB = sorted[1];

    if (canonicalAssetIdA === undefined || canonicalAssetIdB === undefined) {
      throw new Error('Expected two asset ids');
    }

    return ok({
      assetIdA: canonicalAssetIdA,
      assetIdB: canonicalAssetIdB,
    });
  },
  LedgerLinkingReviewedRelationshipOverrideSchema: {
    safeParse: (data: unknown) => ({ data, success: true }),
  },
  ledgerTransactionHashesMatch: (sourceHash: string | undefined, targetHash: string | undefined) =>
    sourceHash?.replace(/^0x/i, '').toLowerCase() === targetHash?.replace(/^0x/i, '').toLowerCase(),
  runLedgerLinking: mockRunLedgerLinking,
}));

vi.mock('@exitbook/data/accounting', () => ({
  buildLedgerLinkingAssetIdentityAssertionReader: mockBuildLedgerLinkingAssetIdentityAssertionReader,
  buildLedgerLinkingAssetIdentityAssertionStore: mockBuildLedgerLinkingAssetIdentityAssertionStore,
  buildLedgerLinkingRelationshipReader: mockBuildLedgerLinkingRelationshipReader,
  buildLedgerLinkingRunPorts: mockBuildLedgerLinkingRunPorts,
}));

vi.mock('@exitbook/data/overrides', () => ({
  materializeStoredLedgerLinkingAssetIdentityAssertions: mockMaterializeStoredLedgerLinkingAssetIdentityAssertions,
  OverrideStore: vi.fn().mockImplementation(function MockOverrideStore(dataDir: string) {
    mockOverrideStoreConstructor(dataDir);
    return {
      append: mockOverrideStoreAppend,
    };
  }),
  readResolvedLedgerLinkingGapResolutionKeys: mockReadResolvedLedgerLinkingGapResolutionKeys,
}));

vi.mock('../../../../runtime/command-runtime.js', () => ({
  runCommand: mockRunCommand,
}));

vi.mock('../../../../cli/error.js', () => ({
  exitCliFailure: mockExitCliFailure,
}));

vi.mock('../../../../cli/output.js', () => ({
  outputSuccess: mockOutputSuccess,
}));

vi.mock('../../../profiles/profile-resolution.js', () => ({
  resolveCommandProfile: mockResolveCommandProfile,
}));

import { registerLinksV2Command } from '../links-v2.js';

function createProgram(): Command {
  const program = new Command();
  registerLinksV2Command(program, {} as CliAppRuntime);
  return program;
}

describe('links-v2 command', () => {
  const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    consoleLogSpy.mockClear();

    mockRunCommand.mockImplementation(async (appOrFn: unknown, maybeFn?: (ctx: typeof mockCtx) => Promise<void>) => {
      const fn = typeof appOrFn === 'function' ? appOrFn : maybeFn;
      await fn?.(mockCtx);
    });
    Object.assign(mockCtx, { dataDir: '/tmp/exitbook-links-v2' });
    mockCtx.openDatabaseSession.mockResolvedValue({ tag: 'db' });
    mockResolveCommandProfile.mockResolvedValue(
      ok({
        id: 7,
        profileKey: 'default',
        displayName: 'Default',
        createdAt: new Date('2026-04-28T00:00:00.000Z'),
      })
    );
    mockBuildLedgerLinkingRunPorts.mockReturnValue({ tag: 'ledger-linking-ports' });
    mockBuildLedgerLinkingReviewQueue.mockImplementation(
      (input: {
        assetIdentitySuggestions: readonly unknown[];
        diagnostics?: { amountTimeProposals?: readonly unknown[] };
      }) => {
        const assetIdentityItems = input.assetIdentitySuggestions.map((suggestion, index) => ({
          evidenceStrength: 'strong',
          kind: 'asset_identity_suggestion',
          reviewId: `ai_test_${index + 1}`,
          suggestion,
        }));
        const linkProposalItems = (input.diagnostics?.amountTimeProposals ?? []).map((proposal, index) => ({
          evidenceStrength: 'medium',
          kind: 'link_proposal',
          proposal,
          proposalKind: 'amount_time',
          relationshipKind: 'internal_transfer',
          reviewId: `lp_test_${index + 1}`,
        }));
        const items = [...assetIdentityItems, ...linkProposalItems];

        return {
          assetIdentitySuggestionCount: assetIdentityItems.length,
          gapResolutionCount: 0,
          itemCount: items.length,
          items,
          linkProposalCount: linkProposalItems.length,
        };
      }
    );
    mockLoadLedgerLinkingAssetIdentityAssertions.mockResolvedValue(
      ok([
        {
          assetIdA: 'blockchain:ethereum:native',
          assetIdB: 'exchange:kraken:eth',
          evidenceKind: 'manual',
          relationshipKind: 'internal_transfer',
        },
      ])
    );
    mockLoadLedgerLinkingRelationships.mockResolvedValue(ok([makePersistedRelationship()]));
    mockOverrideStoreAppend.mockResolvedValue(
      ok({
        actor: 'user',
        created_at: '2026-04-29T00:00:00.000Z',
        id: 'override-event-1',
        profile_key: 'default',
        scope: 'ledger-linking-asset-identity-accept',
        source: 'cli',
        payload: {
          asset_id_a: 'blockchain:ethereum:native',
          asset_id_b: 'exchange:kraken:eth',
          evidence_kind: 'exact_hash_observed',
          relationship_kind: 'internal_transfer',
          type: 'ledger_linking_asset_identity_accept',
        },
      })
    );
    mockMaterializeStoredLedgerLinkingAssetIdentityAssertions.mockResolvedValue(
      ok({
        previousCount: 0,
        savedCount: 1,
      })
    );
    mockSaveLedgerLinkingAssetIdentityAssertion.mockResolvedValue(
      ok({
        action: 'created',
        assertion: {
          assetIdA: 'blockchain:ethereum:native',
          assetIdB: 'exchange:kraken:eth',
          evidenceKind: 'manual',
          relationshipKind: 'internal_transfer',
        },
      })
    );
    mockBuildLedgerLinkingAssetIdentityAssertionReader.mockReturnValue({
      loadLedgerLinkingAssetIdentityAssertions: mockLoadLedgerLinkingAssetIdentityAssertions,
    });
    mockBuildLedgerLinkingAssetIdentityAssertionStore.mockReturnValue({
      replaceLedgerLinkingAssetIdentityAssertions: mockReplaceLedgerLinkingAssetIdentityAssertions,
      saveLedgerLinkingAssetIdentityAssertion: mockSaveLedgerLinkingAssetIdentityAssertion,
    });
    mockBuildLedgerLinkingRelationshipReader.mockReturnValue({
      loadLedgerLinkingRelationships: mockLoadLedgerLinkingRelationships,
    });
    mockReadResolvedLedgerLinkingGapResolutionKeys.mockResolvedValue(ok(new Set<string>()));
    mockRunLedgerLinking.mockResolvedValue(
      ok({
        ...makeRunResult(),
        persistence: {
          mode: 'dry_run',
          plannedRelationshipCount: 1,
        },
      })
    );
  });

  it('treats bare links-v2 as read-only status', async () => {
    const program = createProgram();

    await program.parseAsync(['links-v2'], { from: 'user' });

    expect(mockRunLedgerLinking).toHaveBeenCalledWith(7, { tag: 'ledger-linking-ports' }, { dryRun: true });
    expect(consoleLogSpy).toHaveBeenCalledWith('Links v2 status.');
    expect(consoleLogSpy).toHaveBeenCalledWith('Mode: dry run');
    expect(consoleLogSpy).toHaveBeenCalledWith('Legacy transaction links: untouched.');
    expect(consoleLogSpy).toHaveBeenCalledWith('Planned materialization: 1 relationship(s)');
  });

  it('runs v2 materialization from the parallel command', async () => {
    const program = createProgram();
    mockRunLedgerLinking.mockResolvedValue(ok(makeRunResult()));

    await program.parseAsync(['links-v2', 'run'], { from: 'user' });

    expect(mockRunLedgerLinking).toHaveBeenCalledWith(7, { tag: 'ledger-linking-ports' }, { dryRun: false });
    expect(consoleLogSpy).toHaveBeenCalledWith('Links v2 run completed.');
    expect(consoleLogSpy).toHaveBeenCalledWith('Mode: persisted');
    expect(consoleLogSpy).toHaveBeenCalledWith('Legacy transaction links: untouched.');
  });

  it('emits JSON status output with the links-v2 status command id', async () => {
    const program = createProgram();

    await program.parseAsync(['links-v2', 'status', '--json'], { from: 'user' });

    expect(mockOutputSuccess).toHaveBeenCalledOnce();
    expect(mockOutputSuccess.mock.calls[0]?.[0]).toBe('links-v2-status');
    expect(mockRunLedgerLinking).toHaveBeenCalledWith(7, { tag: 'ledger-linking-ports' }, { dryRun: true });
  });

  it('renders read-only diagnostics for unmatched candidates and amount/time proposals', async () => {
    const program = createProgram();
    mockRunLedgerLinking.mockResolvedValue(
      ok({
        ...makeRunResult(),
        diagnostics: makeDiagnostics(),
      })
    );

    await program.parseAsync(['links-v2', 'diagnose', '--proposal-window-hours', '24', '--limit', '1'], {
      from: 'user',
    });

    expect(mockRunLedgerLinking).toHaveBeenCalledWith(
      7,
      { tag: 'ledger-linking-ports' },
      {
        amountTimeProposalWindowMinutes: 1440,
        dryRun: true,
        includeDiagnostics: true,
      }
    );
    expect(consoleLogSpy).toHaveBeenCalledWith('Links v2 diagnostics.');
    expect(consoleLogSpy).toHaveBeenCalledWith('Mode: dry run');
    expect(consoleLogSpy).toHaveBeenCalledWith('Unmatched candidate remainders: 1 source, 1 target');
    expect(consoleLogSpy).toHaveBeenCalledWith('Amount/time window: 24h');
    expect(consoleLogSpy).toHaveBeenCalledWith('Amount/time proposals: 1 (1 unique)');
    expect(consoleLogSpy).toHaveBeenCalledWith('Asset identity blockers: 0');
    expect(consoleLogSpy).toHaveBeenCalledWith('Classification groups: 1 of 1');
    expect(consoleLogSpy).toHaveBeenCalledWith('  amount_time_unique: 2 candidate(s), 1 source, 1 target');
    expect(consoleLogSpy).toHaveBeenCalledWith('Unmatched groups: 1 of 2');
    expect(consoleLogSpy).toHaveBeenCalledWith('Amount/time groups: 1 of 1');
    expect(consoleLogSpy).toHaveBeenCalledWith('Amount/time proposal examples: 1 of 1');
    expect(consoleLogSpy).toHaveBeenCalledWith(
      '  unique_pair ETH 1 kraken #7 -> ethereum #8 (30m, source_before_target)'
    );
  });

  it('renders the read-only links-v2 review queue', async () => {
    const program = createProgram();
    const diagnostics = makeDiagnostics();
    const assetIdentitySuggestion = makeAssetIdentitySuggestion();
    mockRunLedgerLinking.mockResolvedValue(
      ok({
        ...makeRunResult(),
        assetIdentitySuggestions: [assetIdentitySuggestion],
        diagnostics,
      })
    );

    await program.parseAsync(['links-v2', 'review', '--limit', '2'], {
      from: 'user',
    });

    expect(mockRunLedgerLinking).toHaveBeenCalledWith(
      7,
      { tag: 'ledger-linking-ports' },
      {
        dryRun: true,
        includeDiagnostics: true,
      }
    );
    expect(mockBuildLedgerLinkingReviewQueue).toHaveBeenCalledWith({
      assetIdentitySuggestions: [assetIdentitySuggestion],
      diagnostics,
      resolvedGapResolutionKeys: new Set<string>(),
    });
    expect(consoleLogSpy).toHaveBeenCalledWith('Links v2 review queue.');
    expect(consoleLogSpy).toHaveBeenCalledWith('Mode: dry run');
    expect(consoleLogSpy).toHaveBeenCalledWith(
      'Review items: 2 of 2 (1 asset identity suggestion, 1 link proposal, 0 gap resolutions)'
    );
    expect(consoleLogSpy).toHaveBeenCalledWith('  ai_test_1 asset_identity_suggestion internal_transfer ETH (strong)');
    expect(consoleLogSpy).toHaveBeenCalledWith('    assets: blockchain:ethereum:native <-> exchange:kraken:eth');
    expect(consoleLogSpy).toHaveBeenCalledWith('  lp_test_1 link_proposal amount_time unique_pair ETH 1 (medium)');
    expect(consoleLogSpy).toHaveBeenCalledWith(
      '    evidence: time 30m, source_before_target, accepted asset identity assertion'
    );
    expect(consoleLogSpy).toHaveBeenCalledWith('Inspect before accepting: exitbook links-v2 review view <review-id>');
  });

  it('shows decision help for an asset identity review item', async () => {
    const program = createProgram();
    const diagnostics = makeDiagnostics();
    const assetIdentitySuggestion = makeAssetIdentitySuggestion();
    mockRunLedgerLinking.mockResolvedValue(
      ok({
        ...makeRunResult(),
        assetIdentitySuggestions: [assetIdentitySuggestion],
        diagnostics,
      })
    );

    await program.parseAsync(['links-v2', 'review', 'view', 'ai_test_1'], {
      from: 'user',
    });

    expect(mockRunLedgerLinking).toHaveBeenCalledWith(
      7,
      { tag: 'ledger-linking-ports' },
      {
        dryRun: true,
        includeDiagnostics: true,
      }
    );
    expect(consoleLogSpy).toHaveBeenCalledWith('Links v2 review item.');
    expect(consoleLogSpy).toHaveBeenCalledWith('Review id: ai_test_1');
    expect(consoleLogSpy).toHaveBeenCalledWith('Kind: asset_identity_suggestion');
    expect(consoleLogSpy).toHaveBeenCalledWith('Evidence strength: strong');
    expect(consoleLogSpy).toHaveBeenCalledWith(
      'Would accept: asset identity assertion blockchain:ethereum:native <-> exchange:kraken:eth'
    );
    expect(consoleLogSpy).toHaveBeenCalledWith('Impact:');
    expect(consoleLogSpy).toHaveBeenCalledWith(
      [
        '  Records only the asset identity assertion.',
        '  A later links-v2 run can use that assertion to materialize deterministic exact-hash or fee-adjusted exact-hash relationships.',
      ].join('\n')
    );
    expect(consoleLogSpy).toHaveBeenCalledWith('Accept command: exitbook links-v2 review accept ai_test_1');
    expect(consoleLogSpy).toHaveBeenCalledWith('Decision help:');
    expect(consoleLogSpy).toHaveBeenCalledWith(
      [
        '  Accept only if the two shown asset ids name the same asset.',
        '  Exact-hash evidence means the same transaction hash was observed on both sides.',
        '  If source/target amounts differ, only the arrived amount is linkable; the residual stays unresolved.',
        '  If a blockchain asset id is involved, verify the network/token matches the exchange asset.',
        '  If the asset mapping is unclear, leave it pending; no relationship will be created from this identity.',
      ].join('\n')
    );
  });

  it('shows accept guidance for a link proposal review item', async () => {
    const program = createProgram();
    mockRunLedgerLinking.mockResolvedValue(
      ok({
        ...makeRunResult(),
        diagnostics: makeDiagnostics(),
      })
    );

    await program.parseAsync(['links-v2', 'review', 'view', 'lp_test_1'], {
      from: 'user',
    });

    expect(consoleLogSpy).toHaveBeenCalledWith('Links v2 review item.');
    expect(consoleLogSpy).toHaveBeenCalledWith('Review id: lp_test_1');
    expect(consoleLogSpy).toHaveBeenCalledWith('Kind: link_proposal');
    expect(consoleLogSpy).toHaveBeenCalledWith('Proposal kind: amount_time');
    expect(consoleLogSpy).toHaveBeenCalledWith('Relationship kind: internal_transfer');
    expect(consoleLogSpy).toHaveBeenCalledWith(
      'Would accept: reviewed amount_time relationship ledger_posting:v1:diagnostic-source -> ledger_posting:v1:diagnostic-target'
    );
    expect(consoleLogSpy).toHaveBeenCalledWith('Accept command: exitbook links-v2 review accept lp_test_1');
    expect(consoleLogSpy).toHaveBeenCalledWith('Decision help:');
    expect(consoleLogSpy).toHaveBeenCalledWith('  This records a durable reviewed relationship override.');
    expect(consoleLogSpy).toHaveBeenCalledWith(
      '  Replay requires every accepted posting allocation and quantity to still resolve.'
    );
    expect(mockOverrideStoreAppend).not.toHaveBeenCalled();
  });

  it('shows accept guidance for a gap resolution review item', async () => {
    const program = createProgram();
    const gapResolutionItem = makeGapResolutionReviewItem();
    mockRunLedgerLinking.mockResolvedValue(
      ok({
        ...makeRunResult(),
        diagnostics: makeDiagnostics(),
      })
    );
    mockBuildLedgerLinkingReviewQueue.mockReturnValue({
      assetIdentitySuggestionCount: 0,
      gapResolutionCount: 1,
      itemCount: 1,
      items: [gapResolutionItem],
      linkProposalCount: 0,
    });

    await program.parseAsync(['links-v2', 'review', 'view', 'gr_test_1'], {
      from: 'user',
    });

    expect(consoleLogSpy).toHaveBeenCalledWith('Links v2 review item.');
    expect(consoleLogSpy).toHaveBeenCalledWith('Review id: gr_test_1');
    expect(consoleLogSpy).toHaveBeenCalledWith('Kind: gap_resolution');
    expect(consoleLogSpy).toHaveBeenCalledWith('Resolution: fiat cash movement');
    expect(consoleLogSpy).toHaveBeenCalledWith('Would accept: resolved non-link posting ledger_posting:v1:cad-deposit');
    expect(consoleLogSpy).toHaveBeenCalledWith('Accept command: exitbook links-v2 review accept gr_test_1');
    expect(consoleLogSpy).toHaveBeenCalledWith(
      '  This records a durable gap-resolution override; it does not create a relationship.'
    );
    expect(mockOverrideStoreAppend).not.toHaveBeenCalled();
  });

  it('emits JSON for review view when --json is parsed by the parent review command', async () => {
    const program = createProgram();
    const assetIdentitySuggestion = makeAssetIdentitySuggestion();
    mockRunLedgerLinking.mockResolvedValue(
      ok({
        ...makeRunResult(),
        assetIdentitySuggestions: [assetIdentitySuggestion],
        diagnostics: makeDiagnostics(),
      })
    );

    await program.parseAsync(['links-v2', 'review', 'view', 'ai_test_1', '--json'], {
      from: 'user',
    });

    expect(mockOutputSuccess).toHaveBeenCalledOnce();
    expect(mockOutputSuccess.mock.calls[0]?.[0]).toBe('links-v2-review-view');
    expect(mockOutputSuccess.mock.calls[0]?.[1]).toMatchObject({
      reviewItem: {
        kind: 'asset_identity_suggestion',
        reviewId: 'ai_test_1',
      },
    });
  });

  it('accepts an asset identity suggestion from the links-v2 review queue', async () => {
    const program = createProgram();
    const diagnostics = makeDiagnostics();
    const assetIdentitySuggestion = makeAssetIdentitySuggestion();
    mockRunLedgerLinking.mockResolvedValue(
      ok({
        ...makeRunResult(),
        assetIdentitySuggestions: [assetIdentitySuggestion],
        diagnostics,
      })
    );

    await program.parseAsync(['links-v2', 'review', 'accept', 'ai_test_1'], {
      from: 'user',
    });

    expect(mockRunLedgerLinking).toHaveBeenCalledWith(
      7,
      { tag: 'ledger-linking-ports' },
      {
        dryRun: true,
        includeDiagnostics: true,
      }
    );
    expect(mockOverrideStoreConstructor).toHaveBeenCalledWith('/tmp/exitbook-links-v2');
    expect(mockOverrideStoreAppend).toHaveBeenCalledWith({
      profileKey: 'default',
      scope: 'ledger-linking-asset-identity-accept',
      payload: {
        asset_id_a: 'blockchain:ethereum:native',
        asset_id_b: 'exchange:kraken:eth',
        evidence_kind: 'exact_hash_observed',
        relationship_kind: 'internal_transfer',
        type: 'ledger_linking_asset_identity_accept',
      },
    });
    expect(mockMaterializeStoredLedgerLinkingAssetIdentityAssertions).toHaveBeenCalledWith(
      {
        replaceLedgerLinkingAssetIdentityAssertions: mockReplaceLedgerLinkingAssetIdentityAssertions,
        saveLedgerLinkingAssetIdentityAssertion: mockSaveLedgerLinkingAssetIdentityAssertion,
      },
      expect.objectContaining({
        append: mockOverrideStoreAppend,
      }),
      7,
      'default'
    );
    expect(consoleLogSpy).toHaveBeenCalledWith('Links v2 review item accepted.');
    expect(consoleLogSpy).toHaveBeenCalledWith('Review id: ai_test_1');
    expect(consoleLogSpy).toHaveBeenCalledWith('Action: asset identity override accepted');
    expect(consoleLogSpy).toHaveBeenCalledWith('Override event: override-event-1');
    expect(consoleLogSpy).toHaveBeenCalledWith('Assets: blockchain:ethereum:native <-> exchange:kraken:eth');
    expect(consoleLogSpy).toHaveBeenCalledWith('Materialized assertions: 1 saved, 0 replaced');
  });

  it('emits JSON for review accept when --json is parsed by the parent review command', async () => {
    const program = createProgram();
    const diagnostics = makeDiagnostics();
    const assetIdentitySuggestion = makeAssetIdentitySuggestion();
    mockRunLedgerLinking.mockResolvedValue(
      ok({
        ...makeRunResult(),
        assetIdentitySuggestions: [assetIdentitySuggestion],
        diagnostics,
      })
    );

    await program.parseAsync(['links-v2', 'review', 'accept', 'ai_test_1', '--json'], {
      from: 'user',
    });

    expect(mockOutputSuccess).toHaveBeenCalledOnce();
    expect(mockOutputSuccess.mock.calls[0]?.[0]).toBe('links-v2-review-accept');
    expect(mockOverrideStoreAppend).toHaveBeenCalledWith({
      profileKey: 'default',
      scope: 'ledger-linking-asset-identity-accept',
      payload: {
        asset_id_a: 'blockchain:ethereum:native',
        asset_id_b: 'exchange:kraken:eth',
        evidence_kind: 'exact_hash_observed',
        relationship_kind: 'internal_transfer',
        type: 'ledger_linking_asset_identity_accept',
      },
    });
  });

  it('accepts link proposals from the links-v2 review queue as reviewed relationship overrides', async () => {
    const program = createProgram();
    mockRunLedgerLinking.mockResolvedValue(
      ok({
        ...makeRunResult(),
        diagnostics: makeDiagnostics(),
      })
    );
    mockRunLedgerLinking
      .mockResolvedValueOnce(
        ok({
          ...makeRunResult(),
          diagnostics: makeDiagnostics(),
        })
      )
      .mockResolvedValueOnce(
        ok({
          ...makeRunResult(),
          reviewedRelationshipOverrideMatches: [
            {
              overrideEventId: 'override-event-1',
              relationshipStableKey: 'ledger-linking:reviewed_relationship:v2:test',
              reviewId: 'lp_test_1',
              allocations: [
                {
                  allocationSide: 'source',
                  candidateId: 7,
                  postingFingerprint: 'ledger_posting:v1:diagnostic-source',
                  quantity: '1',
                },
                {
                  allocationSide: 'target',
                  candidateId: 8,
                  postingFingerprint: 'ledger_posting:v1:diagnostic-target',
                  quantity: '1',
                },
              ],
            },
          ],
        })
      );

    await program.parseAsync(['links-v2', 'review', 'accept', 'lp_test_1'], { from: 'user' });

    expect(mockOverrideStoreAppend).toHaveBeenCalledWith({
      profileKey: 'default',
      scope: 'ledger-linking-relationship-accept',
      payload: {
        allocations: [
          {
            allocation_side: 'source',
            asset_id: 'exchange:kraken:eth',
            asset_symbol: 'ETH',
            journal_fingerprint: 'ledger_journal:v1:source',
            posting_fingerprint: 'ledger_posting:v1:diagnostic-source',
            quantity: '1',
            source_activity_fingerprint: 'source_activity:v1:diagnostic-source',
          },
          {
            allocation_side: 'target',
            asset_id: 'blockchain:ethereum:native',
            asset_symbol: 'ETH',
            journal_fingerprint: 'ledger_journal:v1:target',
            posting_fingerprint: 'ledger_posting:v1:diagnostic-target',
            quantity: '1',
            source_activity_fingerprint: 'source_activity:v1:diagnostic-target',
          },
        ],
        evidence: {
          assetIdentityReason: 'accepted_assertion',
          matchedAmount: '1',
          proposalUniqueness: 'unique_pair',
          timeDirection: 'source_before_target',
          timeDistanceSeconds: 1800,
        },
        proposal_kind: 'amount_time',
        relationship_kind: 'internal_transfer',
        review_id: 'lp_test_1',
        type: 'ledger_linking_relationship_accept',
      },
    });
    expect(mockRunLedgerLinking).toHaveBeenLastCalledWith(
      7,
      { tag: 'ledger-linking-ports' },
      {
        dryRun: false,
        includeDiagnostics: true,
      }
    );
    expect(consoleLogSpy).toHaveBeenCalledWith('Action: reviewed link override accepted');
    expect(consoleLogSpy).toHaveBeenCalledWith('Relationship stable key: ledger-linking:reviewed_relationship:v2:test');
    expect(consoleLogSpy).toHaveBeenCalledWith('Materialized relationships: 1 saved, 0 replaced');
  });

  it('accepts gap resolutions from the links-v2 review queue as reviewed non-link overrides', async () => {
    const program = createProgram();
    const gapResolutionItem = makeGapResolutionReviewItem();
    mockRunLedgerLinking.mockResolvedValue(
      ok({
        ...makeRunResult(),
        diagnostics: makeDiagnostics(),
      })
    );
    mockBuildLedgerLinkingReviewQueue.mockReturnValue({
      assetIdentitySuggestionCount: 0,
      gapResolutionCount: 1,
      itemCount: 1,
      items: [gapResolutionItem],
      linkProposalCount: 0,
    });

    await program.parseAsync(['links-v2', 'review', 'accept', 'gr_test_1'], { from: 'user' });

    expect(mockOverrideStoreAppend).toHaveBeenCalledWith({
      profileKey: 'default',
      scope: 'ledger-linking-gap-resolution-accept',
      payload: {
        asset_id: 'exchange:kraken:cad',
        asset_symbol: 'CAD',
        claimed_amount: '0',
        direction: 'target',
        journal_fingerprint: 'ledger_journal:v1:cad-deposit',
        original_amount: '100',
        platform_key: 'kraken',
        platform_kind: 'exchange',
        posting_fingerprint: 'ledger_posting:v1:cad-deposit',
        remaining_amount: '100',
        resolution_kind: 'fiat_cash_movement',
        review_id: 'gr_test_1',
        source_activity_fingerprint: 'source_activity:v1:cad-deposit',
        type: 'ledger_linking_gap_resolution_accept',
      },
      reason: 'fiat cash movement',
    });
    expect(consoleLogSpy).toHaveBeenCalledWith('Action: gap resolution accepted');
    expect(consoleLogSpy).toHaveBeenCalledWith('Resolution key: ledger_linking_v2:ledger_posting:v1:cad-deposit');
    expect(consoleLogSpy).toHaveBeenCalledWith('Resolution: fiat cash movement');
  });

  it('lists persisted links-v2 relationships', async () => {
    const program = createProgram();

    await program.parseAsync(['links-v2', 'list'], { from: 'user' });

    expect(mockBuildLedgerLinkingRelationshipReader).toHaveBeenCalledWith({ tag: 'db' });
    expect(consoleLogSpy).toHaveBeenCalledWith('Links v2 relationships for default (#7)');
    expect(consoleLogSpy).toHaveBeenCalledWith('Relationships: 1');
    expect(consoleLogSpy).toHaveBeenCalledWith(
      '  #42 internal_transfer via exact_hash_transfer resolved 2 allocation(s) relationship:ledger-linking'
    );
  });

  it('views one persisted links-v2 relationship by stable key prefix', async () => {
    const program = createProgram();

    await program.parseAsync(['links-v2', 'view', 'relationship:ledger'], { from: 'user' });

    expect(consoleLogSpy).toHaveBeenCalledWith('Links v2 relationship #42');
    expect(consoleLogSpy).toHaveBeenCalledWith('Stable key: relationship:ledger-linking');
    expect(consoleLogSpy).toHaveBeenCalledWith('Status: resolved');
    expect(consoleLogSpy).toHaveBeenCalledWith('Recognition strategy: exact_hash_transfer');
    expect(consoleLogSpy).toHaveBeenCalledWith('Confidence: 1');
    expect(consoleLogSpy).toHaveBeenCalledWith('Allocations:');
    expect(consoleLogSpy).toHaveBeenCalledWith('  #1 source 1 ETH (blockchain:ethereum:native)');
    expect(consoleLogSpy).toHaveBeenCalledWith('    Activity: source_activity:v1:source');
    expect(consoleLogSpy).toHaveBeenCalledWith('    Activity: source_activity:v1:target');
  });

  it('lists accepted asset identity assertions under links-v2', async () => {
    const program = createProgram();

    await program.parseAsync(['links-v2', 'asset-identity', 'list'], { from: 'user' });

    expect(mockBuildLedgerLinkingAssetIdentityAssertionReader).toHaveBeenCalledWith({ tag: 'db' });
    expect(consoleLogSpy).toHaveBeenCalledWith('Links v2 asset identity assertions for default (#7)');
    expect(consoleLogSpy).toHaveBeenCalledWith(
      '  internal_transfer: blockchain:ethereum:native <-> exchange:kraken:eth (manual)'
    );
  });

  it('accepts one asset identity assertion under links-v2', async () => {
    const program = createProgram();

    await program.parseAsync(
      [
        'links-v2',
        'asset-identity',
        'accept',
        '--asset-id-a',
        'exchange:kraken:eth',
        '--asset-id-b',
        'blockchain:ethereum:native',
      ],
      { from: 'user' }
    );

    expect(mockOverrideStoreAppend).toHaveBeenCalledWith({
      profileKey: 'default',
      scope: 'ledger-linking-asset-identity-accept',
      payload: {
        asset_id_a: 'blockchain:ethereum:native',
        asset_id_b: 'exchange:kraken:eth',
        evidence_kind: 'manual',
        relationship_kind: 'internal_transfer',
        type: 'ledger_linking_asset_identity_accept',
      },
    });
    expect(consoleLogSpy).toHaveBeenCalledWith('Links v2 asset identity override accepted.');
    expect(consoleLogSpy).toHaveBeenCalledWith('Override event: override-event-1');
    expect(consoleLogSpy).toHaveBeenCalledWith('Assets: blockchain:ethereum:native <-> exchange:kraken:eth');
    expect(consoleLogSpy).toHaveBeenCalledWith('Materialized assertions: 1 saved, 0 replaced');
  });

  it('previews asset identity suggestions under links-v2 without writing', async () => {
    const program = createProgram();
    mockRunLedgerLinking.mockResolvedValue(
      ok({
        ...makeRunResult(),
        assetIdentitySuggestions: [makeAssetIdentitySuggestion()],
        exactHashAssetIdentityBlocks: [makeAssetIdentityBlock()],
      })
    );

    await program.parseAsync(['links-v2', 'asset-identity', 'suggestions'], { from: 'user' });

    expect(mockRunLedgerLinking).toHaveBeenCalledWith(7, { tag: 'ledger-linking-ports' }, { dryRun: true });
    expect(consoleLogSpy).toHaveBeenCalledWith('Links v2 asset identity suggestions for default (#7)');
    expect(consoleLogSpy).toHaveBeenCalledWith('Suggestions: 1 of 1');
    expect(consoleLogSpy).toHaveBeenCalledWith(
      'Evidence: 1 exact-hash blocker(s), 0 fee-adjusted exact-hash blocker(s), 0 amount/time blocker(s)'
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      '  internal_transfer ETH: blockchain:ethereum:native <-> exchange:kraken:eth (1 exact-hash blocker(s))'
    );
    expect(consoleLogSpy).toHaveBeenCalledWith('    example: 1 ETH, hash 0xabc');
    expect(consoleLogSpy).toHaveBeenCalledWith(
      '    accept: exitbook links-v2 asset-identity accept --asset-id-a blockchain:ethereum:native --asset-id-b exchange:kraken:eth --relationship-kind internal_transfer --evidence-kind exact_hash_observed'
    );
  });
});

function makeRunResult() {
  return {
    acceptedRelationships: [
      {
        allocations: makeRelationshipAllocations(),
        confidenceScore: '1',
        evidence: { amount: '1' },
        recognitionStrategy: 'exact_hash_transfer',
        relationshipStableKey: 'ledger-linking:exact_hash_transfer:v1:test',
        relationshipKind: 'internal_transfer',
      },
    ],
    assetIdentitySuggestions: [],
    deterministicRecognizerStats: [
      {
        claimedCandidateCount: 2,
        consumedCandidateCount: 2,
        name: 'exact_hash_transfer',
        relationshipCount: 1,
      },
      {
        claimedCandidateCount: 0,
        consumedCandidateCount: 0,
        name: 'fee_adjusted_exact_hash_transfer',
        relationshipCount: 0,
      },
      {
        claimedCandidateCount: 0,
        consumedCandidateCount: 0,
        name: 'same_hash_grouped_transfer',
        relationshipCount: 0,
      },
      {
        claimedCandidateCount: 0,
        consumedCandidateCount: 0,
        name: 'counterparty_roundtrip',
        relationshipCount: 0,
      },
      {
        claimedCandidateCount: 0,
        consumedCandidateCount: 0,
        name: 'strict_exchange_amount_time_transfer',
        relationshipCount: 0,
      },
    ],
    counterpartyRoundtripAmbiguities: [],
    counterpartyRoundtripMatches: [],
    exactHashAmbiguities: [],
    exactHashAssetIdentityBlocks: [],
    exactHashMatches: [
      {
        strategy: 'exact_hash_transfer',
        sourceCandidateId: 1,
        targetCandidateId: 2,
        sourcePostingFingerprint: 'ledger_posting:v1:source',
        targetPostingFingerprint: 'ledger_posting:v1:target',
        sourceBlockchainTransactionHash: '0xabc',
        targetBlockchainTransactionHash: '0xABC',
        assetIdentityResolution: {
          reason: 'same_asset_id',
          status: 'accepted',
        },
        sourceAssetId: 'blockchain:ethereum:native',
        targetAssetId: 'blockchain:ethereum:native',
        amount: '1',
        relationship: {
          allocations: makeRelationshipAllocations(),
          confidenceScore: '1',
          evidence: { amount: '1' },
          recognitionStrategy: 'exact_hash_transfer',
          relationshipStableKey: 'ledger-linking:exact_hash_transfer:v1:test',
          relationshipKind: 'internal_transfer',
        },
      },
    ],
    feeAdjustedExactHashAmbiguities: [],
    feeAdjustedExactHashAssetIdentityBlocks: [],
    feeAdjustedExactHashMatches: [],
    matchedSourceCandidateCount: 1,
    matchedTargetCandidateCount: 1,
    persistence: {
      mode: 'persisted',
      materialization: {
        previousCount: 0,
        savedCount: 1,
        resolvedAllocationCount: 2,
        unresolvedAllocationCount: 0,
      },
    },
    postingInputCount: 3,
    reviewedRelationshipOverrideMatches: [],
    sameHashGroupedMatches: [],
    sameHashGroupedUnresolvedGroups: [],
    skippedCandidates: [
      {
        postingFingerprint: 'ledger_posting:v1:fee',
        reason: 'non_principal_role',
      },
    ],
    sourceCandidateCount: 1,
    strictExchangeAmountTimeTransferAmbiguities: [],
    strictExchangeAmountTimeTransferMatches: [],
    targetCandidateCount: 1,
    transferCandidateCount: 2,
    unmatchedSourceCandidateCount: 0,
    unmatchedTargetCandidateCount: 0,
  };
}

function makeAssetIdentitySuggestion() {
  return {
    assetIdA: 'blockchain:ethereum:native',
    assetIdB: 'exchange:kraken:eth',
    assetSymbol: 'ETH',
    blockCount: 1,
    evidenceKind: 'exact_hash_observed',
    examples: [
      {
        amount: '1',
        sourceBlockchainTransactionHash: '0xabc',
        sourcePostingFingerprint: 'ledger_posting:v1:source',
        targetBlockchainTransactionHash: 'ABC',
        targetPostingFingerprint: 'ledger_posting:v1:target',
      },
    ],
    relationshipKind: 'internal_transfer',
  };
}

function makeDiagnostics() {
  const source = {
    activityDatetime: new Date('2026-04-23T00:00:00.000Z'),
    assetId: 'exchange:kraken:eth',
    assetSymbol: 'ETH',
    blockchainTransactionHash: 'source-hash',
    candidateId: 7,
    claimedAmount: '0',
    direction: 'source',
    fromAddress: '0xfrom',
    journalFingerprint: 'ledger_journal:v1:source',
    journalDiagnosticCodes: [],
    originalAmount: '1',
    ownerAccountId: 1,
    platformKey: 'kraken',
    platformKind: 'exchange',
    postingFingerprint: 'ledger_posting:v1:diagnostic-source',
    remainingAmount: '1',
    sourceActivityFingerprint: 'source_activity:v1:diagnostic-source',
    toAddress: '0xto',
  };
  const target = {
    activityDatetime: new Date('2026-04-23T00:30:00.000Z'),
    assetId: 'blockchain:ethereum:native',
    assetSymbol: 'ETH',
    blockchainTransactionHash: 'target-hash',
    candidateId: 8,
    claimedAmount: '0',
    direction: 'target',
    fromAddress: '0xfrom',
    journalFingerprint: 'ledger_journal:v1:target',
    journalDiagnosticCodes: [],
    originalAmount: '1',
    ownerAccountId: 2,
    platformKey: 'ethereum',
    platformKind: 'blockchain',
    postingFingerprint: 'ledger_posting:v1:diagnostic-target',
    remainingAmount: '1',
    sourceActivityFingerprint: 'source_activity:v1:diagnostic-target',
    toAddress: '0xto',
  };

  return {
    assetIdentityBlockerProposalCount: 0,
    assetIdentityBlockerProposals: [],
    amountTimeProposalCount: 1,
    amountTimeProposalGroups: [
      {
        amount: '1',
        ambiguousProposalCount: 0,
        assetSymbol: 'ETH',
        maxTimeDistanceSeconds: 1800,
        minTimeDistanceSeconds: 1800,
        proposalCount: 1,
        sourcePlatformKey: 'kraken',
        sourcePlatformKind: 'exchange',
        targetPlatformKey: 'ethereum',
        targetPlatformKind: 'blockchain',
        uniqueProposalCount: 1,
      },
    ],
    amountTimeProposals: [
      {
        amount: '1',
        assetIdentityReason: 'accepted_assertion',
        assetSymbol: 'ETH',
        source,
        target,
        timeDirection: 'source_before_target',
        timeDistanceSeconds: 1800,
        uniqueness: 'unique_pair',
      },
    ],
    amountTimeUniqueProposalCount: 1,
    amountTimeWindowMinutes: 1440,
    candidateClassificationGroups: [
      {
        candidateCount: 2,
        classification: 'amount_time_unique',
        sourceCandidateCount: 1,
        targetCandidateCount: 1,
      },
    ],
    candidateClassifications: [
      {
        candidateId: 7,
        classifications: ['amount_time_unique'],
        direction: 'source',
        platformKey: 'kraken',
      },
      {
        candidateId: 8,
        classifications: ['amount_time_unique'],
        direction: 'target',
        platformKey: 'ethereum',
      },
    ],
    unmatchedCandidateGroups: [
      {
        assetId: 'exchange:kraken:eth',
        assetSymbol: 'ETH',
        candidateCount: 1,
        direction: 'source',
        earliestActivityDatetime: source.activityDatetime,
        latestActivityDatetime: source.activityDatetime,
        platformKey: 'kraken',
        platformKind: 'exchange',
        remainingAmountTotal: '1',
      },
      {
        assetId: 'blockchain:ethereum:native',
        assetSymbol: 'ETH',
        candidateCount: 1,
        direction: 'target',
        earliestActivityDatetime: target.activityDatetime,
        latestActivityDatetime: target.activityDatetime,
        platformKey: 'ethereum',
        platformKind: 'blockchain',
        remainingAmountTotal: '1',
      },
    ],
    unmatchedCandidates: [source, target],
  };
}

function makeGapResolutionReviewItem() {
  return {
    evidenceStrength: 'strong',
    kind: 'gap_resolution',
    resolution: {
      candidate: {
        activityDatetime: new Date('2026-04-23T01:00:00.000Z'),
        assetId: 'exchange:kraken:cad',
        assetSymbol: 'CAD',
        candidateId: 9,
        claimedAmount: '0',
        direction: 'target',
        journalFingerprint: 'ledger_journal:v1:cad-deposit',
        journalDiagnosticCodes: [],
        originalAmount: '100',
        ownerAccountId: 3,
        platformKey: 'kraken',
        platformKind: 'exchange',
        postingFingerprint: 'ledger_posting:v1:cad-deposit',
        remainingAmount: '100',
        sourceActivityFingerprint: 'source_activity:v1:cad-deposit',
      },
      classifications: ['fiat_cash_movement'],
      resolutionKey: 'ledger_linking_v2:ledger_posting:v1:cad-deposit',
      resolutionKind: 'fiat_cash_movement',
    },
    reviewId: 'gr_test_1',
  };
}

function makeRelationshipAllocations() {
  return [
    {
      allocationSide: 'source',
      sourceActivityFingerprint: 'source_activity:v1:source',
      journalFingerprint: 'ledger_journal:v1:source',
      postingFingerprint: 'ledger_posting:v1:source',
      quantity: '1',
    },
    {
      allocationSide: 'target',
      sourceActivityFingerprint: 'source_activity:v1:target',
      journalFingerprint: 'ledger_journal:v1:target',
      postingFingerprint: 'ledger_posting:v1:target',
      quantity: '1',
    },
  ];
}

function makeAssetIdentityBlock() {
  return {
    amount: '1',
    assetSymbol: 'ETH',
    reason: 'same_symbol_different_asset_ids',
    sourceAssetId: 'exchange:kraken:eth',
    sourceBlockchainTransactionHash: '0xabc',
    sourceCandidateId: 1,
    sourcePostingFingerprint: 'ledger_posting:v1:source',
    targetAssetId: 'blockchain:ethereum:native',
    targetBlockchainTransactionHash: '0xabc',
    targetCandidateId: 2,
    targetPostingFingerprint: 'ledger_posting:v1:target',
  };
}

function makePersistedRelationship() {
  return {
    id: 42,
    allocations: [
      {
        allocationSide: 'source',
        assetId: 'blockchain:ethereum:native',
        assetSymbol: 'ETH',
        id: 1,
        quantity: '1',
        sourceActivityFingerprint: 'source_activity:v1:source',
        journalFingerprint: 'ledger_journal:v1:source',
        postingFingerprint: 'ledger_posting:v1:source',
        currentJournalId: 100,
        currentPostingId: 101,
      },
      {
        allocationSide: 'target',
        assetId: 'blockchain:ethereum:native',
        assetSymbol: 'ETH',
        id: 2,
        quantity: '1',
        sourceActivityFingerprint: 'source_activity:v1:target',
        journalFingerprint: 'ledger_journal:v1:target',
        postingFingerprint: 'ledger_posting:v1:target',
        currentJournalId: 200,
        currentPostingId: 201,
      },
    ],
    relationshipStableKey: 'relationship:ledger-linking',
    relationshipKind: 'internal_transfer',
    recognitionStrategy: 'exact_hash_transfer',
    evidence: { amount: '1' },
    confidenceScore: '1',
    createdAt: '2026-04-29T00:00:00.000Z',
    updatedAt: undefined,
  };
}
