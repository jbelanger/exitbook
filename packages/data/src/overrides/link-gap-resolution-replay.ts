import { buildLinkGapIssueKey, type LinkGapIssueIdentity } from '@exitbook/accounting/linking';
import type { OverrideEvent } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/foundation';

import type { OverrideStore } from './override-store.js';

export type ResolvedLinkGapIssue = LinkGapIssueIdentity;

function buildResolvedLinkGapIssueFromOverride(
  payload: Extract<OverrideEvent['payload'], { type: 'link_gap_resolve' | 'link_gap_reopen' }>
): ResolvedLinkGapIssue {
  return {
    txFingerprint: payload.tx_fingerprint,
    assetId: payload.asset_id,
    direction: payload.direction,
  };
}

/**
 * Replay link-gap resolution overrides with latest-event-wins semantics.
 */
export function replayResolvedLinkGapIssues(overrides: OverrideEvent[]): Result<Set<string>, Error> {
  const resolvedByIssueKey = new Map<string, boolean>();

  for (const override of overrides) {
    switch (override.scope) {
      case 'link-gap-resolve': {
        if (override.payload.type !== 'link_gap_resolve') {
          return err(
            new Error(
              `Link gap resolution replay expected payload type 'link_gap_resolve' for scope 'link-gap-resolve', got '${override.payload.type}'`
            )
          );
        }

        resolvedByIssueKey.set(buildLinkGapIssueKey(buildResolvedLinkGapIssueFromOverride(override.payload)), true);
        break;
      }

      case 'link-gap-reopen': {
        if (override.payload.type !== 'link_gap_reopen') {
          return err(
            new Error(
              `Link gap resolution replay expected payload type 'link_gap_reopen' for scope 'link-gap-reopen', got '${override.payload.type}'`
            )
          );
        }

        resolvedByIssueKey.set(buildLinkGapIssueKey(buildResolvedLinkGapIssueFromOverride(override.payload)), false);
        break;
      }

      default:
        return err(
          new Error(
            `Link gap resolution replay received unsupported scope '${override.scope}'. Only 'link-gap-resolve' and 'link-gap-reopen' are allowed.`
          )
        );
    }
  }

  const resolvedIssueKeys = new Set<string>();
  for (const [issueKey, isResolved] of resolvedByIssueKey) {
    if (isResolved) {
      resolvedIssueKeys.add(issueKey);
    }
  }

  return ok(resolvedIssueKeys);
}

/**
 * Read and replay link-gap resolution overrides from the durable override store.
 */
export async function readResolvedLinkGapIssueKeys(
  overrideStore: Pick<OverrideStore, 'exists' | 'readByScopes'>,
  profileKey: string
): Promise<Result<Set<string>, Error>> {
  if (!overrideStore.exists()) {
    return ok(new Set<string>());
  }

  const overridesResult = await overrideStore.readByScopes(profileKey, ['link-gap-resolve', 'link-gap-reopen']);
  if (overridesResult.isErr()) {
    return err(new Error(`Failed to read link gap resolution override events: ${overridesResult.error.message}`));
  }

  return replayResolvedLinkGapIssues(overridesResult.value);
}
