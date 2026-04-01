import { AccountLifecycleService } from '@exitbook/accounts';
import { buildAccountLifecycleStore } from '@exitbook/data/accounts';
import type { DataSession } from '@exitbook/data/session';

export function createCliAccountLifecycleService(db: DataSession): AccountLifecycleService {
  return new AccountLifecycleService(buildAccountLifecycleStore(db));
}
