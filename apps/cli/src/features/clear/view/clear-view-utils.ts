/**
 * Clear view utilities - category descriptions and formatting
 */

/**
 * Get description for a category key
 */
export function getCategoryDescription(key: string): string {
  const descriptions: Record<string, string> = {
    transactions: 'Processed transaction records with movements, fees, metadata',
    links: 'Transfer link matches between outflows and inflows',
    assetReviewStates: 'Derived asset-review summaries used by accounting and portfolio flows',
    balanceSnapshots: 'Stored balance scope snapshots used for balance view and verification',
    balanceSnapshotAssets: 'Per-asset rows stored under each balance snapshot scope',
    costBasisSnapshots: 'Stored latest cost-basis artifacts for reusable tax calculations',
    lots: 'Cost basis tracking lots for tax calculations',
    disposals: 'Records of acquisition lot disposals',
    transfers: 'Records of lot movements between accounts',
    calculations: 'Tax calculation snapshots and results',
    accounts: 'Account records linking sources to your profile',
    sessions: 'Import run history and metadata',
    rawData: 'Original imported data from exchanges and blockchains',
  };

  return descriptions[key] ?? '';
}

/**
 * Format count with thousand separators
 */
export function formatCount(count: number): string {
  return count.toLocaleString('en-US');
}
