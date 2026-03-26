import { DEFAULT_PROFILE_KEY, normalizeProfileDisplayName, normalizeProfileKey, type Profile } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/foundation';

import type { IProfileLifecycleStore } from '../ports/index.js';

export class ProfileService {
  constructor(private readonly store: IProfileLifecycleStore) {}

  create(profileKey: string): Promise<Result<Profile, Error>> {
    const normalizedKeyResult = normalizeProfileKey(profileKey);
    if (normalizedKeyResult.isErr()) {
      return Promise.resolve(err(normalizedKeyResult.error));
    }

    return this.store.create({
      displayName: normalizedKeyResult.value,
      profileKey: normalizedKeyResult.value,
    });
  }

  list(): Promise<Result<Profile[], Error>> {
    return this.store.list();
  }

  findByKey(profileKey: string): Promise<Result<Profile | undefined, Error>> {
    const normalizedKeyResult = normalizeProfileKey(profileKey);
    if (normalizedKeyResult.isErr()) {
      return Promise.resolve(err(normalizedKeyResult.error));
    }

    return this.store.findByKey(normalizedKeyResult.value);
  }

  findOrCreateDefault(): Promise<Result<Profile, Error>> {
    return this.store.findOrCreateDefault();
  }

  async rename(profileKey: string, displayName: string): Promise<Result<Profile, Error>> {
    const normalizedKeyResult = normalizeProfileKey(profileKey);
    if (normalizedKeyResult.isErr()) {
      return err(normalizedKeyResult.error);
    }

    const normalizedDisplayNameResult = normalizeProfileDisplayName(displayName);
    if (normalizedDisplayNameResult.isErr()) {
      return err(normalizedDisplayNameResult.error);
    }

    return this.store.updateDisplayName(normalizedKeyResult.value, normalizedDisplayNameResult.value);
  }

  async resolve(profileKey?: string): Promise<Result<Profile, Error>> {
    const resolvedProfileKey = profileKey?.trim() ?? '';
    if (resolvedProfileKey.length === 0 || resolvedProfileKey.toLowerCase() === DEFAULT_PROFILE_KEY) {
      return this.findOrCreateDefault();
    }

    const profileResult = await this.findByKey(resolvedProfileKey);
    if (profileResult.isErr()) {
      return err(profileResult.error);
    }
    if (!profileResult.value) {
      return err(new Error(`Profile '${resolvedProfileKey.toLowerCase()}' not found`));
    }

    return ok(profileResult.value);
  }
}
