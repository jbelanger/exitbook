import { OverrideStore } from '@exitbook/data/overrides';
import { err, resultTryAsync, type Result } from '@exitbook/foundation';

import type { CommandRuntime } from '../../../../runtime/command-runtime.js';
import { resolveCommandProfile } from '../../../profiles/profile-resolution.js';
import { resolveLinkProposalRef, type ResolvedLinkProposalRef } from '../../link-selector.js';

import { LinksReviewHandler } from './links-review-handler.js';

export interface LinksReviewCommandScope {
  handler: LinksReviewHandler;
  resolveProposalRef(selector: string): Promise<Result<ResolvedLinkProposalRef, Error>>;
}

export async function withLinksReviewCommandScope<T>(
  runtime: CommandRuntime,
  operation: (scope: LinksReviewCommandScope) => Promise<Result<T, Error>>
): Promise<Result<T, Error>> {
  return resultTryAsync<T>(async function* () {
    const database = await runtime.database();
    const profileResult = await resolveCommandProfile(runtime, database);
    if (profileResult.isErr()) {
      return yield* err(profileResult.error);
    }

    const value = yield* await operation({
      handler: new LinksReviewHandler(
        database,
        profileResult.value.id,
        profileResult.value.profileKey,
        new OverrideStore(runtime.dataDir)
      ),
      resolveProposalRef: async (selector: string) => {
        const linksResult = await database.transactionLinks.findAll({ profileId: profileResult.value.id });
        if (linksResult.isErr()) {
          return err(linksResult.error);
        }

        return resolveLinkProposalRef(linksResult.value, selector);
      },
    });
    return value;
  }, 'Failed to prepare links review command scope');
}
