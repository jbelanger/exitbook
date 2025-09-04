import { AggregateRoot } from '@nestjs/cqrs';
import { Result, err, ok } from 'neverthrow';

import { InvalidFormatError, RequiredFieldError } from '../../errors/domain-errors';
import { validateEmailFormat, validateRequiredString } from '../../validation/validator';
import { Account } from '../account/account.aggregate';
import { AccountNotFoundError, DuplicateAccountError } from '../account/account.errors';

import { InactiveUserError, MaxAccountsExceededError } from './user.errors';

/**
 * User status
 */
export enum UserStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  SUSPENDED = 'SUSPENDED',
}

/**
 * Data required to create a User
 */
export interface CreateUserData {
  email: string;
  id: string; // UUID
  maxAccounts?: number;
  metadata?: Record<string, unknown>;
  status?: UserStatus;
}

/**
 * Account reference for user context
 */
export interface AccountReference {
  currencyTicker: string;
  id: number;
  source: string;
  uniqueKey: string; // currencyTicker-source combination
}

/**
 * User Aggregate Root
 *
 * Manages user context and account references in the multi-tenant system.
 * Following DDD principles, User aggregate references Account aggregates by ID only.
 *
 * Core business rules:
 * - Users can only access their own data
 * - Users have a maximum number of accounts they can create
 * - Only one account per currency/source combination per user
 * - Only active users can perform operations
 */
export class User extends AggregateRoot {
  private static readonly DEFAULT_MAX_ACCOUNTS = 100;

  /**
   * Factory method to create a new User
   */
  static create(data: CreateUserData): Result<User, RequiredFieldError | InvalidFormatError> {
    // Validate required fields using domain validators
    const userIdResult = validateRequiredString(data.id, 'id');
    if (userIdResult.isErr()) {
      return err(userIdResult.error);
    }

    const emailResult = validateEmailFormat(data.email);
    if (emailResult.isErr()) {
      return err(emailResult.error);
    }

    const now = new Date();
    const user = new User(
      userIdResult.value,
      emailResult.value,
      data.status || UserStatus.ACTIVE,
      data.maxAccounts || User.DEFAULT_MAX_ACCOUNTS,
      new Map(),
      data.metadata || {},
      now,
      now
    );

    return ok(user);
  }

  /**
   * Factory method to reconstitute User from database data
   */
  static reconstitute(
    id: string,
    email: string,
    status: UserStatus,
    maxAccounts: number,
    accountReferences: AccountReference[],
    metadata: Record<string, unknown>,
    createdAt: Date,
    updatedAt: Date
  ): User {
    const accountReferencesMap = new Map<string, AccountReference>();
    for (const ref of accountReferences) {
      accountReferencesMap.set(ref.uniqueKey, ref);
    }

    return new User(id, email, status, maxAccounts, accountReferencesMap, metadata, createdAt, updatedAt);
  }

  private constructor(
    private readonly _id: string,
    private readonly _email: string,
    private _status: UserStatus,
    private readonly _maxAccounts: number,
    private readonly _accountReferences: Map<string, AccountReference>,
    private readonly _metadata: Record<string, unknown>,
    private readonly _createdAt: Date,
    private _updatedAt: Date
  ) {
    super();
  }
  /**
   * Register an account reference for this user
   * (Account creation happens in Account aggregate, this just tracks the reference)
   */
  addAccountReference(
    accountReference: Omit<AccountReference, 'uniqueKey'>
  ): Result<void, InactiveUserError | MaxAccountsExceededError | DuplicateAccountError> {
    // Check if user is active
    if (this._status !== UserStatus.ACTIVE) {
      return err(new InactiveUserError(this._id));
    }

    // Check account limit
    if (this._accountReferences.size >= this._maxAccounts) {
      return err(new MaxAccountsExceededError(this._id, this._maxAccounts, this._accountReferences.size));
    }

    // Check for duplicate
    const uniqueKey = Account.calculateUniqueKey(accountReference.currencyTicker, accountReference.source);
    if (this._accountReferences.has(uniqueKey)) {
      return err(new DuplicateAccountError(this._id, accountReference.currencyTicker, accountReference.source));
    }

    // Add account reference
    const fullAccountReference: AccountReference = {
      ...accountReference,
      currencyTicker: accountReference.currencyTicker.toUpperCase(),
      uniqueKey,
    };

    this._accountReferences.set(uniqueKey, fullAccountReference);
    this._updatedAt = new Date();

    return ok();
  }

