import type { CreateOverrideEventOptions } from '@exitbook/core';
import type { DataContext } from '@exitbook/data/context';
import {
  materializeStoredTransactionNoteOverrides,
  readTransactionNoteOverrides,
  type OverrideStore,
} from '@exitbook/data/overrides';
import { err, ok, type Result } from '@exitbook/foundation';

type TransactionEditOverrideStore = Pick<OverrideStore, 'append' | 'exists' | 'readByScopes'>;
type TransactionEditQueryDatabase = Pick<DataContext, 'transactions'>;

interface TransactionIdentity {
  source: string;
  txFingerprint: string;
}

interface TransactionNoteSetParams {
  message: string;
  reason?: string | undefined;
  transactionId: number;
}

interface TransactionNoteClearParams {
  reason?: string | undefined;
  transactionId: number;
}

export interface TransactionNoteEditResult {
  action: 'set' | 'clear';
  changed: boolean;
  note?: string | undefined;
  reason?: string | undefined;
  source: string;
  transactionId: number;
  txFingerprint: string;
}

export class TransactionsEditHandler {
  constructor(
    private readonly db: TransactionEditQueryDatabase,
    private readonly overrideStore: TransactionEditOverrideStore
  ) {}

  async setNote(params: TransactionNoteSetParams): Promise<Result<TransactionNoteEditResult, Error>> {
    const identityResult = await this.resolveTransactionIdentity(params.transactionId);
    if (identityResult.isErr()) {
      return err(identityResult.error);
    }

    const noteOverridesResult = await readTransactionNoteOverrides(this.overrideStore);
    if (noteOverridesResult.isErr()) {
      return err(noteOverridesResult.error);
    }

    const existingNote = noteOverridesResult.value.get(identityResult.value.txFingerprint);
    if (existingNote === params.message) {
      return ok({
        action: 'set',
        changed: false,
        note: params.message,
        reason: params.reason,
        source: identityResult.value.source,
        transactionId: params.transactionId,
        txFingerprint: identityResult.value.txFingerprint,
      });
    }

    const appendResult = await this.appendOverride({
      scope: 'transaction-note',
      payload: {
        type: 'transaction_note_override',
        action: 'set',
        tx_fingerprint: identityResult.value.txFingerprint,
        message: params.message,
      },
      reason: params.reason,
    });
    if (appendResult.isErr()) {
      return err(appendResult.error);
    }

    const materializeResult = await this.materializeTransactionNote(params.transactionId);
    if (materializeResult.isErr()) {
      return err(materializeResult.error);
    }

    return ok({
      action: 'set',
      changed: true,
      note: params.message,
      reason: params.reason,
      source: identityResult.value.source,
      transactionId: params.transactionId,
      txFingerprint: identityResult.value.txFingerprint,
    });
  }

  async clearNote(params: TransactionNoteClearParams): Promise<Result<TransactionNoteEditResult, Error>> {
    const identityResult = await this.resolveTransactionIdentity(params.transactionId);
    if (identityResult.isErr()) {
      return err(identityResult.error);
    }

    const noteOverridesResult = await readTransactionNoteOverrides(this.overrideStore);
    if (noteOverridesResult.isErr()) {
      return err(noteOverridesResult.error);
    }

    if (!noteOverridesResult.value.has(identityResult.value.txFingerprint)) {
      return ok({
        action: 'clear',
        changed: false,
        reason: params.reason,
        source: identityResult.value.source,
        transactionId: params.transactionId,
        txFingerprint: identityResult.value.txFingerprint,
      });
    }

    const appendResult = await this.appendOverride({
      scope: 'transaction-note',
      payload: {
        type: 'transaction_note_override',
        action: 'clear',
        tx_fingerprint: identityResult.value.txFingerprint,
      },
      reason: params.reason,
    });
    if (appendResult.isErr()) {
      return err(appendResult.error);
    }

    const materializeResult = await this.materializeTransactionNote(params.transactionId);
    if (materializeResult.isErr()) {
      return err(materializeResult.error);
    }

    return ok({
      action: 'clear',
      changed: true,
      reason: params.reason,
      source: identityResult.value.source,
      transactionId: params.transactionId,
      txFingerprint: identityResult.value.txFingerprint,
    });
  }

  private async appendOverride(options: CreateOverrideEventOptions): Promise<Result<void, Error>> {
    const appendResult = await this.overrideStore.append(options);
    if (appendResult.isErr()) {
      return err(new Error(`Failed to write transaction note override event: ${appendResult.error.message}`));
    }

    return ok(undefined);
  }

  private async materializeTransactionNote(transactionId: number): Promise<Result<void, Error>> {
    const materializeResult = await materializeStoredTransactionNoteOverrides(
      this.db.transactions,
      this.overrideStore,
      {
        transactionIds: [transactionId],
      }
    );
    if (materializeResult.isErr()) {
      return err(new Error(`Failed to materialize transaction note override: ${materializeResult.error.message}`));
    }

    return ok(undefined);
  }

  private async resolveTransactionIdentity(transactionId: number): Promise<Result<TransactionIdentity, Error>> {
    const transactionResult = await this.db.transactions.findById(transactionId);
    if (transactionResult.isErr()) {
      return err(new Error(`Failed to load transaction ${transactionId}: ${transactionResult.error.message}`));
    }

    const transaction = transactionResult.value;
    if (!transaction) {
      return err(new Error(`Transaction not found: ${transactionId}`));
    }

    return ok({
      source: transaction.source,
      txFingerprint: transaction.txFingerprint,
    });
  }
}
