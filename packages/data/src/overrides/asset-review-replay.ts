import { err, ok, type OverrideEvent, type Result } from '@exitbook/core';

import type { OverrideStore } from './override-store.js';

export type AssetReviewDecision =
  | {
      action: 'clear';
      assetId: string;
    }
  | {
      action: 'confirm';
      assetId: string;
      evidenceFingerprint: string;
    };

/**
 * Replay asset review override events with latest-event-wins semantics.
 *
 * The input must contain only asset review scopes. Any other scope is an
 * error because review replay is intentionally strict.
 */
export function replayAssetReviewEvents(overrides: OverrideEvent[]): Result<Map<string, AssetReviewDecision>, Error> {
  const decisionsByAssetId = new Map<string, AssetReviewDecision>();

  for (const override of overrides) {
    switch (override.scope) {
      case 'asset-review-confirm': {
        if (override.payload.type !== 'asset_review_confirm') {
          return err(
            new Error(
              `Asset review replay expected payload type 'asset_review_confirm' for scope 'asset-review-confirm', got '${override.payload.type}'`
            )
          );
        }

        decisionsByAssetId.set(override.payload.asset_id, {
          action: 'confirm',
          assetId: override.payload.asset_id,
          evidenceFingerprint: override.payload.evidence_fingerprint,
        });
        break;
      }

      case 'asset-review-clear': {
        if (override.payload.type !== 'asset_review_clear') {
          return err(
            new Error(
              `Asset review replay expected payload type 'asset_review_clear' for scope 'asset-review-clear', got '${override.payload.type}'`
            )
          );
        }

        decisionsByAssetId.set(override.payload.asset_id, {
          action: 'clear',
          assetId: override.payload.asset_id,
        });
        break;
      }

      default:
        return err(
          new Error(
            `Asset review replay received unsupported scope '${override.scope}'. Only 'asset-review-confirm' and 'asset-review-clear' are allowed.`
          )
        );
    }
  }

  return ok(decisionsByAssetId);
}

/**
 * Read and replay asset review overrides from the durable override store.
 */
export async function readAssetReviewDecisions(
  overrideStore: Pick<OverrideStore, 'exists' | 'readByScopes'>
): Promise<Result<Map<string, AssetReviewDecision>, Error>> {
  if (!overrideStore.exists()) {
    return ok(new Map<string, AssetReviewDecision>());
  }

  const overridesResult = await overrideStore.readByScopes(['asset-review-confirm', 'asset-review-clear']);
  if (overridesResult.isErr()) {
    return err(new Error(`Failed to read asset review override events: ${overridesResult.error.message}`));
  }

  return replayAssetReviewEvents(overridesResult.value);
}
