import { AggregateRoot } from '@nestjs/cqrs';
import { Result, err, ok } from 'neverthrow';

import { InvalidFormatError, RequiredFieldError } from '../../errors/domain-errors';
import { validateEnumValue, validateRequiredString } from '../../validation/validator';

/**
 * Account types in the double-entry ledger system (granular from database schema)
 */
export enum AccountType {
  ASSET_DEFI_LP = 'ASSET_DEFI_LP',
  ASSET_EXCHANGE = 'ASSET_EXCHANGE',
  ASSET_WALLET = 'ASSET_WALLET',
  EQUITY_MANUAL_ADJUSTMENT = 'EQUITY_MANUAL_ADJUSTMENT',
  EQUITY_OPENING_BALANCE = 'EQUITY_OPENING_BALANCE',
  EXPENSE_FEES_GAS = 'EXPENSE_FEES_GAS',
  EXPENSE_FEES_TRADE = 'EXPENSE_FEES_TRADE',
  INCOME_AIRDROP = 'INCOME_AIRDROP',
  INCOME_MINING = 'INCOME_MINING',
  INCOME_STAKING = 'INCOME_STAKING',
  INCOME_TRADING = 'INCOME_TRADING',
  LIABILITY_LOAN = 'LIABILITY_LOAN',
}

/**
 * Data required to create an Account
 */
export interface CreateAccountData {
  currencyTicker: string;
  identifier?: string;
  metadata?: Record<string, unknown>;
  name: string;
  source: string;
  type: AccountType;
  userId: string;
}

/**
 * Account Aggregate Root
 *
 * Represents a ledger account for a specific currency and source.
 * In double-entry accounting, accounts are first-class citizens that
 * can be referenced by transactions and owned by users.
 *
 * Domain Rules:
 * - Account name cannot be empty
 * - Currency ticker must be valid
 * - Source must be specified
 * - Each user can have only one account per currency/source combination
 * - Account type determines double-entry accounting behavior
 */
export class Account extends AggregateRoot {
  /**
   * Factory method to create a new Account with validation
   */
  static create(data: CreateAccountData): Result<Account, RequiredFieldError | InvalidFormatError> {
    // Validate required fields using domain validators
    const userIdResult = validateRequiredString(data.userId, 'userId');
    if (userIdResult.isErr()) {
      return err(userIdResult.error);
    }

    const nameResult = validateRequiredString(data.name, 'name');
    if (nameResult.isErr()) {
      return err(nameResult.error);
    }

    const currencyResult = validateRequiredString(data.currencyTicker, 'currencyTicker');
    if (currencyResult.isErr()) {
      return err(currencyResult.error);
    }

    const sourceResult = validateRequiredString(data.source, 'source');
    if (sourceResult.isErr()) {
      return err(sourceResult.error);
    }

    // Validate account type using enum validator
    const typeResult = validateEnumValue(data.type, Object.values(AccountType), 'type');
    if (typeResult.isErr()) {
      return err(typeResult.error);
    }

    const now = new Date();
    const account = new Account(
      undefined, // ID will be set by repository
      userIdResult.value,
      nameResult.value,
      typeResult.value,
      currencyResult.value.toUpperCase(),
      sourceResult.value,
      data.identifier?.trim() || '',
      data.metadata || {},
      now,
      now
    );

    return ok(account);
  }

  /**
   * Statically calculate the unique key for any currency/source pair
   * This is the single source of truth for account unique key generation
   */
  static calculateUniqueKey(currencyTicker: string, source: string): string {
    return `${currencyTicker.toUpperCase()}-${source}`;
  }

  /**
   * Factory method to reconstitute Account from database data
   */
  static reconstitute(
    id: number,
    userId: string,
    name: string,
    type: AccountType,
    currencyTicker: string,
    source: string,
    identifier: string,
    metadata: Record<string, unknown>,
    createdAt: Date,
    updatedAt: Date
  ): Account {
    return new Account(id, userId, name, type, currencyTicker, source, identifier, metadata, createdAt, updatedAt);
  }
  private constructor(
    private readonly _id: number | undefined,
    private readonly _userId: string,
    private readonly _name: string,
    private readonly _type: AccountType,
    private readonly _currencyTicker: string,
    private readonly _source: string,
    private readonly _identifier: string,
    private readonly _metadata: Record<string, unknown>,
    private readonly _createdAt: Date,
    private readonly _updatedAt: Date
  ) {
    super();
  }
  // Getters
  get id(): number | undefined {
    return this._id;
  }

  get userId(): string {
    return this._userId;
  }

  get name(): string {
    return this._name;
  }

  get type(): AccountType {
    return this._type;
  }

  get currencyTicker(): string {
    return this._currencyTicker;
  }

  get source(): string {
    return this._source;
  }

  get identifier(): string {
    return this._identifier;
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
   * Check if this is an asset account (any asset type)
   */
  isAsset(): boolean {
    return (
      this._type === AccountType.ASSET_WALLET ||
      this._type === AccountType.ASSET_EXCHANGE ||
      this._type === AccountType.ASSET_DEFI_LP
    );
  }

  /**
   * Check if this is a liability account
   */
  isLiability(): boolean {
    return this._type === AccountType.LIABILITY_LOAN;
  }

  /**
   * Check if this is an equity account
   */
  isEquity(): boolean {
    return this._type === AccountType.EQUITY_OPENING_BALANCE || this._type === AccountType.EQUITY_MANUAL_ADJUSTMENT;
  }

  /**
   * Check if this is an income account (any income type)
   */
  isIncome(): boolean {
    return (
      this._type === AccountType.INCOME_STAKING ||
      this._type === AccountType.INCOME_TRADING ||
      this._type === AccountType.INCOME_AIRDROP ||
      this._type === AccountType.INCOME_MINING
    );
  }

  /**
   * Check if this is an expense account (any expense type)
   */
  isExpense(): boolean {
    return this._type === AccountType.EXPENSE_FEES_GAS || this._type === AccountType.EXPENSE_FEES_TRADE;
  }

  /**
   * Get the broad category of this account type
   */
  getBroadCategory(): 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE' {
    if (this.isAsset()) return 'ASSET';
    if (this.isLiability()) return 'LIABILITY';
    if (this.isEquity()) return 'EQUITY';
    if (this.isIncome()) return 'INCOME';
    if (this.isExpense()) return 'EXPENSE';
    throw new Error(`Unknown account type category for: ${this._type}`);
  }

  /**
   * Get unique identifier for this account (currency + source combination)
   */
  getUniqueKey(): string {
    return Account.calculateUniqueKey(this._currencyTicker, this._source);
  }

  /**
   * Check if account matches currency and source
   */
  matches(currencyTicker: string, source: string): boolean {
    return this._currencyTicker === currencyTicker.toUpperCase() && this._source === source;
  }

  /**
   * Returns the state for persistence
   */
  getState() {
    return {
      createdAt: this._createdAt,
      currencyTicker: this._currencyTicker,
      id: this._id,
      identifier: this._identifier,
      metadata: this._metadata,
      name: this._name,
      source: this._source,
      type: this._type,
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
}
