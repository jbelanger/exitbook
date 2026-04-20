import { err, ok } from '@exitbook/foundation';
import { assertErr, assertOk } from '@exitbook/foundation/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCreateCliAccountLifecycleService, mockResolveCommandProfile } = vi.hoisted(() => ({
  mockCreateCliAccountLifecycleService: vi.fn(),
  mockResolveCommandProfile: vi.fn(),
}));

let constructedRemovalService: { database: unknown; profileId: number } | undefined;

vi.mock('../../account-service.js', () => ({
  createCliAccountLifecycleService: mockCreateCliAccountLifecycleService,
}));

vi.mock('../../../profiles/profile-resolution.js', () => ({
  resolveCommandProfile: mockResolveCommandProfile,
}));

vi.mock('../account-removal-service.js', () => ({
  AccountRemovalService: class {
    constructor(
      public readonly database: unknown,
      public readonly profileId: number
    ) {
      constructedRemovalService = {
        database,
        profileId,
      };
    }
  },
}));

import { withAccountsRemoveCommandScope } from '../accounts-remove-command-scope.js';

describe('withAccountsRemoveCommandScope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    constructedRemovalService = undefined;
  });

  it('builds the command scope from the resolved profile and database', async () => {
    const database = { tag: 'db' };
    const accountService = { tag: 'account-service' };
    const profile = {
      id: 4,
      profileKey: 'default',
      displayName: 'default',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    };
    const runtime = {
      database: vi.fn().mockResolvedValue(database),
    };

    mockResolveCommandProfile.mockResolvedValue(ok(profile));
    mockCreateCliAccountLifecycleService.mockReturnValue(accountService);

    const result = await withAccountsRemoveCommandScope(runtime as never, async (scope) => {
      expect(scope.accountService).toBe(accountService);
      expect(scope.profile).toBe(profile);
      expect(constructedRemovalService).toEqual({
        database,
        profileId: 4,
      });

      return ok('done');
    });

    expect(assertOk(result)).toBe('done');
  });

  it('wraps profile-resolution failures', async () => {
    const runtime = {
      database: vi.fn().mockResolvedValue({ tag: 'db' }),
    };

    mockResolveCommandProfile.mockResolvedValue(err(new Error('profile lookup failed')));

    const result = await withAccountsRemoveCommandScope(runtime as never, async () => ok('done'));

    expect(assertErr(result).message).toBe('profile lookup failed');
  });
});
