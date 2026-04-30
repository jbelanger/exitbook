import { err, ok } from '@exitbook/foundation';
import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CliAppRuntime } from '../../../../runtime/app-runtime.js';

const {
  mockBuildLedgerLinkingAssetIdentityAssertionReader,
  mockBuildLedgerLinkingAssetIdentityAssertionStore,
  mockBuildLedgerLinkingRunPorts,
  mockCtx,
  mockExitCliFailure,
  mockLoadLedgerLinkingAssetIdentityAssertions,
  mockMaterializeStoredLedgerLinkingAssetIdentityAssertions,
  mockOutputSuccess,
  mockOverrideStoreAppend,
  mockOverrideStoreConstructor,
  mockResolveCommandProfile,
  mockReplaceLedgerLinkingAssetIdentityAssertions,
  mockRunCommand,
  mockRunLedgerLinking,
  mockSaveLedgerLinkingAssetIdentityAssertion,
} = vi.hoisted(() => ({
  mockBuildLedgerLinkingAssetIdentityAssertionReader: vi.fn(),
  mockBuildLedgerLinkingAssetIdentityAssertionStore: vi.fn(),
  mockBuildLedgerLinkingRunPorts: vi.fn(),
  mockCtx: {
    dataDir: '/tmp/exitbook-ledger-linking-v2',
    openDatabaseSession: vi.fn(),
  },
  mockExitCliFailure: vi.fn(),
  mockLoadLedgerLinkingAssetIdentityAssertions: vi.fn(),
  mockMaterializeStoredLedgerLinkingAssetIdentityAssertions: vi.fn(),
  mockOutputSuccess: vi.fn(),
  mockOverrideStoreAppend: vi.fn(),
  mockOverrideStoreConstructor: vi.fn(),
  mockResolveCommandProfile: vi.fn(),
  mockReplaceLedgerLinkingAssetIdentityAssertions: vi.fn(),
  mockRunCommand: vi.fn(),
  mockRunLedgerLinking: vi.fn(),
  mockSaveLedgerLinkingAssetIdentityAssertion: vi.fn(),
}));

vi.mock('@exitbook/accounting/ledger-linking', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@exitbook/accounting/ledger-linking')>()),
  runLedgerLinking: mockRunLedgerLinking,
}));

