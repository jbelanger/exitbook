import { resultDoAsync, type Result } from '@exitbook/foundation';

import type {
  IProfileLinkGapSourceReader,
  ProfileLinkGapSourceData,
} from '../../ports/profile-link-gap-source-reader.js';

import {
  analyzeLinkGaps,
  applyAssetReviewGapCues,
  applyResolvedLinkGapVisibility,
  type ResolvedLinkGapVisibilityResult,
} from './gap-analysis.js';
import type { LinkGapAnalysis } from './gap-model.js';

export function buildProfileLinkGapAnalysis(source: ProfileLinkGapSourceData): LinkGapAnalysis {
  return applyAssetReviewGapCues(
    analyzeLinkGaps([...source.transactions], [...source.links], {
      accounts: source.accounts,
      excludedAssetIds: source.excludedAssetIds,
      transactionAnnotations: source.transactionAnnotations,
    }),
    source.assetReviewSummaries
  );
}

export function buildVisibleProfileLinkGapAnalysis(source: ProfileLinkGapSourceData): ResolvedLinkGapVisibilityResult {
  return applyResolvedLinkGapVisibility(buildProfileLinkGapAnalysis(source), source.resolvedIssueKeys);
}

export async function loadVisibleProfileLinkGapAnalysis(
  sourceReader: IProfileLinkGapSourceReader
): Promise<Result<ResolvedLinkGapVisibilityResult, Error>> {
  return resultDoAsync(async function* () {
    const source = yield* await sourceReader.loadProfileLinkGapSourceData();
    return buildVisibleProfileLinkGapAnalysis(source);
  });
}
