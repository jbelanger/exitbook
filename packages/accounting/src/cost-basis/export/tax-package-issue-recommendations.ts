import type { TaxPackageIssue } from './tax-package-types.js';

export function getDefaultRecommendedAction(code: TaxPackageIssue['code']): string {
  switch (code) {
    case 'MISSING_PRICE_DATA':
      return 'Enrich or set the missing prices, then rerun the package export.';
    case 'FX_FALLBACK_USED':
      return 'Review the FX conversions and confirm the fallback treatment is acceptable.';
    case 'UNRESOLVED_ASSET_REVIEW':
      return 'Resolve the pending asset reviews before using this package for filing.';
    case 'UNKNOWN_TRANSACTION_CLASSIFICATION':
      return 'Review the transaction operation classification (for example transfer, swap, reward, or fee) before filing.';
    case 'UNCERTAIN_PROCEEDS_ALLOCATION':
      return 'Inspect the source transaction if exact per-asset proceeds allocation matters for filing.';
    case 'INCOMPLETE_TRANSFER_LINKING':
      return 'Review the affected transfer rows and confirm the internal carryover treatment.';
  }

  return 'Review the affected package rows before filing.';
}
