import { AccountLifecycleService } from '@exitbook/accounts';
import type { DataSession } from '@exitbook/data/session';

type AccountLifecycleStore = ConstructorParameters<typeof AccountLifecycleService>[0];

export function createCliAccountLifecycleService(db: DataSession): AccountLifecycleService {
  return new AccountLifecycleService(buildAccountLifecycleStore(db));
}

function buildAccountLifecycleStore(db: DataSession): AccountLifecycleStore {
  return {
    create: db.accounts.create.bind(db.accounts),
    findById: db.accounts.findById.bind(db.accounts),
    findByFingerprintRef: db.accounts.findByFingerprintRef.bind(db.accounts),
    findByIdentifier: db.accounts.findByIdentifier.bind(db.accounts),
    findByIdentity: db.accounts.findByIdentity.bind(db.accounts),
    findByName: db.accounts.findByName.bind(db.accounts),
    findChildren: (parentAccountId, profileId) => db.accounts.findAll({ parentAccountId, profileId }),
    listTopLevel: (profileId) =>
      db.accounts.findAll({
        includeUnnamedTopLevel: false,
        profileId,
        topLevelOnly: true,
      }),
    update: db.accounts.update.bind(db.accounts),
  };
}
