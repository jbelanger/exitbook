import { err, ok } from '@exitbook/foundation';
import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockBuildCliProfileService,
  mockCtx,
  mockExitCliFailure,
  mockFindByKey,
  mockFindOrCreateDefault,
  mockListProfiles,
  mockList,
  mockOutputProfilesStaticDetail,
  mockOutputProfilesStaticList,
  mockOutputSuccess,
  mockRunCommand,
} = vi.hoisted(() => ({
  mockBuildCliProfileService: vi.fn(),
  mockCtx: {
    activeProfileKey: 'business',
    activeProfileSource: 'state' as const,
    database: vi.fn(),
    openDatabaseSession: vi.fn(),
    closeDatabaseSession: vi.fn(),
  },
  mockExitCliFailure: vi.fn(),
  mockFindByKey: vi.fn(),
  mockFindOrCreateDefault: vi.fn(),
  mockListProfiles: vi.fn(),
  mockList: vi.fn(),
  mockOutputProfilesStaticDetail: vi.fn(),
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
  outputProfilesStaticDetail: mockOutputProfilesStaticDetail,
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
  mockCtx.openDatabaseSession.mockResolvedValue({ tag: 'db' });
  mockCtx.closeDatabaseSession.mockResolvedValue(undefined);
  mockRunCommand.mockImplementation(async (fn: (ctx: typeof mockCtx) => Promise<void>) => {
    await fn(mockCtx);
  });
  mockBuildCliProfileService.mockReturnValue({
    findByKey: mockFindByKey,
    findOrCreateDefault: mockFindOrCreateDefault,
    list: mockListProfiles,
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
  mockListProfiles.mockResolvedValue(
    ok([
      {
        id: 1,
        profileKey: 'default',
        displayName: 'default',
        createdAt: new Date('2026-03-26T00:00:00.000Z'),
      },
      {
        id: 2,
        profileKey: 'business',
        displayName: 'Business / Family',
        createdAt: new Date('2026-03-27T00:00:00.000Z'),
      },
    ])
  );
  mockFindByKey.mockImplementation(async (profileKey: string) =>
    ok(
      profileKey === 'business'
        ? {
            id: 2,
            profileKey: 'business',
            displayName: 'Business / Family',
            createdAt: new Date('2026-03-27T00:00:00.000Z'),
          }
        : profileKey === 'default'
          ? {
              id: 1,
              profileKey: 'default',
              displayName: 'default',
              createdAt: new Date('2026-03-26T00:00:00.000Z'),
            }
          : undefined
    )
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
    expect(subcommandNames).toEqual(expect.arrayContaining(['list', 'view', 'add', 'remove', 'update', 'switch']));
    expect(subcommandNames).not.toContain('current');
    expect(subcommandNames).not.toContain('explore');
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
          isActive: false,
        },
        {
          id: 2,
          profileKey: 'business',
          displayName: 'Business / Family',
          accountCount: 3,
          createdAt: new Date('2026-03-27T00:00:00.000Z'),
          isActive: true,
        },
      ],
    });
  });

  it('renders the same static list for the explicit list alias', async () => {
    const program = createProfilesProgram();

    await program.parseAsync(['profiles', 'list'], { from: 'user' });

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
          isActive: false,
        },
        {
          id: 2,
          profileKey: 'business',
          displayName: 'Business / Family',
          accountCount: 3,
          createdAt: new Date('2026-03-27T00:00:00.000Z'),
          isActive: true,
        },
      ],
    });
  });

  it('rejects bare profile selectors and points callers to view', async () => {
    const program = createProfilesProgram();

    await expect(program.parseAsync(['profiles', 'business'], { from: 'user' })).rejects.toThrow(
      'CLI:profiles:text:Use "profiles view business" for static detail.:2'
    );
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

  it('outputs the profile list payload in JSON mode for the explicit list alias', async () => {
    const program = createProfilesProgram();

    await program.parseAsync(['profiles', 'list', '--json'], { from: 'user' });

    expect(mockOutputSuccess).toHaveBeenCalledWith(
      'profiles-list',
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

  it('renders the static detail card for profiles view', async () => {
    const program = createProfilesProgram();

    await program.parseAsync(['profiles', 'view', 'business'], { from: 'user' });

    expect(mockFindByKey).toHaveBeenCalledWith('business');
    expect(mockOutputProfilesStaticDetail).toHaveBeenCalledWith({
      activeProfileKey: 'business',
      activeProfileSource: 'state',
      profile: {
        id: 2,
        profileKey: 'business',
        displayName: 'Business / Family',
        accountCount: 3,
        createdAt: new Date('2026-03-27T00:00:00.000Z'),
        isActive: true,
        activeProfileSource: 'state',
      },
    });
  });

  it('outputs the static detail payload in JSON mode for profiles view', async () => {
    const program = createProfilesProgram();

    await program.parseAsync(['profiles', 'view', 'business', '--json'], { from: 'user' });

    expect(mockOutputSuccess).toHaveBeenCalledWith(
      'profiles-view',
      {
        activeProfileKey: 'business',
        activeProfileSource: 'state',
        profile: {
          id: 2,
          profileKey: 'business',
          displayName: 'Business / Family',
          accountCount: 3,
          isActive: true,
          activeProfileSource: 'state',
          createdAt: '2026-03-27T00:00:00.000Z',
        },
      },
      undefined
    );
  });

  it('hints with the profile key when profiles view is given a matching label', async () => {
    const program = createProfilesProgram();

    mockFindByKey.mockResolvedValue(ok(undefined));
    mockListProfiles.mockResolvedValue(
      ok([
        {
          id: 2,
          profileKey: 'business',
          displayName: 'son',
          createdAt: new Date('2026-03-27T00:00:00.000Z'),
        },
      ])
    );

    await expect(program.parseAsync(['profiles', 'view', 'son'], { from: 'user' })).rejects.toThrow(
      "CLI:profiles-view:text:Profile selector 'son' did not match a profile key. Matching label found on profile 'business'. Use the profile key instead.:1"
    );
  });

  it('surfaces profile-list errors through the CLI error handler', async () => {
    const program = createProfilesProgram();
    mockList.mockResolvedValue(err(new Error('List failed')));

    await expect(program.parseAsync(['profiles'], { from: 'user' })).rejects.toThrow('CLI:profiles:text:List failed:1');
  });

  it('surfaces profile detail lookup errors through the CLI error handler', async () => {
    const program = createProfilesProgram();
    mockFindByKey.mockResolvedValue(err(new Error('Lookup failed')));

    await expect(program.parseAsync(['profiles', 'view', 'business'], { from: 'user' })).rejects.toThrow(
      'CLI:profiles-view:text:Lookup failed:1'
    );
  });
});
