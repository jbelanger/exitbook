import type { LedgerLinkingRelationshipAcceptPayload } from '@exitbook/core';
import { ok } from '@exitbook/foundation';
import { Command } from 'commander';
import { Decimal } from 'decimal.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CliAppRuntime } from '../../../../runtime/app-runtime.js';

const {
  mockBuildLedgerLinkingReviewQueue,
  mockBuildLedgerLinkingAssetIdentityAssertionReader,
  mockBuildLedgerLinkingAssetIdentityAssertionStore,
  mockBuildLedgerLinkingCandidateSourceReader,
  mockBuildLedgerLinkingRelationshipReader,
  mockBuildLedgerLinkingRunPorts,
  mockBuildLedgerTransferLinkingCandidates,
  mockCtx,
  mockExitCliFailure,
  mockLoadLedgerLinkingAssetIdentityAssertions,
  mockLoadLedgerLinkingPostingInputs,
  mockLoadLedgerLinkingRelationships,
  mockMaterializeStoredLedgerLinkingAssetIdentityAssertions,
  mockOutputSuccess,
  mockOverrideStoreAppend,
  mockOverrideStoreConstructor,
  mockReadLedgerLinkingAssetIdentityAssertionOverrides,
  mockReadLedgerLinkingRelationshipOverrides,
  mockReadResolvedLedgerLinkingGapResolutionKeys,
  mockReadResolvedLedgerLinkingGapResolutions,
  mockResolveCommandProfile,
  mockRunCommand,
  mockRunLedgerLinking,
  mockReplaceLedgerLinkingAssetIdentityAssertions,
  mockSaveLedgerLinkingAssetIdentityAssertion,
} = vi.hoisted(() => ({
  mockBuildLedgerLinkingReviewQueue: vi.fn(),
  mockBuildLedgerLinkingAssetIdentityAssertionReader: vi.fn(),
  mockBuildLedgerLinkingAssetIdentityAssertionStore: vi.fn(),
  mockBuildLedgerLinkingCandidateSourceReader: vi.fn(),
  mockBuildLedgerLinkingRelationshipReader: vi.fn(),
  mockBuildLedgerLinkingRunPorts: vi.fn(),
  mockBuildLedgerTransferLinkingCandidates: vi.fn(),
  mockCtx: {
    openDatabaseSession: vi.fn(),
  },
  mockExitCliFailure: vi.fn(),
  mockLoadLedgerLinkingAssetIdentityAssertions: vi.fn(),
  mockLoadLedgerLinkingPostingInputs: vi.fn(),
  mockLoadLedgerLinkingRelationships: vi.fn(),
  mockMaterializeStoredLedgerLinkingAssetIdentityAssertions: vi.fn(),
  mockOutputSuccess: vi.fn(),
  mockOverrideStoreAppend: vi.fn(),
  mockOverrideStoreConstructor: vi.fn(),
  mockReadLedgerLinkingAssetIdentityAssertionOverrides: vi.fn(),
  mockReadLedgerLinkingRelationshipOverrides: vi.fn(),
  mockReadResolvedLedgerLinkingGapResolutionKeys: vi.fn(),
  mockReadResolvedLedgerLinkingGapResolutions: vi.fn(),
  mockResolveCommandProfile: vi.fn(),
  mockRunCommand: vi.fn(),
  mockRunLedgerLinking: vi.fn(),
  mockReplaceLedgerLinkingAssetIdentityAssertions: vi.fn(),
  mockSaveLedgerLinkingAssetIdentityAssertion: vi.fn(),
}));

