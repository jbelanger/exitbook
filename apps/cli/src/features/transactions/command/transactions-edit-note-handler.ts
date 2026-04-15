import type { CreateOverrideEventOptions } from '@exitbook/core';
import {
  materializeStoredTransactionUserNoteOverrides,
  readTransactionUserNoteOverrides,
  type OverrideStore,
} from '@exitbook/data/overrides';
import type { DataSession } from '@exitbook/data/session';
import { err, ok, type Result } from '@exitbook/foundation';

import type { TransactionEditTarget } from './transaction-edit-target.js';

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

export interface TransactionUserNoteEditResult {
  action: 'set' | 'clear';
  changed: boolean;
  note?: string | undefined;
  platformKey: string;
  reason?: string | undefined;
  transactionId: number;
  txFingerprint: string;
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
      return ok({
        action: 'set',
        changed: false,
        note: params.message,
        platformKey: params.target.platformKey,
        reason: params.reason,
        transactionId: params.target.transactionId,
        txFingerprint: params.target.txFingerprint,
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

    const materializeResult = await this.materializeTransactionUserNote(params.profileKey, params.target.transactionId);
    if (materializeResult.isErr()) {
      return err(materializeResult.error);
    }

    return ok({
      action: 'set',
      changed: true,
      note: params.message,
      platformKey: params.target.platformKey,
      reason: params.reason,
      transactionId: params.target.transactionId,
      txFingerprint: params.target.txFingerprint,
    });
  }

  async clearNote(params: TransactionUserNoteClearParams): Promise<Result<TransactionUserNoteEditResult, Error>> {
    const userNoteOverridesResult = await readTransactionUserNoteOverrides(this.overrideStore, params.profileKey);
    if (userNoteOverridesResult.isErr()) {
      return err(userNoteOverridesResult.error);
    }

    if (!userNoteOverridesResult.value.has(params.target.txFingerprint)) {
      return ok({
        action: 'clear',
        changed: false,
        platformKey: params.target.platformKey,
        reason: params.reason,
        transactionId: params.target.transactionId,
        txFingerprint: params.target.txFingerprint,
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

    const materializeResult = await this.materializeTransactionUserNote(params.profileKey, params.target.transactionId);
    if (materializeResult.isErr()) {
      return err(materializeResult.error);
    }

    return ok({
      action: 'clear',
      changed: true,
      platformKey: params.target.platformKey,
      reason: params.reason,
      transactionId: params.target.transactionId,
      txFingerprint: params.target.txFingerprint,
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
}
