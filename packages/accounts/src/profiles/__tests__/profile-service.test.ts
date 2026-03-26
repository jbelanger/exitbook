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
      async create(input: { name: string; profileKey: string }) {
        const profile: Profile = {
          id: nextId++,
          profileKey: input.profileKey,
          name: input.name,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        };
        profiles.push(profile);
        return ok(profile);
      },
      async findByName(name: string) {
        return ok(profiles.find((profile) => profile.name === name));
      },
      async findOrCreateDefault() {
        const existing = profiles.find((profile) => profile.name === 'default');
        if (existing) {
          return ok(existing);
        }

        return this.create({ name: 'default', profileKey: 'default' });
      },
      async list() {
        return ok([...profiles]);
      },
    },
  };
}

describe('ProfileService', () => {
  it('defaults the stable key from the profile name', async () => {
    const { store } = createStore();
    const service = new ProfileService(store);

    const profile = assertOk(await service.create('Business 2024'));

    expect(profile.name).toBe('business 2024');
    expect(profile.profileKey).toBe('business-2024');
  });

  it('accepts an explicit stable key', async () => {
    const { store } = createStore();
    const service = new ProfileService(store);

    const profile = assertOk(await service.create('Business 2024', 'family-ledger'));

    expect(profile.name).toBe('business 2024');
    expect(profile.profileKey).toBe('family-ledger');
  });

  it('rejects invalid explicit keys', async () => {
    const { store } = createStore();
    const service = new ProfileService(store);

    const result = await service.create('Business 2024', 'bad/key');

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) {
      return;
    }

    expect(result.error.message).toContain('Profile key');
  });
});
