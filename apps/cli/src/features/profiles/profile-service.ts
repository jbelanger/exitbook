import { ProfileService } from '@exitbook/accounts';
import type { DataSession } from '@exitbook/data/session';

type ProfileLifecycleStore = ConstructorParameters<typeof ProfileService>[0];

export function buildCliProfileService(db: DataSession): ProfileService {
  const store: ProfileLifecycleStore = db.profiles;
  return new ProfileService(store);
}
