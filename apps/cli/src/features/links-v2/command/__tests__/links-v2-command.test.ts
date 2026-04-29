import { ok } from '@exitbook/foundation';
import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CliAppRuntime } from '../../../../runtime/app-runtime.js';

const {
  mockBuildLedgerLinkingAssetIdentityAssertionReader,
  mockBuildLedgerLinkingAssetIdentityAssertionStore,
  mockBuildLedgerLinkingRelationshipReader,
  mockBuildLedgerLinkingRunPorts,
  mockCtx,
  mockExitCliFailure,
  mockLoadLedgerLinkingAssetIdentityAssertions,
  mockLoadLedgerLinkingRelationships,
  mockOutputSuccess,
  mockResolveCommandProfile,
  mockRunCommand,
  mockRunLedgerLinking,
  mockSaveLedgerLinkingAssetIdentityAssertion,
} = vi.hoisted(() => ({
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
  mockOutputSuccess: vi.fn(),
  mockResolveCommandProfile: vi.fn(),
  mockRunCommand: vi.fn(),
  mockRunLedgerLinking: vi.fn(),
  mockSaveLedgerLinkingAssetIdentityAssertion: vi.fn(),
}));

vi.mock('@exitbook/accounting/ledger-linking', () => ({
  runLedgerLinking: mockRunLedgerLinking,
}));

vi.mock('@exitbook/data/accounting', () => ({
  buildLedgerLinkingAssetIdentityAssertionReader: mockBuildLedgerLinkingAssetIdentityAssertionReader,
  buildLedgerLinkingAssetIdentityAssertionStore: mockBuildLedgerLinkingAssetIdentityAssertionStore,
  buildLedgerLinkingRelationshipReader: mockBuildLedgerLinkingRelationshipReader,
  buildLedgerLinkingRunPorts: mockBuildLedgerLinkingRunPorts,
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
      saveLedgerLinkingAssetIdentityAssertion: mockSaveLedgerLinkingAssetIdentityAssertion,
    });
    mockBuildLedgerLinkingRelationshipReader.mockReturnValue({
      loadLedgerLinkingRelationships: mockLoadLedgerLinkingRelationships,
    });
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

    expect(mockBuildLedgerLinkingAssetIdentityAssertionStore).toHaveBeenCalledWith({ tag: 'db' });
    expect(mockSaveLedgerLinkingAssetIdentityAssertion).toHaveBeenCalledWith(7, {
      assetIdA: 'exchange:kraken:eth',
      assetIdB: 'blockchain:ethereum:native',
      evidenceKind: 'manual',
      relationshipKind: 'internal_transfer',
    });
    expect(consoleLogSpy).toHaveBeenCalledWith('Links v2 asset identity assertion created.');
    expect(consoleLogSpy).toHaveBeenCalledWith('Assets: blockchain:ethereum:native <-> exchange:kraken:eth');
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
    expect(consoleLogSpy).toHaveBeenCalledWith('Suggestions: 1 of 1 from 1 exact-hash blocker(s)');
    expect(consoleLogSpy).toHaveBeenCalledWith(
      '  internal_transfer ETH: blockchain:ethereum:native <-> exchange:kraken:eth (1 blocker(s))'
    );
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
    sameHashGroupedMatches: [],
    sameHashGroupedUnresolvedGroups: [],
    skippedCandidates: [
      {
        postingFingerprint: 'ledger_posting:v1:fee',
        reason: 'non_principal_role',
      },
    ],
    sourceCandidateCount: 1,
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
