import type { Result } from '@exitbook/core';

export interface LinksResetImpact {
  links: number;
}

/**
 * Port for resetting the links projection.
 *
 * Owns:
 * - transaction_links
 */
export interface ILinksReset {
  countResetImpact(accountIds?: number[]): Promise<Result<LinksResetImpact, Error>>;
  reset(accountIds?: number[]): Promise<Result<LinksResetImpact, Error>>;
}
