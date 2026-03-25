import { DEFAULT_PROFILE_NAME, type Profile } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/foundation';

import type { IProfileLifecycleStore } from '../ports/index.js';

function normalizeProfileName(name: string): Result<string, Error> {
  const normalized = name.trim().toLowerCase();
  if (normalized.length === 0) {
    return err(new Error('Profile name must not be empty'));
  }

  return ok(normalized);
}

export class ProfileService {
  constructor(private readonly store: IProfileLifecycleStore) {}

  create(name: string): Promise<Result<Profile, Error>> {
    const normalizedNameResult = normalizeProfileName(name);
    if (normalizedNameResult.isErr()) {
      return Promise.resolve(err(normalizedNameResult.error));
    }

    return this.store.create(normalizedNameResult.value);
  }

  list(): Promise<Result<Profile[], Error>> {
    return this.store.list();
  }

  findByName(name: string): Promise<Result<Profile | undefined, Error>> {
    const normalizedNameResult = normalizeProfileName(name);
    if (normalizedNameResult.isErr()) {
      return Promise.resolve(err(normalizedNameResult.error));
    }

    return this.store.findByName(normalizedNameResult.value);
  }

  findOrCreateDefault(): Promise<Result<Profile, Error>> {
    return this.store.findOrCreateDefault();
  }

  async resolve(profileName?: string  ): Promise<Result<Profile, Error>> {
    if (!profileName || profileName.trim().length === 0 || profileName.trim().toLowerCase() === DEFAULT_PROFILE_NAME) {
      return this.findOrCreateDefault();
    }

    const profileResult = await this.findByName(profileName);
    if (profileResult.isErr()) {
      return err(profileResult.error);
    }
    if (!profileResult.value) {
      return err(new Error(`Profile '${profileName.trim().toLowerCase()}' not found`));
    }

    return ok(profileResult.value);
  }
}
