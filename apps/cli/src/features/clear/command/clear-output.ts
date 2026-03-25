import type { Result } from '@exitbook/foundation';

import { outputSuccess } from '../../shared/json-output.js';
import { stopSpinner, type SpinnerWrapper } from '../../shared/spinner.js';

import type { ClearCommandResult } from './clear-command-types.js';
import { flattenPreview, type ClearResult, type FlatDeletionPreview } from './clear-handler.js';

interface ClearAccountLookup {
  findById(accountId: number): Promise<Result<{ platformKey: string } | undefined, Error>>;
}

export async function buildScopeLabel(
  accountId: number | undefined,
  source: string | undefined,
  accountRepo: ClearAccountLookup
): Promise<string> {
  if (accountId) {
    const accountResult = await accountRepo.findById(accountId);
    if (accountResult.isOk() && accountResult.value) {
      return `#${accountId} ${accountResult.value.platformKey}`;
    }
    return `#${accountId}`;
  }
  if (source) {
    return `(${source})`;
  }
  return 'all accounts';
}

export function outputClearEmptyResult(flat: FlatDeletionPreview, isJsonMode: boolean): void {
  if (isJsonMode) {
    outputSuccess('clear', { deleted: flat } satisfies ClearCommandResult);
    return;
  }

  console.error('No data to clear.');
}

export function outputClearPreview(flat: FlatDeletionPreview, includeRaw: boolean): void {
  console.error('\nThis will clear:');
  if (flat.transactions > 0) console.error(`  - ${flat.transactions} transactions`);
  if (flat.links > 0) console.error(`  - ${flat.links} transaction links`);
  if (flat.assetReviewStates > 0) console.error(`  - ${flat.assetReviewStates} asset review states`);
  if (flat.balanceSnapshots > 0) console.error(`  - ${flat.balanceSnapshots} balance snapshots`);
  if (flat.balanceSnapshotAssets > 0) console.error(`  - ${flat.balanceSnapshotAssets} balance snapshot assets`);
  if (flat.costBasisSnapshots > 0) console.error(`  - ${flat.costBasisSnapshots} cost-basis snapshots`);

  if (includeRaw) {
    console.error('\nWARNING: Raw data will also be deleted:');
    if (flat.accounts > 0) console.error(`  - ${flat.accounts} accounts`);
    if (flat.sessions > 0) console.error(`  - ${flat.sessions} import sessions`);
    if (flat.rawData > 0) console.error(`  - ${flat.rawData} raw data items`);
    console.error('\nYou will need to re-import from exchanges/blockchains (slow, rate-limited).');
  } else {
    console.error('\nRaw imported data will be preserved:');
    if (flat.sessions > 0) console.error(`  - ${flat.sessions} sessions`);
    if (flat.rawData > 0) console.error(`  - ${flat.rawData} raw data items`);
    console.error('\nYou can reprocess with: exitbook reprocess');
  }

  console.error('');
}

export function handleClearSuccess(
  clearResult: ClearResult,
  spinner: SpinnerWrapper | undefined,
  isJsonMode: boolean
): void {
  const flat = flattenPreview(clearResult.deleted);
  const resultData: ClearCommandResult = { deleted: flat };

  const parts: string[] = [];
  if (flat.transactions > 0) parts.push(`${flat.transactions} transactions`);
  if (flat.links > 0) parts.push(`${flat.links} links`);
  if (flat.assetReviewStates > 0) parts.push(`${flat.assetReviewStates} asset review states`);
  if (flat.balanceSnapshots > 0) parts.push(`${flat.balanceSnapshots} balance snapshots`);
  if (flat.balanceSnapshotAssets > 0) parts.push(`${flat.balanceSnapshotAssets} balance snapshot assets`);
  if (flat.costBasisSnapshots > 0) parts.push(`${flat.costBasisSnapshots} cost-basis snapshots`);
  if (flat.accounts > 0) parts.push(`${flat.accounts} accounts`);
  if (flat.sessions > 0) parts.push(`${flat.sessions} sessions`);
  if (flat.rawData > 0) parts.push(`${flat.rawData} raw items`);

  const completionMessage =
    parts.length > 0 ? `Clear complete - ${parts.join(', ')}` : 'Clear complete - no data deleted';

  stopSpinner(spinner, completionMessage);

  if (isJsonMode) {
    outputSuccess('clear', resultData);
  }
}
