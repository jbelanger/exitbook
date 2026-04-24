import { err, ok } from '@exitbook/foundation';
import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ExitCodes } from '../../../../cli/exit-codes.js';

const {
  mockBuildCliProfileService,
  mockClearCliStateFile,
  mockCtx,
  mockExitCliFailure,
  mockOutputSuccess,
  mockPrepareProfileRemoval,
  mockPromptConfirmDecision,
  mockReadCliStateFile,
  mockRunCommand,
  mockRunProfileRemoval,
} = vi.hoisted(() => ({
  mockBuildCliProfileService: vi.fn(),
  mockClearCliStateFile: vi.fn(),
  mockCtx: {
    activeProfileKey: 'other',
    activeProfileSource: 'state' as 'default' | 'env' | 'state',
    dataDir: '/tmp/exitbook',
    database: vi.fn(),
    openDatabaseSession: vi.fn(),
    closeDatabaseSession: vi.fn(),
  },
  mockExitCliFailure: vi.fn(),
  mockOutputSuccess: vi.fn(),
  mockPrepareProfileRemoval: vi.fn(),
  mockPromptConfirmDecision: vi.fn(),
  mockReadCliStateFile: vi.fn(),
  mockRunCommand: vi.fn(),
  mockRunProfileRemoval: vi.fn(),
}));

vi.mock('../../../../runtime/command-runtime.js', () => ({
  CommandRuntime: class {},
  runCommand: mockRunCommand,
}));

vi.mock('../../../../cli/error.js', () => ({
  exitCliFailure: mockExitCliFailure,
}));

vi.mock('../../../../cli/output.js', () => ({
  outputSuccess: mockOutputSuccess,
}));

vi.mock('../../../profiles/profile-service.js', () => ({
  buildCliProfileService: mockBuildCliProfileService,
}));

vi.mock('../../../../cli/prompts.js', () => ({
  promptConfirmDecision: mockPromptConfirmDecision,
}));

vi.mock('../run-profiles-remove.js', () => ({
  prepareProfileRemoval: mockPrepareProfileRemoval,
  runProfileRemoval: mockRunProfileRemoval,
}));

vi.mock('../../profile-state.js', () => ({
  clearCliStateFile: mockClearCliStateFile,
  readCliStateFile: mockReadCliStateFile,
}));

import { registerProfilesRemoveCommand } from '../profiles-remove.js';

function createProfilesProgram(): Command {
  const program = new Command();
  registerProfilesRemoveCommand(program.command('profiles'));
  return program;
}

beforeEach(() => {
  vi.clearAllMocks();

  mockCtx.activeProfileKey = 'other';
  mockCtx.activeProfileSource = 'state';
  mockCtx.dataDir = '/tmp/exitbook';
  mockCtx.database.mockResolvedValue({ tag: 'db' });
  mockCtx.openDatabaseSession.mockResolvedValue({ tag: 'db' });
  mockCtx.closeDatabaseSession.mockResolvedValue(undefined);
  mockRunCommand.mockImplementation(async (fn: (ctx: typeof mockCtx) => Promise<void>) => {
    await fn(mockCtx);
  });
  mockBuildCliProfileService.mockReturnValue({
    findByKey: vi.fn(),
  });
  mockPrepareProfileRemoval.mockResolvedValue(
    ok({
      profile: {
        id: 2,
        profileKey: 'business',
        displayName: 'Business / Family',
        createdAt: new Date('2026-03-27T00:00:00.000Z'),
      },
      profileLabel: 'Business / Family',
      accountIds: [8, 7],
      preview: {
        profiles: 1,
        accounts: 2,
        rawData: 4,
        sessions: 2,
        transactions: 8,
        ledgerSourceActivities: 2,
        links: 3,
        assetReviewStates: 1,
        balanceSnapshots: 1,
        balanceSnapshotAssets: 5,
        costBasisSnapshots: 6,
      },
    })
  );
  mockRunProfileRemoval.mockResolvedValue(
    ok({
      deleted: {
        profiles: 1,
        accounts: 2,
        rawData: 4,
        sessions: 2,
        transactions: 8,
        ledgerSourceActivities: 2,
        links: 3,
        assetReviewStates: 1,
        balanceSnapshots: 1,
        balanceSnapshotAssets: 5,
        costBasisSnapshots: 6,
      },
    })
  );
  mockReadCliStateFile.mockReturnValue(ok({}));
  mockClearCliStateFile.mockReturnValue(ok(undefined));
  mockPromptConfirmDecision.mockResolvedValue('confirmed');
  mockExitCliFailure.mockImplementation(
    (command: string, failure: { error: Error; exitCode: number }, format: 'json' | 'text') => {
      throw new Error(`CLI:${command}:${format}:${failure.error.message}:${failure.exitCode}`);
    }
  );
});

