import { Result, err, ok } from 'neverthrow';

import { Money } from '../../value-objects/money/money.vo';

import { EntryCurrencyMismatchError, ZeroAmountEntryError } from './entry.errors';

/**
 * Data required to create an Entry
 */
export interface CreateEntryData {
  accountId: number;
  amount: Money;
  description?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Entry Entity - Represents a single line item in a double-entry transaction
 *
 * Domain Rules:
 * - Entry amount cannot be zero
 * - Entry must reference a valid account
 * - Entry currency must match account currency (validated at transaction level)
 */
export class Entry {
  /**
   * Factory method to create a new Entry with validation
   */
  static create(data: CreateEntryData): Result<Entry, ZeroAmountEntryError> {
    // Validate amount is not zero
    if (data.amount.isZero()) {
      return err(new ZeroAmountEntryError());
    }

    // Create entry
    const entry = new Entry(
      undefined, // ID will be set by repository
      data.accountId,
      data.amount,
      data.description || '',
      data.metadata || {},
      new Date()
    );

    return ok(entry);
  }

  /**
   * Factory method to reconstitute Entry from database data
   */
  static reconstitute(
    id: number,
    accountId: number,
    amount: Money,
    description: string,
    metadata: Record<string, unknown>,
    createdAt: Date
  ): Entry {
    return new Entry(id, accountId, amount, description, metadata, createdAt);
  }

  private constructor(
    private readonly _id: number | undefined,
    private readonly _accountId: number,
    private readonly _amount: Money,
    private readonly _description: string,
    private readonly _metadata: Record<string, unknown>,
    private readonly _createdAt: Date
  ) {}

  // Getters
  get id(): number | undefined {
    return this._id;
  }

  get accountId(): number {
    return this._accountId;
  }

  get amount(): Money {
    return this._amount;
  }

  get description(): string {
    return this._description;
  }

  get metadata(): Record<string, unknown> {
    return { ...this._metadata };
  }

  get createdAt(): Date {
    return this._createdAt;
  }

  /**
   * Check if this entry is a debit (positive amount)
   */
  isDebit(): boolean {
    return this._amount.isPositive();
  }

  /**
   * Check if this entry is a credit (negative amount)
   */
  isCredit(): boolean {
    return this._amount.isNegative();
  }

  /**
   * Get the absolute amount (always positive)
   */
  getAbsoluteAmount(): Money {
    return this._amount.abs();
  }

  /**
   * Returns the state for persistence
   */
  getState() {
    return {
      accountId: this._accountId,
      amount: this._amount,
      createdAt: this._createdAt,
      description: this._description,
      id: this._id,
      metadata: this._metadata,
    };
  }

  /**
   * Validate entry against account currency
   */
  validateCurrency(expectedCurrency: string): Result<void, EntryCurrencyMismatchError> {
    if (this._amount.currency !== expectedCurrency) {
      return err(new EntryCurrencyMismatchError(expectedCurrency, this._amount.currency));
    }
    return ok();
  }
}
