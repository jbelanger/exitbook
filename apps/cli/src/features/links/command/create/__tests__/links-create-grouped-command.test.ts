/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- command-boundary tests intentionally mock runtime and CLI completion plumbing. */
import { ok } from '@exitbook/foundation';
import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockCreate,
  mockHandlerConstructor,
  mockOverrideStoreConstructor,
  mockOverrideStoreInstance,
  mockRefreshProfileIssueProjection,
  mockResolveCommandProfile,
  mockRunCliRuntimeCommand,
} = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockHandlerConstructor: vi.fn(),
  mockOverrideStoreConstructor: vi.fn(),
  mockOverrideStoreInstance: { tag: 'override-store' },
  mockRefreshProfileIssueProjection: vi.fn(),
  mockResolveCommandProfile: vi.fn(),
  mockRunCliRuntimeCommand: vi.fn(),
}));

vi.mock('@exitbook/data/overrides', () => ({
  OverrideStore: vi.fn().mockImplementation(function MockOverrideStore(...args: unknown[]) {
    mockOverrideStoreConstructor(...args);
    return mockOverrideStoreInstance;
  }),
}));

vi.mock('../../../../../cli/command.js', async () => {
  const actual = await vi.importActual<typeof import('../../../../../cli/command.js')>('../../../../../cli/command.js');

  return {
    ...actual,
    runCliRuntimeCommand: mockRunCliRuntimeCommand,
  };
});

vi.mock('../../../../profiles/profile-resolution.js', () => ({
  resolveCommandProfile: mockResolveCommandProfile,
}));

vi.mock('@exitbook/data/accounting', () => ({
  refreshProfileAccountingIssueProjection: mockRefreshProfileIssueProjection,
}));

vi.mock('../links-create-grouped-handler.js', () => ({
  ManualGroupedLinkCreateHandler: vi.fn().mockImplementation(function MockManualGroupedLinkCreateHandler(
    ...args: unknown[]
  ) {
    mockHandlerConstructor(...args);
    return {
      create: mockCreate,
    };
  }),
}));

import { registerLinksCreateGroupedCommand } from '../links-create-grouped-command.js';

function createProgram(): Command {
  const program = new Command();
  const links = program.command('links');
  registerLinksCreateGroupedCommand(links);
  return program;
}

describe('links create-grouped command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveCommandProfile.mockResolvedValue(
      ok({
        id: 1,
        profileKey: 'default',
        displayName: 'default',
        createdAt: new Date('2026-04-01T00:00:00.000Z'),
      })
    );
    mockRefreshProfileIssueProjection.mockResolvedValue(ok(undefined));
    mockRunCliRuntimeCommand.mockImplementation(async (options) => {
      const preparedResult = await options.prepare();
      if (preparedResult.isErr()) {
        throw preparedResult.error.error;
      }

      const actionResult = await options.action({
        runtime: {
          dataDir: '/tmp/exitbook-links',
          database: async () => ({ tag: 'db' }),
        },
        prepared: preparedResult.value,
      });
      if (actionResult.isErr()) {
        throw actionResult.error.error;
      }

      return actionResult.value;
    });
  });

  it('passes grouped selectors through to the handler in JSON mode', async () => {
    const program = createProgram();
    mockCreate.mockResolvedValue(
      ok({
        action: 'created',
        changed: true,
        assetSymbol: 'ADA',
        createdCount: 2,
        confirmedExistingCount: 0,
        unchangedCount: 0,
        groupShape: 'many-to-one',
        links: [],
        sourceCount: 2,
        targetCount: 1,
      })
    );

    await program.parseAsync(
      [
        'links',
        'create-grouped',
        '--source',
        '78a82e8482',
        '--source',
        'd0c794045d',
        '--target',
        '38adc7a548',
        '--asset',
        'ADA',
        '--explained-residual-amount',
        '10.524451',
        '--explained-residual-role',
        'staking_reward',
        '--json',
      ],
      { from: 'user' }
    );

    expect(mockOverrideStoreConstructor).toHaveBeenCalledWith('/tmp/exitbook-links');
    expect(mockHandlerConstructor).toHaveBeenCalledWith({ tag: 'db' }, 1, 'default', mockOverrideStoreInstance);
    expect(mockCreate).toHaveBeenCalledWith({
      assetSymbol: 'ADA',
      explainedTargetResidual: {
        amount: '10.524451',
        role: 'staking_reward',
      },
      reason: undefined,
      sourceSelectors: ['78a82e8482', 'd0c794045d'],
      targetSelectors: ['38adc7a548'],
    });
    expect(mockRefreshProfileIssueProjection).toHaveBeenCalledWith({ tag: 'db' }, '/tmp/exitbook-links', {
      displayName: 'default',
      profileId: 1,
      profileKey: 'default',
    });
  });
});
