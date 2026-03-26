import { ProfileService } from '@exitbook/accounts';
import { buildProfileLifecycleStore } from '@exitbook/data/accounts';
import type { DataSession } from '@exitbook/data/session';

export function buildCliProfileService(db: DataSession): ProfileService {
  return new ProfileService(buildProfileLifecycleStore(db));
}
