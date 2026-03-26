import type { Profile } from '@exitbook/core';
import { ok } from '@exitbook/foundation';
import { assertOk } from '@exitbook/foundation/test-utils';
import { describe, expect, it } from 'vitest';

import { ProfileService } from '../profile-service.js';

function createStore() {
  const profiles: Profile[] = [];
  let nextId = 1;

  return {
    profiles,
    store: {
      async create(input: { displayName: string; profileKey: string }) {
        const profile: Profile = {
          id: nextId++,
          profileKey: input.profileKey,
          displayName: input.displayName,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        };
        profiles.push(profile);
        return ok(profile);
      },
      async findByKey(profileKey: string) {
        return ok(profiles.find((profile) => profile.profileKey === profileKey));
      },
      async findOrCreateDefault() {
        const existing = profiles.find((profile) => profile.profileKey === 'default');
        if (existing) {
          return ok(existing);
        }

        return this.create({ displayName: 'default', profileKey: 'default' });
      },
      async list() {
        return ok([...profiles]);
      },
      async updateDisplayName(profileKey: string, displayName: string) {
        const profile = profiles.find((item) => item.profileKey === profileKey);
        if (!profile) {
          throw new Error(`Profile '${profileKey}' not found`);
        }

        profile.displayName = displayName;
        return ok(profile);
      },
    },
  };
}

describe('ProfileService', () => {
  it('creates a profile with the key as the initial display name', async () => {
    const { store } = createStore();
    const service = new ProfileService(store);

    const profile = assertOk(await service.create('Business 2024'));

    expect(profile.displayName).toBe('business-2024');
    expect(profile.profileKey).toBe('business-2024');
  });

  it('renames the display name without changing the stable key', async () => {
    const { store } = createStore();
    const service = new ProfileService(store);

    assertOk(await service.create('son'));
    const profile = assertOk(await service.rename('son', 'Son / Family'));

    expect(profile.displayName).toBe('Son / Family');
    expect(profile.profileKey).toBe('son');
  });

  it('rejects invalid keys', async () => {
    const { store } = createStore();
    const service = new ProfileService(store);

    const result = await service.create('bad/key');

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) {
      return;
    }

    expect(result.error.message).toContain('Profile key');
  });
});
