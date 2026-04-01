import type { DataSession } from './data-session.js';

type ProfileLifecycleStore = Pick<
  DataSession['profiles'],
  'create' | 'findByKey' | 'findOrCreateDefault' | 'list' | 'updateDisplayName'
>;

type AccountLifecycleStore = Pick<DataSession['accounts'], 'create' | 'findById' | 'findByName' | 'update'> & {
  findByFingerprintRef: DataSession['accounts']['findByFingerprintRef'];
  findByIdentity: DataSession['accounts']['findByIdentity'];
  findChildren(parentAccountId: number, profileId: number): ReturnType<DataSession['accounts']['findAll']>;
  listTopLevel(profileId: number): ReturnType<DataSession['accounts']['findAll']>;
};

export function buildProfileLifecycleStore(db: DataSession): ProfileLifecycleStore {
  return {
    create: (input) => db.profiles.create(input),
    findByKey: (profileKey) => db.profiles.findByKey(profileKey),
    findOrCreateDefault: () => db.profiles.findOrCreateDefault(),
    list: () => db.profiles.list(),
    updateDisplayName: (profileKey, displayName) => db.profiles.updateDisplayName(profileKey, displayName),
  };
}

export function buildAccountLifecycleStore(db: DataSession): AccountLifecycleStore {
  return {
    create: (input) => db.accounts.create(input),
    findById: (accountId) => db.accounts.findById(accountId),
    findByFingerprintRef: (profileId, fingerprintRef) => db.accounts.findByFingerprintRef(profileId, fingerprintRef),
    findByIdentity: (input) => db.accounts.findByIdentity(input),
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