describe('profiles remove command', () => {
  it('requires --confirm in JSON mode', async () => {
    const program = createProfilesProgram();

    await expect(program.parseAsync(['profiles', 'remove', 'business', '--json'], { from: 'user' })).rejects.toThrow(
      'CLI:profiles-remove:json:--confirm is required when using --json for destructive profile removal:2'
    );
  });

  it('prints a success-marked confirmation in text mode', async () => {
    const program = createProfilesProgram();
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await program.parseAsync(['profiles', 'remove', 'business', '--confirm'], { from: 'user' });

    expect(mockRunProfileRemoval).toHaveBeenCalledWith({ tag: 'db' }, 'business', [8, 7]);
    expect(consoleLog).toHaveBeenCalledOnce();
    expect(consoleLog.mock.calls[0]?.[0]).toContain('✓');
    expect(consoleLog.mock.calls[0]?.[0]).toContain('Removed profile business (label: Business / Family)');
    consoleLog.mockRestore();
  });

  it('blocks removing the current profile', async () => {
    const program = createProfilesProgram();
    mockCtx.activeProfileKey = 'business';
    mockCtx.activeProfileSource = 'state';

    await expect(program.parseAsync(['profiles', 'remove', 'business', '--confirm'], { from: 'user' })).rejects.toThrow(
      "CLI:profiles-remove:text:Cannot remove the current profile 'business'. Switch to another profile first.:2"
    );

    expect(mockRunProfileRemoval).not.toHaveBeenCalled();
  });

  it('renders grouped user-facing removal preview copy before cancellation', async () => {
    const program = createProfilesProgram();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockPromptConfirmDecision.mockResolvedValue('declined');

    await program.parseAsync(['profiles', 'remove', 'business'], { from: 'user' });

    expect(consoleError).toHaveBeenCalledWith('Deleting profile business (label: Business / Family) will remove:');
    expect(consoleError).toHaveBeenCalledWith('  - 1 profile');
    expect(consoleError).toHaveBeenCalledWith('  - 2 accounts');
    expect(consoleError).toHaveBeenCalledWith('Imported data:');
    expect(consoleError).toHaveBeenCalledWith('  - 2 import sessions');
    expect(consoleError).toHaveBeenCalledWith('  - 4 raw import data items');
    expect(consoleError).toHaveBeenCalledWith('Derived data:');
    expect(consoleError).toHaveBeenCalledWith('  - 8 transactions');
    expect(consoleError).toHaveBeenCalledWith('  - 2 ledger source activities');
    expect(consoleError).toHaveBeenCalledWith('  - 3 transaction links');
    expect(consoleError).toHaveBeenCalledWith('  - 1 review item');
    expect(consoleError).toHaveBeenCalledWith('  - 6 balances');
    expect(consoleError).toHaveBeenCalledWith('  - 6 cost basis snapshots');
    expect(consoleError).toHaveBeenCalledWith('Profile removal cancelled');
    expect(mockPromptConfirmDecision).toHaveBeenCalledWith(
      'Delete profile business (label: Business / Family) and the data shown above?',
      false
    );
    expect(mockRunProfileRemoval).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('clears saved default state after removing a profile hidden behind an env override', async () => {
    const program = createProfilesProgram();
    mockCtx.activeProfileKey = 'env-profile';
    mockCtx.activeProfileSource = 'env';
    mockReadCliStateFile.mockReturnValue(ok({ activeProfileKey: 'business' }));

    await program.parseAsync(['profiles', 'remove', 'business', '--confirm', '--json'], { from: 'user' });

    expect(mockClearCliStateFile).toHaveBeenCalledWith('/tmp/exitbook');
    expect(mockOutputSuccess).toHaveBeenCalledWith(
      'profiles-remove',
      {
        clearedSavedDefault: true,
        deleted: {
          profiles: 1,
          accounts: 2,
          rawData: 4,
          sessions: 2,
          transactions: 8,
          ledgerSourceActivities: 2,
          links: 3,
          assetReviewStates: 1,
          balanceSnapshots: 1,
          balanceSnapshotAssets: 5,
          costBasisSnapshots: 6,
        },
        profile: 'business',
      },
      undefined
    );
  });

  it('returns cancelled exit code when the prompt is cancelled', async () => {
    const program = createProfilesProgram();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const mockProcessExit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    mockPromptConfirmDecision.mockResolvedValue('cancelled');

    await program.parseAsync(['profiles', 'remove', 'business'], { from: 'user' });

    expect(consoleError).toHaveBeenCalledWith('Profile removal cancelled');
    expect(mockProcessExit).toHaveBeenCalledWith(ExitCodes.CANCELLED);
    consoleError.mockRestore();
    mockProcessExit.mockRestore();
  });

  it('hints with the profile key when the selector matches a label', async () => {
    const program = createProfilesProgram();
    mockPrepareProfileRemoval.mockResolvedValue(err(new Error("Profile 'son' not found")));
    mockBuildCliProfileService.mockReturnValue({
      list: vi.fn().mockResolvedValue(
        ok([
          {
            id: 2,
            profileKey: 'business',
            displayName: 'son',
            createdAt: new Date('2026-03-27T00:00:00.000Z'),
          },
        ])
      ),
    });

    await expect(program.parseAsync(['profiles', 'remove', 'son', '--confirm'], { from: 'user' })).rejects.toThrow(
      "CLI:profiles-remove:text:Profile selector 'son' did not match a profile key. Matching label found on profile 'business'. Use the profile key instead.:1"
    );
  });
});
