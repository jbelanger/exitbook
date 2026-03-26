import type { IAccountLifecycleStore, IProfileLifecycleStore } from '@exitbook/accounts';

import type { DataSession } from './data-session.js';

export function buildProfileLifecycleStore(db: DataSession): IProfileLifecycleStore {
  return {
    create: (input) => db.profiles.create(input),
    findByName: (name) => db.profiles.findByName(name),
    findOrCreateDefault: () => db.profiles.findOrCreateDefault(),
    list: () => db.profiles.list(),
  };
}

export function buildAccountLifecycleStore(db: DataSession): IAccountLifecycleStore {
  return {
    create: (input) => db.accounts.create(input),
    findById: (accountId) => db.accounts.findById(accountId),
    findByKey: (input) => db.accounts.findBy(input),
    findByName: (profileId, name) => db.accounts.findByName(profileId, name),
    findChildren: (parentAccountId) => db.accounts.findAll({ parentAccountId }),
    listTopLevel: (profileId, options) =>
      db.accounts.findAll({
        includeUnnamedTopLevel: options?.includeUnnamed,
        profileId,
        topLevelOnly: true,
      }),
    update: (accountId, updates) => db.accounts.update(accountId, updates),
  };
}
