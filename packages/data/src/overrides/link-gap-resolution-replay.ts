import type { OverrideEvent } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/foundation';

import type { OverrideStore } from './override-store.js';

/**
 * Replay link-gap resolution overrides with latest-event-wins semantics.
 */
export function replayLinkGapResolutionEvents(overrides: OverrideEvent[]): Result<Set<string>, Error> {
  const resolvedByFingerprint = new Map<string, boolean>();

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

        resolvedByFingerprint.set(override.payload.tx_fingerprint, true);
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

        resolvedByFingerprint.set(override.payload.tx_fingerprint, false);
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

  const resolvedTxFingerprints = new Set<string>();
  for (const [txFingerprint, isResolved] of resolvedByFingerprint) {
    if (isResolved) {
      resolvedTxFingerprints.add(txFingerprint);
    }
  }

  return ok(resolvedTxFingerprints);
}

/**
 * Read and replay link-gap resolution overrides from the durable override store.
 */
export async function readResolvedLinkGapTxFingerprints(
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

  return replayLinkGapResolutionEvents(overridesResult.value);
}
