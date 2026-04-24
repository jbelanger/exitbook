import { err, ok } from '@exitbook/foundation';
import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockBuildCliProfileService,
  mockCtx,
  mockExitCliFailure,
  mockList,
  mockOutputSuccess,
  mockRunCommand,
  mockUpdate,
} = vi.hoisted(() => ({
  mockBuildCliProfileService: vi.fn(),
  mockCtx: {
    database: vi.fn(),
    openDatabaseSession: vi.fn(),
    closeDatabaseSession: vi.fn(),
  },
  mockExitCliFailure: vi.fn(),
  mockList: vi.fn(),
  mockOutputSuccess: vi.fn(),
  mockRunCommand: vi.fn(),
  mockUpdate: vi.fn(),
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

vi.mock('../../profile-service.js', () => ({
  buildCliProfileService: mockBuildCliProfileService,
}));

import { registerProfilesUpdateCommand } from '../profiles-update.js';

function createProfilesProgram(): Command {
  const program = new Command();
  registerProfilesUpdateCommand(program.command('profiles'));
  return program;
}

beforeEach(() => {
  vi.clearAllMocks();

  mockCtx.database.mockResolvedValue({ tag: 'db' });
  mockCtx.openDatabaseSession.mockResolvedValue({ tag: 'db' });
  mockCtx.closeDatabaseSession.mockResolvedValue(undefined);
  mockRunCommand.mockImplementation(async (fn: (ctx: typeof mockCtx) => Promise<void>) => {
    await fn(mockCtx);
  });
  mockBuildCliProfileService.mockReturnValue({
    list: mockList,
    update: mockUpdate,
  });
  mockList.mockResolvedValue(ok([]));
  mockExitCliFailure.mockImplementation(
    (command: string, failure: { error: Error; exitCode: number }, format: 'json' | 'text') => {
      throw new Error(`CLI:${command}:${format}:${failure.error.message}:${failure.exitCode}`);
    }
  );
});

describe('profiles update command', () => {
  it('prints a success-marked confirmation in text mode', async () => {
    const program = createProfilesProgram();
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const profile = {
      id: 1,
      profileKey: 'business',
      displayName: 'Business / Family',
      createdAt: new Date('2026-03-26T00:00:00.000Z'),
    };
    mockUpdate.mockResolvedValue(ok(profile));

    await program.parseAsync(['profiles', 'update', 'business', '--label', 'Business / Family'], { from: 'user' });

    expect(consoleLog).toHaveBeenCalledOnce();
    expect(consoleLog.mock.calls[0]?.[0]).toContain('✓');
    expect(consoleLog.mock.calls[0]?.[0]).toContain('Updated profile business label to Business / Family');
    consoleLog.mockRestore();
  });

  it('updates a profile display label in JSON mode', async () => {
    const program = createProfilesProgram();
    const profile = {
      id: 1,
      profileKey: 'business',
      displayName: 'Business / Family',
      createdAt: new Date('2026-03-26T00:00:00.000Z'),
    };
    mockUpdate.mockResolvedValue(ok(profile));

    await program.parseAsync(['profiles', 'update', 'business', '--label', 'Business / Family', '--json'], {
      from: 'user',
    });

    expect(mockUpdate).toHaveBeenCalledWith('business', { displayName: 'Business / Family' });
    expect(mockOutputSuccess).toHaveBeenCalledWith('profiles-update', { profile }, undefined);
  });

  it('requires at least one property flag', async () => {
    const program = createProfilesProgram();

    await expect(program.parseAsync(['profiles', 'update', 'business'], { from: 'user' })).rejects.toThrow(
      'CLI:profiles-update:text:At least one profile property flag is required:2'
    );
  });

  it('surfaces update errors through the CLI error handler', async () => {
    const program = createProfilesProgram();
    mockUpdate.mockResolvedValue(err(new Error("Profile 'missing' not found")));

    await expect(
      program.parseAsync(['profiles', 'update', 'missing', '--label', 'Missing'], { from: 'user' })
    ).rejects.toThrow("CLI:profiles-update:text:Profile 'missing' not found:1");
  });

  it('hints with the profile key when the selector matches a label', async () => {
    const program = createProfilesProgram();
    mockUpdate.mockResolvedValue(err(new Error("Profile 'son' not found")));
    mockList.mockResolvedValue(
      ok([
        {
          id: 1,
          profileKey: 'business',
          displayName: 'son',
          createdAt: new Date('2026-03-26T00:00:00.000Z'),
        },
      ])
    );

    await expect(
      program.parseAsync(['profiles', 'update', 'son', '--label', 'Family'], { from: 'user' })
    ).rejects.toThrow(
      "CLI:profiles-update:text:Profile selector 'son' did not match a profile key. Matching label found on profile 'business'. Use the profile key instead.:1"
    );
  });
});
