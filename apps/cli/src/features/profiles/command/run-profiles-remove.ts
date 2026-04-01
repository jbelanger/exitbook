import type { ProfileService } from '@exitbook/accounts';
import type { Account, Profile } from '@exitbook/core';
import { normalizeProfileKey } from '@exitbook/core';
import type { DataSession } from '@exitbook/data/session';
import { err, ok, type Result } from '@exitbook/foundation';

import type { ProfileRemovalImpactCounts } from './profile-removal-service.js';
import { flattenProfileRemovePreview, ProfileRemovalService } from './profile-removal-service.js';

export interface ProfileRemovalPreparation {
  profile: Profile;
  accountIds: number[];
  preview: ProfileRemovalImpactCounts;
}

export async function prepareProfileRemoval(
  db: DataSession,
  profileService: ProfileService,
  profileKey: string
): Promise<Result<ProfileRemovalPreparation, Error>> {
  const profileResult = await profileService.findByKey(profileKey);
  if (profileResult.isErr()) {
    return err(profileResult.error);
  }
  if (!profileResult.value) {
    const normalizedProfileKeyResult = normalizeProfileKey(profileKey);
    if (normalizedProfileKeyResult.isErr()) {
      return err(normalizedProfileKeyResult.error);
    }

    return err(new Error(`Profile '${normalizedProfileKeyResult.value}' not found`));
  }

  const accountsResult = await db.accounts.findAll({ profileId: profileResult.value.id });
  if (accountsResult.isErr()) {
    return err(accountsResult.error);
  }

  const accountIds = buildAccountDeletionOrder(accountsResult.value);
  const previewResult = await new ProfileRemovalService(db).preview(accountIds);
  if (previewResult.isErr()) {
    return err(previewResult.error);
  }

  return ok({
    profile: profileResult.value,
    accountIds,
    preview: flattenProfileRemovePreview(previewResult.value),
  });
}

export async function runProfileRemoval(db: DataSession, profileKey: string, accountIds: number[]) {
  return new ProfileRemovalService(db).execute(profileKey, accountIds);
}

function buildAccountDeletionOrder(accounts: Account[]): number[] {
  if (accounts.length === 0) {
    return [];
  }

  const childrenByParent = new Map<number, Account[]>();
  const rootAccounts: Account[] = [];

  for (const account of accounts) {
    if (account.parentAccountId === undefined) {
      rootAccounts.push(account);
      continue;
    }

    const children = childrenByParent.get(account.parentAccountId) ?? [];
    children.push(account);
    childrenByParent.set(account.parentAccountId, children);
  }

  const orderedIds: number[] = [];
  const visited = new Set<number>();

  const visit = (account: Account) => {
    if (visited.has(account.id)) {
      return;
    }

    const children = childrenByParent.get(account.id) ?? [];
    for (const child of children) {
      visit(child);
    }

    visited.add(account.id);
    orderedIds.push(account.id);
  };

  for (const rootAccount of rootAccounts) {
    visit(rootAccount);
  }

  for (const account of accounts) {
    visit(account);
  }

  return orderedIds;
}
