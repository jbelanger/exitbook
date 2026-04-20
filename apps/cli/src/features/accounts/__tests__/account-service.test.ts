import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockAccountLifecycleService } = vi.hoisted(() => ({
  mockAccountLifecycleService: vi.fn(),
}));

let capturedStore: Record<string, (...args: unknown[]) => unknown> | undefined;

vi.mock('@exitbook/accounts', () => ({
  AccountLifecycleService: class {
    constructor(store: Record<string, (...args: unknown[]) => unknown>) {
      capturedStore = store;
      mockAccountLifecycleService(store);
    }
  },
}));

import { createCliAccountLifecycleService } from '../account-service.js';

describe('createCliAccountLifecycleService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedStore = undefined;
  });

  it('binds the data-session account store into the lifecycle service contract', async () => {
    const mockCreate = vi.fn();
    const mockFindById = vi.fn();
    const mockFindByFingerprintRef = vi.fn();
    const mockFindByIdentifier = vi.fn();
    const mockFindByIdentity = vi.fn();
    const mockFindByName = vi.fn();
    const mockFindAll = vi.fn();
    const mockUpdate = vi.fn();
    const db = {
      accounts: {
        create: mockCreate,
        findAll: mockFindAll,
        findByFingerprintRef: mockFindByFingerprintRef,
        findById: mockFindById,
        findByIdentifier: mockFindByIdentifier,
        findByIdentity: mockFindByIdentity,
        findByName: mockFindByName,
        update: mockUpdate,
      },
    };

    createCliAccountLifecycleService(db as never);

    expect(mockAccountLifecycleService).toHaveBeenCalledOnce();
    expect(capturedStore).toBeDefined();

    capturedStore?.create({ tag: 'create' });
    capturedStore?.findById(1);
    capturedStore?.findByFingerprintRef('fingerprint');
    capturedStore?.findByIdentifier('identifier');
    capturedStore?.findByIdentity('profile', 'identity');
    capturedStore?.findByName(3, 'kraken');
    capturedStore?.update(7, { name: 'updated' });
    capturedStore?.findChildren(9, 2);
    capturedStore?.listTopLevel(4);

    expect(mockCreate).toHaveBeenCalledWith({ tag: 'create' });
    expect(mockFindById).toHaveBeenCalledWith(1);
    expect(mockFindByFingerprintRef).toHaveBeenCalledWith('fingerprint');
    expect(mockFindByIdentifier).toHaveBeenCalledWith('identifier');
    expect(mockFindByIdentity).toHaveBeenCalledWith('profile', 'identity');
    expect(mockFindByName).toHaveBeenCalledWith(3, 'kraken');
    expect(mockUpdate).toHaveBeenCalledWith(7, { name: 'updated' });
    expect(mockFindAll).toHaveBeenNthCalledWith(1, { parentAccountId: 9, profileId: 2 });
    expect(mockFindAll).toHaveBeenNthCalledWith(2, {
      includeUnnamedTopLevel: false,
      profileId: 4,
      topLevelOnly: true,
    });
  });
});
