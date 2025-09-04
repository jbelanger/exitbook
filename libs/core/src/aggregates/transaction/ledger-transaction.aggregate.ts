import { AggregateRoot } from '@nestjs/cqrs';
import { Result, err, ok } from 'neverthrow';

import { Entry } from './entry.entity';
import {
  EmptyTransactionError,
  TransactionFinalizedError,
  TransactionValidationError,
  UnbalancedTransactionError,
} from './transaction.errors';

/**
 * Currency lookup function for transaction validation
 */
export type CurrencyLookup = (ticker: string) => Promise<{ id: number; ticker: string } | null>;

/**
 * Data required to create a LedgerTransaction
 */
export interface CreateLedgerTransactionData {
  description: string;
  externalId: string;
  metadata?: Record<string, unknown>;
  source: string;
  userId: string;
}

/**
 * Transaction states
 */
export enum TransactionState {
  DRAFT = 'DRAFT',
  FINALIZED = 'FINALIZED',
}

/**
 * LedgerTransaction Aggregate Root
 *
 * Core business rules:
 * - Must have at least one entry
 * - Sum of all entries per currency must equal zero (double-entry principle)
 * - Cannot modify finalized transactions
 * - externalId must be unique per user/source combination
 */
export class LedgerTransaction extends AggregateRoot {
  /**
   * Factory method to create a new LedgerTransaction
   */
  static create(data: CreateLedgerTransactionData): Result<LedgerTransaction, TransactionValidationError> {
    // Validate required fields
    if (!data.userId?.trim()) {
      return err(new TransactionValidationError('userId is required'));
    }

    if (!data.externalId?.trim()) {
      return err(new TransactionValidationError('externalId is required'));
    }

    if (!data.source?.trim()) {
      return err(new TransactionValidationError('source is required'));
    }

    if (!data.description?.trim()) {
      return err(new TransactionValidationError('description is required'));
    }

    const now = new Date();
    const transaction = new LedgerTransaction(
      undefined, // ID will be set by repository
      data.userId.trim(),
      data.externalId.trim(),
      data.source.trim(),
      data.description.trim(),
      [], // Start with empty entries
      TransactionState.DRAFT,
      data.metadata || {},
      now,
      now
    );

    return ok(transaction);
  }

  /**
   * Factory method to reconstitute LedgerTransaction from database data
   */
  static reconstitute(
    id: number,
    userId: string,
    externalId: string,
    source: string,
    description: string,
    entries: Entry[],
    state: TransactionState,
    metadata: Record<string, unknown>,
    createdAt: Date,
    updatedAt: Date
  ): LedgerTransaction {
    return new LedgerTransaction(
      id,
      userId,
      externalId,
      source,
      description,
      entries,
      state,
      metadata,
      createdAt,
      updatedAt
    );
  }

  private constructor(
    private readonly _id: number | undefined,
    private readonly _userId: string,
    private readonly _externalId: string,
    private readonly _source: string,
    private readonly _description: string,
    private readonly _entries: Entry[],
    private _state: TransactionState,
    private readonly _metadata: Record<string, unknown>,
    private readonly _createdAt: Date,
    private readonly _updatedAt: Date
  ) {
    super();
  }

  /**
   * Add an entry to the transaction
   */
  addEntry(entry: Entry): Result<void, TransactionFinalizedError> {
    if (this._state === TransactionState.FINALIZED) {
      return err(new TransactionFinalizedError(this._id!));
    }

    this._entries.push(entry);
    return ok();
  }

  /**
   * Remove an entry from the transaction
   */
  removeEntry(entryIndex: number): Result<void, TransactionFinalizedError> {
    if (this._state === TransactionState.FINALIZED) {
      return err(new TransactionFinalizedError(this._id!));
    }

    if (entryIndex >= 0 && entryIndex < this._entries.length) {
      this._entries.splice(entryIndex, 1);
    }

    return ok();
  }

