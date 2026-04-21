import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockAccountLifecycleService } = vi.hoisted(() => ({
  mockAccountLifecycleService: vi.fn(),
}));

interface CapturedStore {
  create: (...args: unknown[]) => unknown;
  findByFingerprintRef: (...args: unknown[]) => unknown;
  findById: (...args: unknown[]) => unknown;
  findByIdentifier: (...args: unknown[]) => unknown;
  findByIdentity: (...args: unknown[]) => unknown;
  findByName: (...args: unknown[]) => unknown;
  findChildren: (...args: unknown[]) => unknown;
  listTopLevel: (...args: unknown[]) => unknown;
  update: (...args: unknown[]) => unknown;
}

let capturedStore: CapturedStore | undefined;

vi.mock('@exitbook/accounts', () => ({
  AccountLifecycleService: class {
    constructor(store: CapturedStore) {
      capturedStore = store;
      mockAccountLifecycleService(store);
    }
  },
}));

import { createCliAccountLifecycleService } from '../account-service.js';

function requireCapturedStore(): CapturedStore {
  expect(capturedStore).toBeDefined();
  return capturedStore as CapturedStore;
}

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
    const store = requireCapturedStore();

    store.create({ tag: 'create' });
    store.findById(1);
    store.findByFingerprintRef('fingerprint');
    store.findByIdentifier('identifier');
    store.findByIdentity('profile', 'identity');
    store.findByName(3, 'kraken');
    store.update(7, { name: 'updated' });
    store.findChildren(9, 2);
    store.listTopLevel(4);

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
