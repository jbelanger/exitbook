import { err, ok } from '@exitbook/foundation';
import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CliAppRuntime } from '../../../../runtime/app-runtime.js';

const {
  mockBuildLedgerLinkingRunPorts,
  mockCtx,
  mockExitCliFailure,
  mockOutputSuccess,
  mockResolveCommandProfile,
  mockRunCommand,
  mockRunLedgerLinking,
} = vi.hoisted(() => ({
  mockBuildLedgerLinkingRunPorts: vi.fn(),
  mockCtx: {
    openDatabaseSession: vi.fn(),
  },
  mockExitCliFailure: vi.fn(),
  mockOutputSuccess: vi.fn(),
  mockResolveCommandProfile: vi.fn(),
  mockRunCommand: vi.fn(),
  mockRunLedgerLinking: vi.fn(),
}));

vi.mock('@exitbook/accounting/ledger-linking', () => ({
  runLedgerLinking: mockRunLedgerLinking,
}));

vi.mock('@exitbook/data/accounting', () => ({
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
    expect(mockBuildLedgerLinkingRunPorts).toHaveBeenCalledWith({ tag: 'db' });
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
    expect(consoleLogSpy).toHaveBeenCalledWith('Accepted relationships: 1');
    expect(consoleLogSpy).toHaveBeenCalledWith('Exact-hash ambiguities: 0');
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
});

function makeRunResult() {
  return {
    postingInputCount: 3,
    transferCandidateCount: 2,
    sourceCandidateCount: 1,
    targetCandidateCount: 1,
    skippedCandidates: [
      {
        postingFingerprint: 'ledger_posting:v1:fee',
        reason: 'non_principal_role',
      },
    ],
    exactHashMatches: [
      {
        strategy: 'exact_hash_transfer',
        sourceCandidateId: 1,
        targetCandidateId: 2,
        sourcePostingFingerprint: 'ledger_posting:v1:source',
        targetPostingFingerprint: 'ledger_posting:v1:target',
        sourceBlockchainTransactionHash: '0xabc',
        targetBlockchainTransactionHash: '0xABC',
        assetId: 'blockchain:ethereum:native',
        amount: '1',
        relationship: {
          relationshipStableKey: 'ledger-linking:exact_hash_transfer:v1:test',
          relationshipKind: 'internal_transfer',
          source: {
            sourceActivityFingerprint: 'source_activity:v1:source',
            journalFingerprint: 'ledger_journal:v1:source',
            postingFingerprint: 'ledger_posting:v1:source',
          },
          target: {
            sourceActivityFingerprint: 'source_activity:v1:target',
            journalFingerprint: 'ledger_journal:v1:target',
            postingFingerprint: 'ledger_posting:v1:target',
          },
        },
      },
    ],
    exactHashAmbiguities: [],
    acceptedRelationships: [
      {
        relationshipStableKey: 'ledger-linking:exact_hash_transfer:v1:test',
        relationshipKind: 'internal_transfer',
        source: {
          sourceActivityFingerprint: 'source_activity:v1:source',
          journalFingerprint: 'ledger_journal:v1:source',
          postingFingerprint: 'ledger_posting:v1:source',
        },
        target: {
          sourceActivityFingerprint: 'source_activity:v1:target',
          journalFingerprint: 'ledger_journal:v1:target',
          postingFingerprint: 'ledger_posting:v1:target',
        },
      },
    ],
    persistence: {
      mode: 'persisted',
      materialization: {
        previousCount: 0,
        savedCount: 1,
        resolvedEndpointCount: 2,
        unresolvedEndpointCount: 0,
      },
    },
  };
}
