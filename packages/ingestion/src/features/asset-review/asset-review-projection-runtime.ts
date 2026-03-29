import type { Result } from '@exitbook/foundation';
import { err, ok, pickLatestDate } from '@exitbook/foundation';

import type { AssetReviewProjectionRuntimePorts } from '../../ports/asset-review-projection-ports.js';

import { AssetReviewProjectionWorkflow } from './asset-review-projection-workflow.js';
import type { AssetReviewReferenceResolver, AssetReviewTokenMetadataReader } from './asset-review-service.js';

export interface AssetReviewProviderSupport {
  getByTokenRefs?: AssetReviewTokenMetadataReader['getByTokenRefs'] | undefined;
  resolveBatch?: AssetReviewReferenceResolver['resolveBatch'] | undefined;
  cleanup(): Promise<void>;
}

export interface AssetReviewProviderSupportFactory {
  open(): Promise<Result<AssetReviewProviderSupport, Error>>;
}

export interface AssetReviewTokenMetadataFreshnessReader {
  findLatestTokenMetadataRefreshAt(): Promise<Result<Date | undefined, Error>>;
}

export interface AssetReviewProjectionRuntime {
  ensureFresh(): Promise<Result<void, Error>>;
  rebuild(): Promise<Result<void, Error>>;
}

export interface CreateAssetReviewProjectionRuntimeOptions {
  ports: AssetReviewProjectionRuntimePorts;
  providerSupportFactory: AssetReviewProviderSupportFactory;
  tokenMetadataFreshness: AssetReviewTokenMetadataFreshnessReader;
}

export function createAssetReviewProjectionRuntime(
  options: CreateAssetReviewProjectionRuntimeOptions
): AssetReviewProjectionRuntime {
  return {
    async ensureFresh() {
      const freshnessResult = await options.ports.checkAssetReviewFreshness();
      if (freshnessResult.isErr()) {
        return err(freshnessResult.error);
      }

      let needsRebuild = freshnessResult.value.status !== 'fresh';
      if (!needsRebuild) {
        const externalStalenessResult = await findAssetReviewExternalStalenessReason(options);
        if (externalStalenessResult.isErr()) {
          return err(externalStalenessResult.error);
        }

        needsRebuild = externalStalenessResult.value !== undefined;
      }

      if (!needsRebuild) {
        return ok(undefined);
      }

      return rebuildAssetReviewProjection(options);
    },

    rebuild() {
      return rebuildAssetReviewProjection(options);
    },
  };
}

async function rebuildAssetReviewProjection(
  options: CreateAssetReviewProjectionRuntimeOptions
): Promise<Result<void, Error>> {
  const providerSupportResult = await options.providerSupportFactory.open();
  if (providerSupportResult.isErr()) {
    return err(providerSupportResult.error);
  }

  const providerSupport = providerSupportResult.value;
  const workflow = new AssetReviewProjectionWorkflow(options.ports);
  const tokenMetadataReader = providerSupport.getByTokenRefs
    ? (providerSupport as AssetReviewTokenMetadataReader)
    : undefined;
  const referenceResolver = providerSupport.resolveBatch
    ? (providerSupport as AssetReviewReferenceResolver)
    : undefined;

  const rebuildResult = await workflow.rebuild({
    tokenMetadataReader,
    referenceResolver,
  });

  try {
    await providerSupport.cleanup();
  } catch (error) {
    const cleanupError = error instanceof Error ? error : new Error(String(error));
    if (rebuildResult.isErr()) {
      return err(
        new AggregateError(
          [rebuildResult.error, cleanupError],
          'Asset review rebuild failed and provider support cleanup also failed'
        )
      );
    }

    return err(cleanupError);
  }

  return rebuildResult;
}

async function findAssetReviewExternalStalenessReason(
  options: CreateAssetReviewProjectionRuntimeOptions
): Promise<Result<string | undefined, Error>> {
  const lastBuiltAtResult = await options.ports.getLastAssetReviewBuiltAt();
  if (lastBuiltAtResult.isErr()) {
    return err(lastBuiltAtResult.error);
  }

  const lastBuiltAt = lastBuiltAtResult.value;
  if (!lastBuiltAt) {
    return ok(undefined);
  }

  const latestExternalInputAtResult = await findLatestAssetReviewExternalInputAt(options);
  if (latestExternalInputAtResult.isErr()) {
    return err(latestExternalInputAtResult.error);
  }

  const latestExternalInputAt = latestExternalInputAtResult.value;
  if (!latestExternalInputAt || latestExternalInputAt <= lastBuiltAt) {
    return ok(undefined);
  }

  return ok('asset review external inputs changed since last rebuild');
}

async function findLatestAssetReviewExternalInputAt(
  options: CreateAssetReviewProjectionRuntimeOptions
): Promise<Result<Date | undefined, Error>> {
  const latestOverrideAtResult = await options.ports.findLatestAssetReviewOverrideAt();
  if (latestOverrideAtResult.isErr()) {
    return err(latestOverrideAtResult.error);
  }

  const latestTokenMetadataAtResult = await options.tokenMetadataFreshness.findLatestTokenMetadataRefreshAt();
  if (latestTokenMetadataAtResult.isErr()) {
    return err(latestTokenMetadataAtResult.error);
  }

  return ok(pickLatestDate(latestOverrideAtResult.value, latestTokenMetadataAtResult.value));
}
