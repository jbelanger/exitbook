import type { CreateOverrideEventOptions } from '@exitbook/core';
import {
  materializeStoredTransactionUserNoteOverrides,
  readTransactionUserNoteOverrides,
  type OverrideStore,
} from '@exitbook/data/overrides';
import type { DataSession } from '@exitbook/data/session';
import { err, ok, type Result } from '@exitbook/foundation';

import {
  toTransactionEditTransactionSummary,
  type TransactionEditTarget,
  type TransactionEditTransactionSummary,
} from './transaction-edit-target.js';
import {
  buildReprocessRequiredTransactionEditState,
  buildSynchronizedTransactionEditState,
  type TransactionEditProjectionSyncState,
} from './transactions-edit-result.js';

type TransactionEditOverrideStore = Pick<OverrideStore, 'append' | 'exists' | 'readByScopes'>;
type TransactionEditMaterializationDatabase = Pick<DataSession, 'transactions'>;

interface TransactionUserNoteSetParams {
  message: string;
  profileKey: string;
  reason?: string | undefined;
  target: TransactionEditTarget;
}

interface TransactionUserNoteClearParams {
  profileKey: string;
  reason?: string | undefined;
  target: TransactionEditTarget;
}

export interface TransactionUserNoteEditResult extends TransactionEditProjectionSyncState {
  action: 'set' | 'clear';
  changed: boolean;
  note?: string | undefined;
  reason?: string | undefined;
  transaction: TransactionEditTransactionSummary;
}

export class TransactionsEditNoteHandler {
  constructor(
    private readonly db: TransactionEditMaterializationDatabase,
    private readonly overrideStore: TransactionEditOverrideStore
  ) {}

  async setNote(params: TransactionUserNoteSetParams): Promise<Result<TransactionUserNoteEditResult, Error>> {
    const userNoteOverridesResult = await readTransactionUserNoteOverrides(this.overrideStore, params.profileKey);
    if (userNoteOverridesResult.isErr()) {
      return err(userNoteOverridesResult.error);
    }

    const existingUserNote = userNoteOverridesResult.value.get(params.target.txFingerprint);
    if (existingUserNote?.message === params.message) {
      const syncState = await this.synchronizeUserNoteProjection(params.profileKey, params.target.transactionId);
      if (syncState.isErr()) {
        return err(syncState.error);
      }

      return ok({
        action: 'set',
        changed: false,
        note: params.message,
        reason: params.reason,
        transaction: toTransactionEditTransactionSummary(params.target),
        ...syncState.value,
      });
    }

    const appendResult = await this.appendOverride({
      profileKey: params.profileKey,
      scope: 'transaction-user-note',
      payload: {
        type: 'transaction_user_note_override',
        action: 'set',
        tx_fingerprint: params.target.txFingerprint,
        message: params.message,
      },
      reason: params.reason,
    });
    if (appendResult.isErr()) {
      return err(appendResult.error);
    }

    const syncState = await this.synchronizeUserNoteProjection(params.profileKey, params.target.transactionId);
    if (syncState.isErr()) {
      return err(syncState.error);
    }

    return ok({
      action: 'set',
      changed: true,
      note: params.message,
      reason: params.reason,
      transaction: toTransactionEditTransactionSummary(params.target),
      ...syncState.value,
    });
  }

  async clearNote(params: TransactionUserNoteClearParams): Promise<Result<TransactionUserNoteEditResult, Error>> {
    const userNoteOverridesResult = await readTransactionUserNoteOverrides(this.overrideStore, params.profileKey);
    if (userNoteOverridesResult.isErr()) {
      return err(userNoteOverridesResult.error);
    }

    if (!userNoteOverridesResult.value.has(params.target.txFingerprint)) {
      const syncState = await this.synchronizeUserNoteProjection(params.profileKey, params.target.transactionId);
      if (syncState.isErr()) {
        return err(syncState.error);
      }

      return ok({
        action: 'clear',
        changed: false,
        reason: params.reason,
        transaction: toTransactionEditTransactionSummary(params.target),
        ...syncState.value,
      });
    }

    const appendResult = await this.appendOverride({
      profileKey: params.profileKey,
      scope: 'transaction-user-note',
      payload: {
        type: 'transaction_user_note_override',
        action: 'clear',
        tx_fingerprint: params.target.txFingerprint,
      },
      reason: params.reason,
    });
    if (appendResult.isErr()) {
      return err(appendResult.error);
    }

    const syncState = await this.synchronizeUserNoteProjection(params.profileKey, params.target.transactionId);
    if (syncState.isErr()) {
      return err(syncState.error);
    }

    return ok({
      action: 'clear',
      changed: true,
      reason: params.reason,
      transaction: toTransactionEditTransactionSummary(params.target),
      ...syncState.value,
    });
  }

  private async appendOverride(options: CreateOverrideEventOptions): Promise<Result<void, Error>> {
    const appendResult = await this.overrideStore.append(options);
    if (appendResult.isErr()) {
      return err(new Error(`Failed to write transaction user note override event: ${appendResult.error.message}`));
    }

    return ok(undefined);
  }

  private async materializeTransactionUserNote(
    profileKey: string,
    transactionId: number
  ): Promise<Result<void, Error>> {
    const materializeResult = await materializeStoredTransactionUserNoteOverrides(
      this.db.transactions,
      this.overrideStore,
      profileKey,
      {
        transactionIds: [transactionId],
      }
    );
    if (materializeResult.isErr()) {
      return err(new Error(`Failed to materialize transaction user note override: ${materializeResult.error.message}`));
    }

    return ok(undefined);
  }

  private async synchronizeUserNoteProjection(
    profileKey: string,
    transactionId: number
  ): Promise<Result<TransactionEditProjectionSyncState, Error>> {
    const materializeResult = await this.materializeTransactionUserNote(profileKey, transactionId);
    if (materializeResult.isErr()) {
      return ok(
        buildReprocessRequiredTransactionEditState([
          `Override state is current, but transaction note projection refresh failed: ${materializeResult.error.message}`,
        ])
      );
    }

    return ok(buildSynchronizedTransactionEditState());
  }
}
