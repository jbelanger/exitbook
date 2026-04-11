import type { CreateOverrideEventOptions } from '@exitbook/core';
import {
  materializeStoredTransactionUserNoteOverrides,
  readTransactionUserNoteOverrides,
  type OverrideStore,
} from '@exitbook/data/overrides';
import type { DataSession } from '@exitbook/data/session';
import { err, ok, type Result } from '@exitbook/foundation';

type TransactionEditOverrideStore = Pick<OverrideStore, 'append' | 'exists' | 'readByScopes'>;
type TransactionEditQueryDatabase = Pick<DataSession, 'transactions'>;

interface TransactionIdentity {
  platformKey: string;
  txFingerprint: string;
}

interface TransactionUserNoteSetParams {
  message: string;
  profileId: number;
  profileKey: string;
  reason?: string | undefined;
  transactionId: number;
}

interface TransactionUserNoteClearParams {
  profileId: number;
  profileKey: string;
  reason?: string | undefined;
  transactionId: number;
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

export class TransactionsEditHandler {
  constructor(
    private readonly db: TransactionEditQueryDatabase,
    private readonly overrideStore: TransactionEditOverrideStore
  ) {}

  async setNote(params: TransactionUserNoteSetParams): Promise<Result<TransactionUserNoteEditResult, Error>> {
    const identityResult = await this.resolveTransactionIdentity(params.transactionId, params.profileId);
    if (identityResult.isErr()) {
      return err(identityResult.error);
    }

    const userNoteOverridesResult = await readTransactionUserNoteOverrides(this.overrideStore, params.profileKey);
    if (userNoteOverridesResult.isErr()) {
      return err(userNoteOverridesResult.error);
    }

    const existingUserNote = userNoteOverridesResult.value.get(identityResult.value.txFingerprint);
    if (existingUserNote?.message === params.message) {
      return ok({
        action: 'set',
        changed: false,
        note: params.message,
        platformKey: identityResult.value.platformKey,
        reason: params.reason,
        transactionId: params.transactionId,
        txFingerprint: identityResult.value.txFingerprint,
      });
    }

    const appendResult = await this.appendOverride({
      profileKey: params.profileKey,
      scope: 'transaction-user-note',
      payload: {
        type: 'transaction_user_note_override',
        action: 'set',
        tx_fingerprint: identityResult.value.txFingerprint,
        message: params.message,
      },
      reason: params.reason,
    });
    if (appendResult.isErr()) {
      return err(appendResult.error);
    }

    const materializeResult = await this.materializeTransactionUserNote(params.profileKey, params.transactionId);
    if (materializeResult.isErr()) {
      return err(materializeResult.error);
    }

    return ok({
      action: 'set',
      changed: true,
      note: params.message,
      platformKey: identityResult.value.platformKey,
      reason: params.reason,
      transactionId: params.transactionId,
      txFingerprint: identityResult.value.txFingerprint,
    });
  }

  async clearNote(params: TransactionUserNoteClearParams): Promise<Result<TransactionUserNoteEditResult, Error>> {
    const identityResult = await this.resolveTransactionIdentity(params.transactionId, params.profileId);
    if (identityResult.isErr()) {
      return err(identityResult.error);
    }

    const userNoteOverridesResult = await readTransactionUserNoteOverrides(this.overrideStore, params.profileKey);
    if (userNoteOverridesResult.isErr()) {
      return err(userNoteOverridesResult.error);
    }

    if (!userNoteOverridesResult.value.has(identityResult.value.txFingerprint)) {
      return ok({
        action: 'clear',
        changed: false,
        platformKey: identityResult.value.platformKey,
        reason: params.reason,
        transactionId: params.transactionId,
        txFingerprint: identityResult.value.txFingerprint,
      });
    }

    const appendResult = await this.appendOverride({
      profileKey: params.profileKey,
      scope: 'transaction-user-note',
      payload: {
        type: 'transaction_user_note_override',
        action: 'clear',
        tx_fingerprint: identityResult.value.txFingerprint,
      },
      reason: params.reason,
    });
    if (appendResult.isErr()) {
      return err(appendResult.error);
    }

    const materializeResult = await this.materializeTransactionUserNote(params.profileKey, params.transactionId);
    if (materializeResult.isErr()) {
      return err(materializeResult.error);
    }

    return ok({
      action: 'clear',
      changed: true,
      platformKey: identityResult.value.platformKey,
      reason: params.reason,
      transactionId: params.transactionId,
      txFingerprint: identityResult.value.txFingerprint,
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

  private async resolveTransactionIdentity(
    transactionId: number,
    profileId: number
  ): Promise<Result<TransactionIdentity, Error>> {
    const transactionResult = await this.db.transactions.findById(transactionId, profileId);
    if (transactionResult.isErr()) {
      return err(new Error(`Failed to load transaction ${transactionId}: ${transactionResult.error.message}`));
    }

    const transaction = transactionResult.value;
    if (!transaction) {
      return err(new Error(`Transaction not found: ${transactionId}`));
    }

    return ok({
      platformKey: transaction.platformKey,
      txFingerprint: transaction.txFingerprint,
    });
  }
}
