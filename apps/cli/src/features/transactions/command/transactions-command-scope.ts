import type { Profile } from '@exitbook/core';
import type { DataSession } from '@exitbook/data/session';
import { err, ok, type Result } from '@exitbook/foundation';

import type { CliOutputFormat } from '../../../cli/options.js';
import type { CommandRuntime } from '../../../runtime/command-runtime.js';
import { ensureProcessedTransactionsReady } from '../../../runtime/projection-readiness.js';
import { resolveCommandProfile } from '../../profiles/profile-resolution.js';

export interface TransactionsCommandScope {
  database: DataSession;
  dataDir: string;
  profile: Profile;
}

export async function prepareTransactionsCommandScope(
  runtime: CommandRuntime,
  options: {
    format: CliOutputFormat;
  }
): Promise<Result<TransactionsCommandScope, Error>> {
  const database = await runtime.database();
  const profileResult = await resolveCommandProfile(runtime, database);
  if (profileResult.isErr()) {
    return err(profileResult.error);
  }

  const profile = profileResult.value;
  const readyResult = await ensureProcessedTransactionsReady(runtime, {
    format: options.format,
    profileId: profile.id,
    profileKey: profile.profileKey,
  });
  if (readyResult.isErr()) {
    return err(readyResult.error);
  }

  return ok({
    database,
    dataDir: runtime.dataDir,
    profile,
  });
}
