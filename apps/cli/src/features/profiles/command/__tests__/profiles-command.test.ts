import { err, ok } from '@exitbook/foundation';
import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockBuildCliProfileService,
  mockCtx,
  mockExitCliFailure,
  mockFindOrCreateDefault,
  mockList,
  mockOutputProfilesStaticList,
  mockOutputSuccess,
  mockRunCommand,
} = vi.hoisted(() => ({
  mockBuildCliProfileService: vi.fn(),
  mockCtx: {
    activeProfileKey: 'business',
    activeProfileSource: 'state' as const,
    database: vi.fn(),
  },
  mockExitCliFailure: vi.fn(),
  mockFindOrCreateDefault: vi.fn(),
  mockList: vi.fn(),
  mockOutputProfilesStaticList: vi.fn(),
  mockOutputSuccess: vi.fn(),
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

vi.mock('../../view/profiles-static-renderer.js', () => ({
  outputProfilesStaticList: mockOutputProfilesStaticList,
}));

import { registerProfilesCommand } from '../profiles.js';

function createProfilesProgram(): Command {
  const program = new Command();
  registerProfilesCommand(program);
  return program;
}

beforeEach(() => {
  vi.clearAllMocks();

  mockCtx.database.mockResolvedValue({ tag: 'db' });
  mockRunCommand.mockImplementation(async (fn: (ctx: typeof mockCtx) => Promise<void>) => {
    await fn(mockCtx);
  });
  mockBuildCliProfileService.mockReturnValue({
    findOrCreateDefault: mockFindOrCreateDefault,
    listSummaries: mockList,
  });
  mockFindOrCreateDefault.mockResolvedValue(
    ok({
      id: 1,
      profileKey: 'default',
      displayName: 'default',
      createdAt: new Date('2026-03-26T00:00:00.000Z'),
    })
  );
  mockList.mockResolvedValue(
    ok([
      {
        id: 1,
        profileKey: 'default',
        displayName: 'default',
        accountCount: 1,
        createdAt: new Date('2026-03-26T00:00:00.000Z'),
      },
      {
        id: 2,
        profileKey: 'business',
        displayName: 'Business / Family',
        accountCount: 3,
        createdAt: new Date('2026-03-27T00:00:00.000Z'),
      },
    ])
  );
  mockExitCliFailure.mockImplementation(
    (command: string, failure: { error: Error; exitCode: number }, format: 'json' | 'text') => {
      throw new Error(`CLI:${command}:${format}:${failure.error.message}:${failure.exitCode}`);
    }
  );
});

describe('profiles root command', () => {
  it('registers the profiles namespace with the supported subcommands', () => {
    const program = createProfilesProgram();

    const profilesCommand = program.commands.find((command) => command.name() === 'profiles');
    expect(profilesCommand).toBeDefined();
    expect(profilesCommand?.description()).toBe('Manage isolated profiles within one data directory');
    const subcommandNames = profilesCommand?.commands.map((command) => command.name()) ?? [];
    expect(subcommandNames).toEqual(expect.arrayContaining(['add', 'remove', 'update', 'switch']));
    expect(subcommandNames).not.toContain('list');
    expect(subcommandNames).not.toContain('current');
    expect(subcommandNames).not.toContain('rename');
  });

  it('renders the current profile context and table through the static renderer', async () => {
    const program = createProfilesProgram();

    await program.parseAsync(['profiles'], { from: 'user' });

    expect(mockOutputProfilesStaticList).toHaveBeenCalledWith({
      activeProfileKey: 'business',
      activeProfileSource: 'state',
      profiles: [
        {
          id: 1,
          profileKey: 'default',
          displayName: 'default',
          accountCount: 1,
          createdAt: new Date('2026-03-26T00:00:00.000Z'),
        },
        {
          id: 2,
          profileKey: 'business',
          displayName: 'Business / Family',
          accountCount: 3,
          createdAt: new Date('2026-03-27T00:00:00.000Z'),
        },
      ],
    });
  });

  it('outputs the profile list payload in JSON mode', async () => {
    const program = createProfilesProgram();

    await program.parseAsync(['profiles', '--json'], { from: 'user' });

    expect(mockOutputSuccess).toHaveBeenCalledWith(
      'profiles',
      {
        activeProfileKey: 'business',
        activeProfileSource: 'state',
        profiles: [
          {
            id: 1,
            profileKey: 'default',
            displayName: 'default',
            accountCount: 1,
            isActive: false,
            createdAt: '2026-03-26T00:00:00.000Z',
          },
          {
            id: 2,
            profileKey: 'business',
            displayName: 'Business / Family',
            accountCount: 3,
            isActive: true,
            createdAt: '2026-03-27T00:00:00.000Z',
          },
        ],
      },
      undefined
    );
  });

  it('surfaces profile-list errors through the CLI error handler', async () => {
    const program = createProfilesProgram();
    mockList.mockResolvedValue(err(new Error('List failed')));

    await expect(program.parseAsync(['profiles'], { from: 'user' })).rejects.toThrow('CLI:profiles:text:List failed:1');
  });
});