vi.mock('@exitbook/data/accounting', () => ({
  buildLedgerLinkingAssetIdentityAssertionReader: mockBuildLedgerLinkingAssetIdentityAssertionReader,
  buildLedgerLinkingAssetIdentityAssertionStore: mockBuildLedgerLinkingAssetIdentityAssertionStore,
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

import { registerLedgerLinkingV2Command } from '../ledger-linking-v2.js';

function createProgram(): Command {
  const program = new Command();
  registerLedgerLinkingV2Command(program.command('ledger'), {} as CliAppRuntime);
  return program;
}

describe('ledger linking-v2 command', () => {
  const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    consoleLogSpy.mockClear();

    mockRunCommand.mockImplementation(async (appOrFn: unknown, maybeFn?: (ctx: typeof mockCtx) => Promise<void>) => {
      const fn = typeof appOrFn === 'function' ? appOrFn : maybeFn;
      await fn?.(mockCtx);
    });
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
          evidence_kind: 'manual',
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
    mockRunLedgerLinking.mockResolvedValue(ok(makeRunResult()));
    mockExitCliFailure.mockImplementation(
      (command: string, failure: { error: Error; exitCode: number }, format: 'json' | 'text') => {
        throw new Error(`CLI:${command}:${format}:${failure.error.message}:${failure.exitCode}`);
      }
    );
  });

  it('runs ledger-linking v2 and emits JSON output', async () => {
    const program = createProgram();

    await program.parseAsync(['ledger', 'linking-v2', 'run', '--json'], { from: 'user' });

    expect(mockResolveCommandProfile).toHaveBeenCalledWith(mockCtx, { tag: 'db' });
    expect(mockBuildLedgerLinkingRunPorts).toHaveBeenCalledWith(
      { tag: 'db' },
      {
        overrideStore: {
          append: mockOverrideStoreAppend,
        },
      }
    );
    expect(mockRunLedgerLinking).toHaveBeenCalledWith(7, { tag: 'ledger-linking-ports' }, { dryRun: false });
    expect(mockOutputSuccess).toHaveBeenCalledOnce();
    expect(mockOutputSuccess.mock.calls[0]?.[0]).toBe('ledger-linking-v2-run');
    const output = mockOutputSuccess.mock.calls[0]?.[1] as unknown as {
      profile: { id: number; profileKey: string };
      run: { postingInputCount: number; transferCandidateCount: number };
    };
    expect(output.profile).toEqual({
      id: 7,
      profileKey: 'default',
    });
    expect(output.run).toMatchObject({
      postingInputCount: 3,
      transferCandidateCount: 2,
    });
  });

  it('prints a compact text summary in text mode', async () => {
    const program = createProgram();

    await program.parseAsync(['ledger', 'linking-v2', 'run'], { from: 'user' });

    expect(mockOutputSuccess).not.toHaveBeenCalled();
    expect(consoleLogSpy).toHaveBeenCalledWith('Ledger linking v2 completed.');
    expect(consoleLogSpy).toHaveBeenCalledWith('Mode: persisted');
    expect(consoleLogSpy).toHaveBeenCalledWith('Matched candidates: 1 source, 1 target');
    expect(consoleLogSpy).toHaveBeenCalledWith('Unmatched candidates: 0 source, 0 target');
    expect(consoleLogSpy).toHaveBeenCalledWith('Deterministic recognizers: 4');
    expect(consoleLogSpy).toHaveBeenCalledWith(
      '  exact_hash_transfer: 1 relationship(s), 2 claimed candidate(s), 2 fully consumed candidate(s)'
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      '  same_hash_grouped_transfer: 0 relationship(s), 0 claimed candidate(s), 0 fully consumed candidate(s)'
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      '  counterparty_roundtrip: 0 relationship(s), 0 claimed candidate(s), 0 fully consumed candidate(s)'
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      '  strict_exchange_amount_time_transfer: 0 relationship(s), 0 claimed candidate(s), 0 fully consumed candidate(s)'
    );
    expect(consoleLogSpy).toHaveBeenCalledWith('Accepted relationships: 1');
    expect(consoleLogSpy).toHaveBeenCalledWith('Exact-hash ambiguities: 0');
    expect(consoleLogSpy).toHaveBeenCalledWith('Exact-hash asset identity blocks: 0');
    expect(consoleLogSpy).toHaveBeenCalledWith('Same-hash grouped matches: 0');
    expect(consoleLogSpy).toHaveBeenCalledWith('Same-hash unresolved groups: 0');
    expect(consoleLogSpy).toHaveBeenCalledWith('Counterparty roundtrip matches: 0');
    expect(consoleLogSpy).toHaveBeenCalledWith('Counterparty roundtrip ambiguities: 0');
    expect(consoleLogSpy).toHaveBeenCalledWith('Strict exchange amount/time matches: 0');
    expect(consoleLogSpy).toHaveBeenCalledWith('Strict exchange amount/time ambiguities: 0');
    expect(consoleLogSpy).toHaveBeenCalledWith('Asset identity suggestions: 0');
  });

  it('passes dry-run mode through and prints planned materialization', async () => {
    const program = createProgram();
    mockRunLedgerLinking.mockResolvedValue(
      ok({
        ...makeRunResult(),
        persistence: {
          mode: 'dry_run',
          plannedRelationshipCount: 1,
        },
      })
    );

    await program.parseAsync(['ledger', 'linking-v2', 'run', '--dry-run'], { from: 'user' });

    expect(mockRunLedgerLinking).toHaveBeenCalledWith(7, { tag: 'ledger-linking-ports' }, { dryRun: true });
    expect(consoleLogSpy).toHaveBeenCalledWith('Mode: dry run');
    expect(consoleLogSpy).toHaveBeenCalledWith('Planned materialization: 1 relationship(s)');
  });

  it('routes run failures through the shared CLI boundary', async () => {
    const program = createProgram();
    const failure = new Error('ledger-linking failed');
    mockRunLedgerLinking.mockResolvedValue(err(failure));

    await expect(program.parseAsync(['ledger', 'linking-v2', 'run', '--json'], { from: 'user' })).rejects.toThrow(
      'CLI:ledger-linking-v2-run:json:ledger-linking failed:1'
    );
    expect(mockExitCliFailure).toHaveBeenCalledWith(
      'ledger-linking-v2-run',
      expect.objectContaining({ error: failure, exitCode: 1 }),
      'json'
    );
  });

  it('lists accepted asset identity assertions', async () => {
    const program = createProgram();

    await program.parseAsync(['ledger', 'linking-v2', 'asset-identity', 'list'], { from: 'user' });

    expect(mockBuildLedgerLinkingAssetIdentityAssertionReader).toHaveBeenCalledWith({ tag: 'db' });
    expect(consoleLogSpy).toHaveBeenCalledWith('Ledger linking asset identity assertions for default (#7)');
    expect(consoleLogSpy).toHaveBeenCalledWith('Assertions: 1');
    expect(consoleLogSpy).toHaveBeenCalledWith(
      '  internal_transfer: blockchain:ethereum:native <-> exchange:kraken:eth (manual)'
    );
  });

  it('accepts one asset identity assertion', async () => {
    const program = createProgram();

    await program.parseAsync(
      [
        'ledger',
        'linking-v2',
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
    expect(mockBuildLedgerLinkingAssetIdentityAssertionStore).toHaveBeenCalledWith({ tag: 'db' });
    expect(mockMaterializeStoredLedgerLinkingAssetIdentityAssertions).toHaveBeenCalledWith(
      expect.objectContaining({
        replaceLedgerLinkingAssetIdentityAssertions: mockReplaceLedgerLinkingAssetIdentityAssertions,
      }),
      expect.objectContaining({
        append: mockOverrideStoreAppend,
      }),
      7,
      'default'
    );
    expect(consoleLogSpy).toHaveBeenCalledWith('Ledger linking asset identity override accepted.');
    expect(consoleLogSpy).toHaveBeenCalledWith('Override event: override-event-1');
    expect(consoleLogSpy).toHaveBeenCalledWith('Assets: blockchain:ethereum:native <-> exchange:kraken:eth');
  });

  it('previews asset identity suggestions through the ledger alias', async () => {
    const program = createProgram();
    mockRunLedgerLinking.mockResolvedValue(
      ok({
        ...makeRunResult(),
        assetIdentitySuggestions: [makeAssetIdentitySuggestion()],
        exactHashAssetIdentityBlocks: [makeAssetIdentityBlock()],
      })
    );

    await program.parseAsync(['ledger', 'linking-v2', 'asset-identity', 'suggestions'], { from: 'user' });

    expect(mockRunLedgerLinking).toHaveBeenCalledWith(7, { tag: 'ledger-linking-ports' }, { dryRun: true });
    expect(consoleLogSpy).toHaveBeenCalledWith('Ledger linking asset identity suggestions for default (#7)');
    expect(consoleLogSpy).toHaveBeenCalledWith('Suggestions: 1 of 1');
    expect(consoleLogSpy).toHaveBeenCalledWith('Evidence: 1 exact-hash blocker(s), 0 amount/time blocker(s)');
    expect(consoleLogSpy).toHaveBeenCalledWith(
      '  internal_transfer ETH: blockchain:ethereum:native <-> exchange:kraken:eth (1 exact-hash blocker(s))'
    );
    expect(consoleLogSpy).toHaveBeenCalledWith('    example: 1 ETH, hash 0xabc');
    expect(consoleLogSpy).toHaveBeenCalledWith(
      '    accept: exitbook ledger linking-v2 asset-identity accept --asset-id-a blockchain:ethereum:native --asset-id-b exchange:kraken:eth --relationship-kind internal_transfer --evidence-kind exact_hash_observed'
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
        targetBlockchainTransactionHash: '0xabc',
        targetPostingFingerprint: 'ledger_posting:v1:target',
      },
    ],
    relationshipKind: 'internal_transfer',
  };
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
