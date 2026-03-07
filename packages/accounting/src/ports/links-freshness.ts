import type { ProjectionStatus, Result } from '@exitbook/core';

export interface LinksFreshnessResult {
  status: ProjectionStatus;
  reason: string | undefined;
}

/**
 * Port for checking whether the links projection is fresh.
 *
 * Freshness is stale when:
 * - No links exist but transactions do
 * - Newest transaction is newer than newest link
 * - Projection state is explicitly marked stale
 */
export interface ILinksFreshness {
  checkFreshness(): Promise<Result<LinksFreshnessResult, Error>>;
}
