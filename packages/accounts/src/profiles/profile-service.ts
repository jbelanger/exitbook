import { DEFAULT_PROFILE_KEY, normalizeProfileDisplayName, normalizeProfileKey, type Profile } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/foundation';

export interface ProfileSummary extends Profile {
  accountCount: number;
}

interface ProfileLifecycleStore {
  create(input: { displayName: string; profileKey: string }): Promise<Result<Profile, Error>>;
  findByKey(profileKey: string): Promise<Result<Profile | undefined, Error>>;
  findOrCreateDefault(): Promise<Result<Profile, Error>>;
  list(): Promise<Result<Profile[], Error>>;
  listSummaries(): Promise<Result<ProfileSummary[], Error>>;
  updateDisplayName(profileKey: string, displayName: string): Promise<Result<Profile, Error>>;
}

export interface UpdateProfileInput {
  displayName?: string | undefined;
}

export class ProfileService {
  constructor(private readonly store: ProfileLifecycleStore) {}

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

  listSummaries(): Promise<Result<ProfileSummary[], Error>> {
    return this.store.listSummaries();
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

  async update(profileKey: string, input: UpdateProfileInput): Promise<Result<Profile, Error>> {
    if (input.displayName === undefined) {
      return err(new Error('No profile property changes were provided'));
    }

    const normalizedKeyResult = normalizeProfileKey(profileKey);
    if (normalizedKeyResult.isErr()) {
      return err(normalizedKeyResult.error);
    }

    const profileResult = await this.store.findByKey(normalizedKeyResult.value);
    if (profileResult.isErr()) {
      return err(profileResult.error);
    }
    if (!profileResult.value) {
      return err(new Error(`Profile '${normalizedKeyResult.value}' not found`));
    }

    const normalizedDisplayNameResult = normalizeProfileDisplayName(input.displayName);
    if (normalizedDisplayNameResult.isErr()) {
      return err(normalizedDisplayNameResult.error);
    }

    if (normalizedDisplayNameResult.value === profileResult.value.displayName) {
      return err(new Error('No profile property changes were provided'));
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
