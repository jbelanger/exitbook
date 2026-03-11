import { err, ok, type Result } from '@exitbook/core';
import { getLogger } from '@exitbook/logger';

import type { AssetReviewProjectionPorts } from '../../ports/asset-review-projection-ports.js';

import {
  buildAssetReviewSummaries,
  type AssetReviewReferenceResolver,
  type AssetReviewTokenMetadataReader,
} from './asset-review-service.js';

const logger = getLogger('asset-review-projection-workflow');

export interface AssetReviewProjectionRebuildOptions {
  referenceResolver?: AssetReviewReferenceResolver | undefined;
  tokenMetadataReader?: AssetReviewTokenMetadataReader | undefined;
}

export class AssetReviewProjectionWorkflow {
  constructor(private readonly ports: AssetReviewProjectionPorts) {}

  async rebuild(options: AssetReviewProjectionRebuildOptions = {}): Promise<Result<void, Error>> {
    const buildingResult = await this.ports.markAssetReviewBuilding();
    if (buildingResult.isErr()) {
      return err(buildingResult.error);
    }

    const transactionsResult = await this.ports.listTransactions();
    if (transactionsResult.isErr()) {
      return this.fail(
        new Error(`Failed to load transactions for asset review projection: ${transactionsResult.error.message}`)
      );
    }

    const decisionsResult = await this.ports.loadReviewDecisions();
    if (decisionsResult.isErr()) {
      return this.fail(decisionsResult.error);
    }

    const summariesResult = await buildAssetReviewSummaries(transactionsResult.value, {
      reviewDecisions: decisionsResult.value,
      tokenMetadataReader: options.tokenMetadataReader,
      referenceResolver: options.referenceResolver,
    });
    if (summariesResult.isErr()) {
      return this.fail(summariesResult.error);
    }

    const replaceResult = await this.ports.replaceAssetReviewProjection(summariesResult.value.values(), {
      assetCount: summariesResult.value.size,
    });
    if (replaceResult.isErr()) {
      return this.fail(replaceResult.error);
    }

    return ok(undefined);
  }

  private async fail(error: Error): Promise<Result<void, Error>> {
    const failedResult = await this.ports.markAssetReviewFailed();
    if (failedResult.isErr()) {
      logger.warn({ error: failedResult.error }, 'Failed to mark asset-review projection as failed');
    }

    logger.warn({ error }, 'Asset review projection rebuild failed');
    return err(error);
  }
}