  /**
   * Finalize the transaction (validate and lock)
   */
  async finalize(
    currencyLookup: CurrencyLookup
  ): Promise<Result<void, EmptyTransactionError | UnbalancedTransactionError | TransactionFinalizedError>> {
    if (this._state === TransactionState.FINALIZED) {
      return err(new TransactionFinalizedError(this._id!));
    }

    // Must have at least one entry
    if (this._entries.length === 0) {
      return err(new EmptyTransactionError());
    }

    // Validate balance
    const balanceResult = await this.validateBalance(currencyLookup);
    if (balanceResult.isErr()) {
      return err(balanceResult.error);
    }

    this._state = TransactionState.FINALIZED;
    return ok();
  }

  // Getters
  get id(): number | undefined {
    return this._id;
  }

  get userId(): string {
    return this._userId;
  }

  get externalId(): string {
    return this._externalId;
  }

  get source(): string {
    return this._source;
  }

  get description(): string {
    return this._description;
  }

  get entries(): readonly Entry[] {
    return [...this._entries];
  }

  get state(): TransactionState {
    return this._state;
  }

  get metadata(): Record<string, unknown> {
    return { ...this._metadata };
  }

  get createdAt(): Date {
    return this._createdAt;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  /**
   * Check if transaction is balanced (synchronous check without currency lookup)
   * For full validation with currency IDs, use finalize() method
   */
  isBalanced(): boolean {
    const currencyTotals = new Map<string, bigint>();

    // Sum entries by currency
    for (const entry of this._entries) {
      const currency = entry.amount.currency;
      const currentTotal = currencyTotals.get(currency) || 0n;
      currencyTotals.set(currency, currentTotal + entry.amount.value);
    }

    // Check if all currencies sum to zero
    for (const total of currencyTotals.values()) {
      if (total !== 0n) {
        return false;
      }
    }

    return true;
  }

  /**
   * Check if transaction is finalized
   */
  isFinalized(): boolean {
    return this._state === TransactionState.FINALIZED;
  }

  /**
   * Get total entries count
   */
  getEntryCount(): number {
    return this._entries.length;
  }

  /**
   * Get entries for a specific currency
   */
  getEntriesForCurrency(currency: string): Entry[] {
    return this._entries.filter(entry => entry.amount.currency === currency);
  }

  /**
   * Returns the state for persistence
   */
  getState() {
    return {
      createdAt: this._createdAt,
      description: this._description,
      entries: this._entries.map(entry => entry.getState()),
      externalId: this._externalId,
      id: this._id,
      metadata: this._metadata,
      source: this._source,
      state: this._state,
      updatedAt: this._updatedAt,
      userId: this._userId,
    };
  }

  /**
   * Required by AggregateRoot for event sourcing
   */
  getId(): number | string | undefined {
    return this._id;
  }

  /**
   * Validate that entries balance for each currency (double-entry principle)
   */
  private async validateBalance(currencyLookup: CurrencyLookup): Promise<Result<void, UnbalancedTransactionError>> {
    const currencyTotals = new Map<string, bigint>();

    // Sum entries by currency
    for (const entry of this._entries) {
      const currency = entry.amount.currency;
      const currentTotal = currencyTotals.get(currency) || 0n;
      currencyTotals.set(currency, currentTotal + entry.amount.value);
    }

    // Check for unbalanced currencies and lookup currency IDs
    const unbalancedCurrencies: Array<{ currencyId: number; delta: string; ticker: string }> = [];

    for (const [currencyTicker, total] of currencyTotals.entries()) {
      if (total !== 0n) {
        const currencyInfo = await currencyLookup(currencyTicker);
        unbalancedCurrencies.push({
          currencyId: currencyInfo?.id || 0, // 0 indicates currency not found
          delta: total.toString(),
          ticker: currencyTicker,
        });
      }
    }

    if (unbalancedCurrencies.length > 0) {
      return err(new UnbalancedTransactionError(unbalancedCurrencies));
    }

    return ok();
  }
}
