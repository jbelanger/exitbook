import { buildLinkGapIssueKey, type LinkGapIssueIdentity } from '@exitbook/accounting/linking';
import type { OverrideEvent } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/foundation';

import type { OverrideStore } from './override-store.js';

export type ResolvedLinkGapIssue = LinkGapIssueIdentity;
export interface ResolvedLinkGapException extends ResolvedLinkGapIssue {
  reason?: string | undefined;
  resolvedAt: string;
}

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
  const resolvedExceptionsResult = replayResolvedLinkGapExceptions(overrides);
  if (resolvedExceptionsResult.isErr()) {
    return err(resolvedExceptionsResult.error);
  }

  return ok(new Set(resolvedExceptionsResult.value.keys()));
}

export function replayResolvedLinkGapExceptions(
  overrides: OverrideEvent[]
): Result<Map<string, ResolvedLinkGapException>, Error> {
  const resolvedByIssueKey = new Map<string, ResolvedLinkGapException>();

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

        const resolvedIssue = buildResolvedLinkGapIssueFromOverride(override.payload);
        resolvedByIssueKey.set(buildLinkGapIssueKey(resolvedIssue), {
          ...resolvedIssue,
          reason: override.reason,
          resolvedAt: override.created_at,
        });
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

        resolvedByIssueKey.delete(buildLinkGapIssueKey(buildResolvedLinkGapIssueFromOverride(override.payload)));
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

  return ok(resolvedByIssueKey);
}

/**
 * Read and replay link-gap resolution overrides from the durable override store.
 */
export async function readResolvedLinkGapIssueKeys(
  overrideStore: Pick<OverrideStore, 'exists' | 'readByScopes'>,
  profileKey: string
): Promise<Result<Set<string>, Error>> {
  const resolvedExceptionsResult = await readResolvedLinkGapExceptions(overrideStore, profileKey);
  if (resolvedExceptionsResult.isErr()) {
    return err(resolvedExceptionsResult.error);
  }

  return ok(new Set(resolvedExceptionsResult.value.keys()));
}

export async function readResolvedLinkGapExceptions(
  overrideStore: Pick<OverrideStore, 'exists' | 'readByScopes'>,
  profileKey: string
): Promise<Result<Map<string, ResolvedLinkGapException>, Error>> {
  if (!overrideStore.exists()) {
    return ok(new Map<string, ResolvedLinkGapException>());
  }

  const overridesResult = await overrideStore.readByScopes(profileKey, ['link-gap-resolve', 'link-gap-reopen']);
  if (overridesResult.isErr()) {
    return err(new Error(`Failed to read link gap resolution override events: ${overridesResult.error.message}`));
  }

  return replayResolvedLinkGapExceptions(overridesResult.value);
}