vi.mock('@exitbook/accounting/ledger-linking', () => ({
  buildLedgerTransferLinkingCandidates: mockBuildLedgerTransferLinkingCandidates,
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
  buildLedgerLinkingCandidateSourceReader: mockBuildLedgerLinkingCandidateSourceReader,
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
  readLedgerLinkingAssetIdentityAssertionOverrides: mockReadLedgerLinkingAssetIdentityAssertionOverrides,
  readLedgerLinkingRelationshipOverrides: mockReadLedgerLinkingRelationshipOverrides,
  readResolvedLedgerLinkingGapResolutionKeys: mockReadResolvedLedgerLinkingGapResolutionKeys,
  readResolvedLedgerLinkingGapResolutions: mockReadResolvedLedgerLinkingGapResolutions,
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

function getLastRelationshipAcceptAppendInput(): {
  payload: LedgerLinkingRelationshipAcceptPayload;
  profileKey: string;
  scope: 'ledger-linking-relationship-accept';
} {
  const call = mockOverrideStoreAppend.mock.calls.at(-1);
  const input = call?.[0] as
    | {
        payload: LedgerLinkingRelationshipAcceptPayload;
        profileKey: string;
        scope: 'ledger-linking-relationship-accept';
      }
    | undefined;
  if (input === undefined) {
    throw new Error('Expected an override append call');
  }

  return input;
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
    mockCtx.openDatabaseSession.mockResolvedValue({
      tag: 'db',
      profiles: {
        list: vi.fn().mockResolvedValue(
          ok([
            {
              createdAt: new Date('2026-04-28T00:00:00.000Z'),
              displayName: 'Default',
              id: 7,
              profileKey: 'default',
            },
          ])
        ),
      },
    });
    mockResolveCommandProfile.mockResolvedValue(
      ok({
        id: 7,
        profileKey: 'default',
        displayName: 'Default',
        createdAt: new Date('2026-04-28T00:00:00.000Z'),
      })
    );
    mockBuildLedgerLinkingRunPorts.mockReturnValue({ tag: 'ledger-linking-ports' });
    mockBuildLedgerLinkingCandidateSourceReader.mockReturnValue({
      loadLedgerLinkingPostingInputs: mockLoadLedgerLinkingPostingInputs,
    });
    mockLoadLedgerLinkingPostingInputs.mockResolvedValue(ok([]));
    mockBuildLedgerTransferLinkingCandidates.mockReturnValue(
      ok({
        candidates: makeManualRelationshipCandidates(),
        skipped: [],
      })
    );
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
    mockReadLedgerLinkingAssetIdentityAssertionOverrides.mockResolvedValue(
      ok([
        {
          assetIdA: 'blockchain:ethereum:native',
          assetIdB: 'exchange:kraken:eth',
          evidenceKind: 'manual',
          relationshipKind: 'internal_transfer',
        },
      ])
    );
    mockReadLedgerLinkingRelationshipOverrides.mockResolvedValue(ok([{}]));
    mockReadResolvedLedgerLinkingGapResolutions.mockResolvedValue(ok(new Map()));
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
      relatedProfileCounterpartsByCandidateId: new Map(),
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
          sourceQuantity: '1',
          targetQuantity: '1',
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

  it('accepts asset-migration link proposals with separate source and target quantities', async () => {
    const program = createProgram();
    const reviewItem = makeAssetMigrationReviewItem();
    mockBuildLedgerLinkingReviewQueue.mockReturnValue({
      assetIdentitySuggestionCount: 0,
      gapResolutionCount: 0,
      itemCount: 1,
      items: [reviewItem],
      linkProposalCount: 1,
    });
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
              reviewId: 'lp_migration_1',
              allocations: [
                {
                  allocationSide: 'source',
                  candidateId: 91,
                  postingFingerprint: 'ledger_posting:v1:migration-source',
                  quantity: '64.98757287',
                },
                {
                  allocationSide: 'target',
                  candidateId: 92,
                  postingFingerprint: 'ledger_posting:v1:migration-target',
                  quantity: '64.987572',
                },
              ],
            },
          ],
        })
      );

    await program.parseAsync(['links-v2', 'review', 'accept', 'lp_migration_1'], { from: 'user' });

    expect(mockOverrideStoreAppend).toHaveBeenCalledWith({
      profileKey: 'default',
      scope: 'ledger-linking-relationship-accept',
      payload: {
        allocations: [
          {
            allocation_side: 'source',
            asset_id: 'exchange:kraken:rndr',
            asset_symbol: 'RNDR',
            journal_fingerprint: 'ledger_journal:v1:migration-source',
            posting_fingerprint: 'ledger_posting:v1:migration-source',
            quantity: '64.98757287',
            source_activity_fingerprint: 'source_activity:v1:migration-source',
          },
          {
            allocation_side: 'target',
            asset_id: 'exchange:kraken:render',
            asset_symbol: 'RENDER',
            journal_fingerprint: 'ledger_journal:v1:migration-target',
            posting_fingerprint: 'ledger_posting:v1:migration-target',
            quantity: '64.987572',
            source_activity_fingerprint: 'source_activity:v1:migration-target',
          },
        ],
        evidence: {
          assetMigrationEvidence: 'processor_context_approximate_amount',
          proposalUniqueness: 'unique_pair',
          sourceAssetSymbol: 'RNDR',
          sourceQuantity: '64.98757287',
          targetAssetSymbol: 'RENDER',
          targetQuantity: '64.987572',
          timeDirection: 'target_before_source',
          timeDistanceSeconds: 777906,
        },
        proposal_kind: 'processor_asset_migration',
        relationship_kind: 'asset_migration',
        review_id: 'lp_migration_1',
        type: 'ledger_linking_relationship_accept',
      },
    });
    expect(consoleLogSpy).toHaveBeenCalledWith('Action: reviewed link override accepted');
  });

  it('creates manual reviewed relationship overrides from posting fingerprints', async () => {
    const program = createProgram();
    mockRunLedgerLinking.mockResolvedValue(
      ok({
        ...makeRunResult(),
        reviewedRelationshipOverrideMatches: [
          {
            allocations: [
              {
                allocationSide: 'source',
                candidateId: 11,
                postingFingerprint: 'ledger_posting:v1:manual-source',
                quantity: '19.5536',
              },
              {
                allocationSide: 'target',
                candidateId: 12,
                postingFingerprint: 'ledger_posting:v1:manual-target',
                quantity: '19.5536',
              },
            ],
            overrideEventId: 'override-event-1',
            relationshipStableKey: 'ledger-linking:reviewed_relationship:v2:test',
            reviewId: 'manual_test',
          },
        ],
      })
    );

    await program.parseAsync(
      [
        'links-v2',
        'review',
        'create',
        'relationship',
        '--relationship-kind',
        'asset_migration',
        '--source-posting',
        'ledger_posting:v1:manual-source',
        '--target-posting',
        'ledger_posting:v1:manual-target',
        '--reason',
        'RNDR to RENDER migration evidence',
      ],
      { from: 'user' }
    );

    expect(mockBuildLedgerLinkingCandidateSourceReader).toHaveBeenCalledWith(expect.objectContaining({ tag: 'db' }));
    const appendInput = getLastRelationshipAcceptAppendInput();
    expect(appendInput.profileKey).toBe('default');
    expect(appendInput.scope).toBe('ledger-linking-relationship-accept');
    expect(appendInput.payload.allocations).toEqual([
      {
        allocation_side: 'source',
        asset_id: 'exchange:kucoin:rndr',
        asset_symbol: 'RNDR',
        journal_fingerprint: 'ledger_journal:v1:manual-source',
        posting_fingerprint: 'ledger_posting:v1:manual-source',
        quantity: '19.5536',
        source_activity_fingerprint: 'source_activity:v1:manual-source',
      },
      {
        allocation_side: 'target',
        asset_id: 'blockchain:ethereum:render',
        asset_symbol: 'RENDER',
        journal_fingerprint: 'ledger_journal:v1:manual-target',
        posting_fingerprint: 'ledger_posting:v1:manual-target',
        quantity: '19.5536',
        source_activity_fingerprint: 'source_activity:v1:manual-target',
      },
    ]);
    expect(appendInput.payload.evidence['reason']).toBe('RNDR to RENDER migration evidence');
    expect(appendInput.payload.evidence['sourceCandidateId']).toBe(11);
    expect(appendInput.payload.evidence['targetCandidateId']).toBe(12);
    expect(appendInput.payload.proposal_kind).toBe('manual_relationship');
    expect(appendInput.payload.relationship_kind).toBe('asset_migration');
    expect(appendInput.payload.type).toBe('ledger_linking_relationship_accept');
    expect(consoleLogSpy).toHaveBeenCalledWith('Action: manual reviewed link override accepted');
    expect(consoleLogSpy).toHaveBeenCalledWith('Relationship kind: asset_migration');
    expect(consoleLogSpy).toHaveBeenCalledWith('Source posting: ledger_posting:v1:manual-source');
    expect(consoleLogSpy).toHaveBeenCalledWith('Target posting: ledger_posting:v1:manual-target');
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

  it('revokes a reviewed relationship override from links-v2 review', async () => {
    const program = createProgram();
    mockRunLedgerLinking.mockResolvedValue(
      ok({
        ...makeRunResult(),
        reviewedRelationshipOverrideMatches: [],
      })
    );

    await program.parseAsync(
      ['links-v2', 'review', 'revoke', 'relationship', 'ledger-linking:reviewed_relationship:v2:test'],
      { from: 'user' }
    );

    expect(mockReadLedgerLinkingRelationshipOverrides).toHaveBeenCalled();
    expect(mockOverrideStoreAppend).toHaveBeenCalledWith({
      profileKey: 'default',
      scope: 'ledger-linking-relationship-revoke',
      payload: {
        relationship_stable_key: 'ledger-linking:reviewed_relationship:v2:test',
        type: 'ledger_linking_relationship_revoke',
      },
      reason: 'Revoked links-v2 reviewed relationship override',
    });
    expect(mockRunLedgerLinking).toHaveBeenLastCalledWith(
      7,
      { tag: 'ledger-linking-ports' },
      {
        dryRun: false,
        includeDiagnostics: true,
      }
    );
    expect(consoleLogSpy).toHaveBeenCalledWith('Action: reviewed link override revoked');
  });

  it('revokes a gap resolution from links-v2 review', async () => {
    const program = createProgram();
    mockReadResolvedLedgerLinkingGapResolutions.mockResolvedValue(
      ok(new Map([['ledger_linking_v2:ledger_posting:v1:cad-deposit', { reviewId: 'gr_test_1' }]]))
    );

    await program.parseAsync(['links-v2', 'review', 'revoke', 'gap-resolution', 'ledger_posting:v1:cad-deposit'], {
      from: 'user',
    });

    expect(mockOverrideStoreAppend).toHaveBeenCalledWith({
      profileKey: 'default',
      scope: 'ledger-linking-gap-resolution-revoke',
      payload: {
        posting_fingerprint: 'ledger_posting:v1:cad-deposit',
        type: 'ledger_linking_gap_resolution_revoke',
      },
      reason: 'Revoked links-v2 gap resolution',
    });
    expect(consoleLogSpy).toHaveBeenCalledWith('Action: gap resolution revoked');
    expect(consoleLogSpy).toHaveBeenCalledWith('Resolution key: ledger_linking_v2:ledger_posting:v1:cad-deposit');
  });

  it('lists persisted links-v2 relationships', async () => {
    const program = createProgram();

    await program.parseAsync(['links-v2', 'list'], { from: 'user' });

    expect(mockBuildLedgerLinkingRelationshipReader).toHaveBeenCalledWith(expect.objectContaining({ tag: 'db' }));
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

    expect(mockBuildLedgerLinkingAssetIdentityAssertionReader).toHaveBeenCalledWith(
      expect.objectContaining({ tag: 'db' })
    );
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

  it('revokes one asset identity assertion under links-v2', async () => {
    const program = createProgram();

    await program.parseAsync(
      [
        'links-v2',
        'asset-identity',
        'revoke',
        '--asset-id-a',
        'exchange:kraken:eth',
        '--asset-id-b',
        'blockchain:ethereum:native',
      ],
      { from: 'user' }
    );

    expect(mockReadLedgerLinkingAssetIdentityAssertionOverrides).toHaveBeenCalled();
    expect(mockOverrideStoreAppend).toHaveBeenCalledWith({
      profileKey: 'default',
      scope: 'ledger-linking-asset-identity-revoke',
      payload: {
        asset_id_a: 'blockchain:ethereum:native',
        asset_id_b: 'exchange:kraken:eth',
        relationship_kind: 'internal_transfer',
        type: 'ledger_linking_asset_identity_revoke',
      },
      reason: 'Revoked links-v2 asset identity assertion',
    });
    expect(consoleLogSpy).toHaveBeenCalledWith('Links v2 asset identity override revoked.');
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

function makeManualRelationshipCandidates() {
  return [
    {
      activityDatetime: new Date('2026-04-23T00:00:00.000Z'),
      amount: new Decimal('19.5536'),
      assetId: 'exchange:kucoin:rndr',
      assetSymbol: 'RNDR',
      blockchainTransactionHash: undefined,
      candidateId: 11,
      direction: 'source',
      fromAddress: undefined,
      journalDiagnosticCodes: ['possible_asset_migration'],
      journalFingerprint: 'ledger_journal:v1:manual-source',
      ownerAccountId: 1,
      platformKey: 'kucoin',
      platformKind: 'exchange',
      postingFingerprint: 'ledger_posting:v1:manual-source',
      sourceActivityFingerprint: 'source_activity:v1:manual-source',
      toAddress: undefined,
    },
    {
      activityDatetime: new Date('2026-04-23T00:05:00.000Z'),
      amount: new Decimal('19.5536'),
      assetId: 'blockchain:ethereum:render',
      assetSymbol: 'RENDER',
      blockchainTransactionHash: '0xrender',
      candidateId: 12,
      direction: 'target',
      fromAddress: '0xfrom',
      journalDiagnosticCodes: ['possible_asset_migration'],
      journalFingerprint: 'ledger_journal:v1:manual-target',
      ownerAccountId: 2,
      platformKey: 'ethereum',
      platformKind: 'blockchain',
      postingFingerprint: 'ledger_posting:v1:manual-target',
      sourceActivityFingerprint: 'source_activity:v1:manual-target',
      toAddress: '0xto',
    },
  ];
}

function makeAssetMigrationReviewItem() {
  const source = {
    activityDatetime: new Date('2024-08-15T17:46:34.970Z'),
    assetId: 'exchange:kraken:rndr',
    assetSymbol: 'RNDR',
    blockchainTransactionHash: undefined,
    candidateId: 91,
    claimedAmount: '0',
    direction: 'source',
    fromAddress: undefined,
    journalFingerprint: 'ledger_journal:v1:migration-source',
    journalDiagnosticCodes: ['possible_asset_migration'],
    originalAmount: '64.98757287',
    ownerAccountId: 1,
    platformKey: 'kraken',
    platformKind: 'exchange',
    postingFingerprint: 'ledger_posting:v1:migration-source',
    remainingAmount: '64.98757287',
    sourceActivityFingerprint: 'source_activity:v1:migration-source',
    toAddress: undefined,
  };
  const target = {
    activityDatetime: new Date('2024-08-06T12:41:28.653Z'),
    assetId: 'exchange:kraken:render',
    assetSymbol: 'RENDER',
    blockchainTransactionHash: undefined,
    candidateId: 92,
    claimedAmount: '0',
    direction: 'target',
    fromAddress: undefined,
    journalFingerprint: 'ledger_journal:v1:migration-target',
    journalDiagnosticCodes: ['possible_asset_migration'],
    originalAmount: '64.987572',
    ownerAccountId: 1,
    platformKey: 'kraken',
    platformKind: 'exchange',
    postingFingerprint: 'ledger_posting:v1:migration-target',
    remainingAmount: '64.987572',
    sourceActivityFingerprint: 'source_activity:v1:migration-target',
    toAddress: undefined,
  };

  return {
    evidenceStrength: 'medium',
    kind: 'link_proposal',
    proposal: {
      evidence: 'processor_context_approximate_amount',
      source,
      sourceQuantity: '64.98757287',
      target,
      targetQuantity: '64.987572',
      timeDirection: 'target_before_source',
      timeDistanceSeconds: 777906,
      uniqueness: 'unique_pair',
    },
    proposalKind: 'processor_asset_migration',
    relationshipKind: 'asset_migration',
    reviewId: 'lp_migration_1',
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
    assetMigrationProposalCount: 0,
    assetMigrationProposals: [],
    assetMigrationUniqueProposalCount: 0,
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
        sourceQuantity: '1',
        target,
        targetQuantity: '1',
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
