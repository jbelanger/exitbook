import type { IAccountLifecycleStore, IProfileLifecycleStore } from '@exitbook/accounts';

import type { DataSession } from './data-session.js';

export function buildProfileLifecycleStore(db: DataSession): IProfileLifecycleStore {
  return {
    create: (input) => db.profiles.create(input),
    findByKey: (profileKey) => db.profiles.findByKey(profileKey),
    findOrCreateDefault: () => db.profiles.findOrCreateDefault(),
    list: () => db.profiles.list(),
    updateDisplayName: (profileKey, displayName) => db.profiles.updateDisplayName(profileKey, displayName),
  };
}

export function buildAccountLifecycleStore(db: DataSession): IAccountLifecycleStore {
  return {
    create: (input) => db.accounts.create(input),
    findById: (accountId) => db.accounts.findById(accountId),
    findByKey: (input) => db.accounts.findBy(input),
    findByName: (profileId, name) => db.accounts.findByName(profileId, name),
    findChildren: (parentAccountId, profileId) => db.accounts.findAll({ parentAccountId, profileId }),
    listTopLevel: (profileId) =>
      db.accounts.findAll({
        includeUnnamedTopLevel: false,
        profileId,
        topLevelOnly: true,
      }),
    update: (accountId, updates) => db.accounts.update(accountId, updates),
  };
}
