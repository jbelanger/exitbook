import { OverrideStore } from '@exitbook/data/overrides';
import { err, wrapError, type Result } from '@exitbook/foundation';

import type { CommandRuntime } from '../../../../runtime/command-runtime.js';
import { resolveCommandProfile } from '../../../profiles/profile-resolution.js';

import { LinksReviewHandler } from './links-review-handler.js';

export interface LinksReviewCommandScope {
  handler: LinksReviewHandler;
}

export async function withLinksReviewCommandScope<T>(
  runtime: CommandRuntime,
  operation: (scope: LinksReviewCommandScope) => Promise<Result<T, Error>>
): Promise<Result<T, Error>> {
  try {
    const database = await runtime.database();
    const profileResult = await resolveCommandProfile(runtime, database);
    if (profileResult.isErr()) {
      return err(profileResult.error);
    }

    return operation({
      handler: new LinksReviewHandler(
        database,
        profileResult.value.id,
        profileResult.value.profileKey,
        new OverrideStore(runtime.dataDir)
      ),
    });
  } catch (error) {
    return wrapError(error, 'Failed to prepare links review command scope');
  }
}
