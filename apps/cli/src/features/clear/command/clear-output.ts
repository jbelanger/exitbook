import { jsonSuccess, silentSuccess, textSuccess, type CliCompletion } from '../../../cli/command.js';
import { stopSpinner, type SpinnerWrapper } from '../../shared/spinner.js';

import type { ClearCommandResult } from './clear-command-types.js';
import { flattenPreview, type ClearResult, type FlatDeletionPreview } from './clear-service.js';

export function buildScopeLabel(accountLabel: string | undefined, platformKey: string | undefined): string {
  if (accountLabel) {
    return accountLabel;
  }
  if (platformKey) {
    return `(${platformKey})`;
  }
  return 'all accounts';
}

export function buildClearEmptyCompletion(flat: FlatDeletionPreview, isJsonMode: boolean): CliCompletion {
  if (isJsonMode) {
    return jsonSuccess({ deleted: flat } satisfies ClearCommandResult);
  }

  return textSuccess(() => {
    console.error('No data to clear.');
  });
}

export function buildClearSuccessCompletion(
  clearResult: ClearResult,
  spinner: SpinnerWrapper | undefined,
  isJsonMode: boolean
): CliCompletion {
  const flat = flattenPreview(clearResult.deleted);
  const resultData: ClearCommandResult = { deleted: flat };

  if (isJsonMode) {
    return jsonSuccess(resultData);
  }

  stopSpinner(spinner, buildClearCompletionMessage(flat));
  return silentSuccess();
}

function buildClearCompletionMessage(flat: FlatDeletionPreview): string {
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

  return parts.length > 0 ? `Clear complete - ${parts.join(', ')}` : 'Clear complete - no data deleted';
}
