import { describe, expect, it } from 'vitest';

import { getDefaultRecommendedAction } from '../tax-package-issue-recommendations.js';

describe('getDefaultRecommendedAction', () => {
  it('should return recommendation for MISSING_PRICE_DATA', () => {
    expect(getDefaultRecommendedAction('MISSING_PRICE_DATA')).toContain('Enrich or set the missing prices');
  });

  it('should return recommendation for FX_FALLBACK_USED', () => {
    expect(getDefaultRecommendedAction('FX_FALLBACK_USED')).toContain('FX conversions');
  });

  it('should return recommendation for UNRESOLVED_ASSET_REVIEW', () => {
    expect(getDefaultRecommendedAction('UNRESOLVED_ASSET_REVIEW')).toContain('asset reviews');
  });

  it('should return recommendation for UNKNOWN_TRANSACTION_CLASSIFICATION', () => {
    expect(getDefaultRecommendedAction('UNKNOWN_TRANSACTION_CLASSIFICATION')).toContain('operation classification');
  });

  it('should return recommendation for UNCERTAIN_PROCEEDS_ALLOCATION', () => {
    expect(getDefaultRecommendedAction('UNCERTAIN_PROCEEDS_ALLOCATION')).toContain('per-asset proceeds allocation');
  });

  it('should return recommendation for INCOMPLETE_TRANSFER_LINKING', () => {
    expect(getDefaultRecommendedAction('INCOMPLETE_TRANSFER_LINKING')).toContain('transfer rows');
  });

  it('should return generic recommendation for unknown codes', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument -- ok for tests
    const result = getDefaultRecommendedAction('SOME_FUTURE_CODE' as any);
    expect(result).toContain('Review the affected package rows before filing');
  });
});
