import type { UserId, TransactionId } from '@exitbook/core';

import type { ExternalId } from '../../core/value-objects/identifiers.vo.js';

/**
 * Import Transaction Command
 */
export interface ImportTransactionCommand {
  readonly externalId: ExternalId;
  readonly rawData: unknown;
  readonly source: string;
  readonly userId: UserId;
}

/**
 * Classify Transaction Command
 */
export interface ClassifyTransactionCommand {
  readonly transactionId: TransactionId;
}

/**
 * Record Entries Command
 */
export interface RecordEntriesCommand {
  readonly entries: readonly {
    readonly accountId: string;
    readonly amount: string | number;
    readonly currency: string;
    readonly currencyName: string;
    readonly decimals: number;
    readonly direction: 'DEBIT' | 'CREDIT';
    readonly entryType: string;
  }[];
  readonly transactionId: TransactionId;
}

/**
 * Reverse Transaction Command
 */
export interface ReverseTransactionCommand {
  readonly reason: string;
  readonly reversedBy: UserId;
  readonly transactionId: TransactionId;
}

/**
 * Command factory functions
 */
export const Commands = {
  classifyTransaction: (transactionId: TransactionId): ClassifyTransactionCommand => ({
    transactionId,
  }),

  importTransaction: (
    externalId: ExternalId,
    rawData: unknown,
    source: string,
    userId: UserId,
  ): ImportTransactionCommand => ({
    externalId,
    rawData,
    source,
    userId,
  }),

  recordEntries: (
    transactionId: TransactionId,
    entries: readonly {
      readonly accountId: string;
      readonly amount: string | number;
      readonly currency: string;
      readonly currencyName: string;
      readonly decimals: number;
      readonly direction: 'DEBIT' | 'CREDIT';
      readonly entryType: string;
    }[],
  ): RecordEntriesCommand => ({
    entries,
    transactionId,
  }),

  reverseTransaction: (
    transactionId: TransactionId,
    reason: string,
    reversedBy: UserId,
  ): ReverseTransactionCommand => ({
    reason,
    reversedBy,
    transactionId,
  }),
} as const;
