import { err, ok } from '@exitbook/foundation';
import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockBuildCliProfileService, mockCtx, mockExitCliFailure, mockOutputSuccess, mockRename, mockRunCommand } =
  vi.hoisted(() => ({
    mockBuildCliProfileService: vi.fn(),
    mockCtx: {
      database: vi.fn(),
    },
    mockExitCliFailure: vi.fn(),
    mockOutputSuccess: vi.fn(),
    mockRename: vi.fn(),
    mockRunCommand: vi.fn(),
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

import { registerProfilesRenameCommand } from '../profiles-rename.js';

function createProfilesProgram(): Command {
  const program = new Command();
  registerProfilesRenameCommand(program.command('profiles'));
  return program;
}

beforeEach(() => {
  vi.clearAllMocks();

  mockCtx.database.mockResolvedValue({ tag: 'db' });
  mockRunCommand.mockImplementation(async (fn: (ctx: typeof mockCtx) => Promise<void>) => {
    await fn(mockCtx);
  });
  mockBuildCliProfileService.mockReturnValue({
    rename: mockRename,
  });
  mockExitCliFailure.mockImplementation(
    (command: string, failure: { error: Error; exitCode: number }, format: 'json' | 'text') => {
      throw new Error(`CLI:${command}:${format}:${failure.error.message}:${failure.exitCode}`);
    }
  );
});

describe('profiles rename command', () => {
  it('renames a profile display name in JSON mode', async () => {
    const program = createProfilesProgram();
    const profile = {
      id: 1,
      profileKey: 'business',
      displayName: 'Business / Family',
      createdAt: new Date('2026-03-26T00:00:00.000Z'),
    };
    mockRename.mockResolvedValue(ok(profile));

    await program.parseAsync(['profiles', 'rename', 'business', 'Business / Family', '--json'], { from: 'user' });

    expect(mockRename).toHaveBeenCalledWith('business', 'Business / Family');
    expect(mockOutputSuccess).toHaveBeenCalledWith('profiles-rename', { profile }, undefined);
  });

  it('surfaces rename errors through the CLI error handler', async () => {
    const program = createProfilesProgram();
    mockRename.mockResolvedValue(err(new Error("Profile 'missing' not found")));

    await expect(program.parseAsync(['profiles', 'rename', 'missing', 'Missing'], { from: 'user' })).rejects.toThrow(
      "CLI:profiles-rename:text:Profile 'missing' not found:1"
    );
  });
});
