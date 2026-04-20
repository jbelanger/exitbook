export const TRANSACTION_EDIT_REPAIR_COMMAND = 'exitbook reprocess';

export type TransactionEditProjectionSyncStatus = 'synchronized' | 'reprocess-required';

export interface TransactionEditProjectionSyncState {
  projectionSyncStatus: TransactionEditProjectionSyncStatus;
  repairCommand?: string | undefined;
  warnings: string[];
}

export function buildSynchronizedTransactionEditState(): TransactionEditProjectionSyncState {
  return {
    projectionSyncStatus: 'synchronized',
    warnings: [],
  };
}

export function buildReprocessRequiredTransactionEditState(warnings: string[]): TransactionEditProjectionSyncState {
  return {
    projectionSyncStatus: 'reprocess-required',
    repairCommand: TRANSACTION_EDIT_REPAIR_COMMAND,
    warnings,
  };
}
