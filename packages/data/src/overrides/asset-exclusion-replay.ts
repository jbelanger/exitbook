import type { OverrideEvent } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/foundation';

import type { OverrideStore } from './override-store.js';

/**
 * Replay asset exclusion override events with latest-event-wins semantics.
 *
 * The input must contain only asset exclusion scopes. Any other scope is an
 * error because accounting exclusion replay is intentionally strict.
 */
export function replayAssetExclusionEvents(overrides: OverrideEvent[]): Result<Set<string>, Error> {
  const excludedByAssetId = new Map<string, boolean>();

  for (const override of overrides) {
    switch (override.scope) {
      case 'asset-exclude': {
        if (override.payload.type !== 'asset_exclude') {
          return err(
            new Error(
              `Asset exclusion replay expected payload type 'asset_exclude' for scope 'asset-exclude', got '${override.payload.type}'`
            )
          );
        }

        excludedByAssetId.set(override.payload.asset_id, true);
        break;
      }

      case 'asset-include': {
        if (override.payload.type !== 'asset_include') {
          return err(
            new Error(
              `Asset exclusion replay expected payload type 'asset_include' for scope 'asset-include', got '${override.payload.type}'`
            )
          );
        }

        excludedByAssetId.set(override.payload.asset_id, false);
        break;
      }

      default:
        return err(
          new Error(
            `Asset exclusion replay received unsupported scope '${override.scope}'. Only 'asset-exclude' and 'asset-include' are allowed.`
          )
        );
    }
  }

  const excludedAssetIds = new Set<string>();
  for (const [assetId, isExcluded] of excludedByAssetId) {
    if (isExcluded) {
      excludedAssetIds.add(assetId);
    }
  }

  return ok(excludedAssetIds);
}

/**
 * Read and replay asset exclusion overrides from the durable override store.
 */
export async function readExcludedAssetIds(
  overrideStore: Pick<OverrideStore, 'exists' | 'readByScopes'>
): Promise<Result<Set<string>, Error>> {
  if (!overrideStore.exists()) {
    return ok(new Set<string>());
  }

  const overridesResult = await overrideStore.readByScopes(['asset-exclude', 'asset-include']);
  if (overridesResult.isErr()) {
    return err(new Error(`Failed to read asset exclusion override events: ${overridesResult.error.message}`));
  }

  return replayAssetExclusionEvents(overridesResult.value);
}