  /**
   * Find account reference by currency and source
   */
  findAccountReference(
    currencyTicker: string,
    source: string
  ): Result<AccountReference | undefined, InactiveUserError> {
    if (this._status !== UserStatus.ACTIVE) {
      return err(new InactiveUserError(this._id));
    }

    const uniqueKey = Account.calculateUniqueKey(currencyTicker, source);
    const accountReference = this._accountReferences.get(uniqueKey);
    return ok(accountReference || undefined);
  }

  /**
   * Get account reference by ID
   */
  getAccountReference(accountId: number): Result<AccountReference, InactiveUserError | AccountNotFoundError> {
    if (this._status !== UserStatus.ACTIVE) {
      return err(new InactiveUserError(this._id));
    }

    const accountReference = Array.from(this._accountReferences.values()).find(ref => ref.id === accountId);
    if (!accountReference) {
      return err(new AccountNotFoundError(this._id, accountId));
    }

    return ok(accountReference);
  }

  /**
   * Get all account references for this user
   */
  getAccountReferences(): readonly AccountReference[] {
    return Array.from(this._accountReferences.values());
  }

  /**
   * Remove account reference (when account is deleted)
   */
  removeAccountReference(accountId: number): Result<void, InactiveUserError | AccountNotFoundError> {
    if (this._status !== UserStatus.ACTIVE) {
      return err(new InactiveUserError(this._id));
    }

    const accountReference = Array.from(this._accountReferences.values()).find(ref => ref.id === accountId);
    if (!accountReference) {
      return err(new AccountNotFoundError(this._id, accountId));
    }

    this._accountReferences.delete(accountReference.uniqueKey);
    this._updatedAt = new Date();

    return ok();
  }

  /**
   * Get account references by currency
   */
  getAccountReferencesByCurrency(currencyTicker: string): AccountReference[] {
    return this.getAccountReferences().filter(ref => ref.currencyTicker === currencyTicker.toUpperCase());
  }

  /**
   * Deactivate user
   */
  deactivate(): void {
    this._status = UserStatus.INACTIVE;
    this._updatedAt = new Date();
  }

  /**
   * Activate user
   */
  activate(): void {
    this._status = UserStatus.ACTIVE;
    this._updatedAt = new Date();
  }

  /**
   * Suspend user
   */
  suspend(): void {
    this._status = UserStatus.SUSPENDED;
    this._updatedAt = new Date();
  }

  // Getters
  get id(): string {
    return this._id;
  }

  get email(): string {
    return this._email;
  }

  get status(): UserStatus {
    return this._status;
  }

  get maxAccounts(): number {
    return this._maxAccounts;
  }

  get accountCount(): number {
    return this._accountReferences.size;
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
   * Check if user is active
   */
  isActive(): boolean {
    return this._status === UserStatus.ACTIVE;
  }

  /**
   * Check if user can create more accounts
   */
  canCreateAccount(): boolean {
    return this.isActive() && this._accountReferences.size < this._maxAccounts;
  }

  /**
   * Check if user has account for currency/source combination
   */
  hasAccountForCurrencySource(currencyTicker: string, source: string): boolean {
    const uniqueKey = Account.calculateUniqueKey(currencyTicker, source);
    return this._accountReferences.has(uniqueKey);
  }

  /**
   * Returns the state for persistence
   */
  getState() {
    return {
      accountReferences: this.getAccountReferences(),
      createdAt: this._createdAt,
      email: this._email,
      id: this._id,
      maxAccounts: this._maxAccounts,
      metadata: this._metadata,
      status: this._status,
      updatedAt: this._updatedAt,
    };
  }

  /**
   * Required by AggregateRoot for event sourcing
   */
  getId(): string {
    return this._id;
  }
}
