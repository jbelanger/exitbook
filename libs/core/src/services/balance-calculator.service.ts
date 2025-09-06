import { ResultAsync, err, fromPromise, ok } from 'neverthrow';

import { Account } from '../aggregates/account/account.aggregate';
import { LedgerTransaction } from '../aggregates/transaction/ledger-transaction.aggregate';
import { DomainError } from '../errors/domain-errors';
import { IAccountRepository } from '../repositories/account.repository.interface';
import { ITransactionRepository } from '../repositories/transaction.repository.interface';
import { Money } from '../value-objects/money/money.vo';

/**
 * Balance calculation result for a single currency
 */
export interface CurrencyBalance {
  accountId: number;
  accountName: string;
  accountType: string;
  balance: Money;
  currencyTicker: string;
  source: string;
}

/**
 * Portfolio balance summary
 */
export interface PortfolioBalance {
  balances: CurrencyBalance[];
  lastCalculated: Date;
  totalAccounts: number;
  userId: string;
}

/**
 * Account balance calculation error
 */
export class BalanceCalculationError extends DomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'BALANCE_CALCULATION_ERROR', details);
  }
}

/**
 * Balance Calculator Domain Service
 *
 * Implements cross-aggregate balance calculations that don't belong
 * to a single aggregate root. This is a pure domain service that
 * coordinates between Transaction and Account aggregates.
 *
 * Key responsibilities:
 * - Calculate account balances by summing transaction entries
 * - Provide portfolio-level balance views
 * - Validate double-entry balance integrity
 * - Support multi-currency balance reporting
 */
export class BalanceCalculatorService {
  constructor(
    private readonly transactionRepository: ITransactionRepository,
    private readonly accountRepository: IAccountRepository
  ) {}

  /**
   * Calculate balance for a specific account
   * Sums all transaction entries that reference this account
   *
   * @param userId - User context for data isolation
   * @param accountId - Account to calculate balance for
   * @returns ResultAsync<CurrencyBalance, DomainError> - Account balance or error
   */
  calculateAccountBalance(userId: string, accountId: number): ResultAsync<CurrencyBalance, DomainError> {
    return this.accountRepository.findById(userId, accountId).andThen(account => {
      if (!account) {
        return fromPromise(
          Promise.reject(new BalanceCalculationError(`Account ${accountId} not found for user ${userId}`)),
          (error: unknown) =>
            error instanceof DomainError
              ? error
              : new BalanceCalculationError(`Account ${accountId} not found for user ${userId}`)
        );
      }

      // Get all transactions for user (in production, this would be optimized with account-specific queries)
      return this.transactionRepository
        .findBySource(userId, account.source)
        .map(transactions => this.sumAccountEntriesFromTransactions(account, transactions));
    });
  }

  /**
   * Calculate balances for all user accounts
   * Provides a complete portfolio view
   *
   * @param userId - User context for data isolation
   * @returns ResultAsync<PortfolioBalance, DomainError> - Complete portfolio balance
   */
  calculatePortfolioBalance(userId: string): ResultAsync<PortfolioBalance, DomainError> {
    return this.accountRepository.findByUser(userId).andThen(accounts => {
      if (accounts.length === 0) {
        return fromPromise(
          Promise.resolve({
            balances: [],
            lastCalculated: new Date(),
            totalAccounts: 0,
            userId,
          }),
          () => new BalanceCalculationError('Failed to create empty portfolio balance')
        );
      }

      // Calculate balance for each account
      const balancePromises = accounts.map(account => this.calculateAccountBalanceFromAccount(userId, account));

      return fromPromise(
        Promise.all(
          balancePromises.map(promise =>
            promise.match(
              balance => balance,
              error => {
                throw error;
              } // Convert to exception for Promise.all
            )
          )
        ),
        (error: unknown) =>
          error instanceof DomainError
            ? error
            : new BalanceCalculationError('Failed to calculate portfolio balance', { error })
      ).map(balances => ({
        balances,
        lastCalculated: new Date(),
        totalAccounts: accounts.length,
        userId,
      }));
    });
  }

  /**
   * Validate that all transactions in the system maintain double-entry balance
   * Used for system integrity checks and auditing
   *
   * @param userId - User context for data isolation
   * @returns ResultAsync<boolean, DomainError> - True if all transactions are balanced
   */
  validateSystemBalance(userId: string): ResultAsync<boolean, DomainError> {
    return this.transactionRepository
      .findBySource(userId, '') // Empty string to get all sources - implementation dependent
      .map(transactions => {
        // Check each transaction individually
        for (const transaction of transactions) {
          if (!transaction.isBalanced()) {
            return false;
          }
        }
        return true;
      });
  }

  /**
   * Calculate total value by currency across all accounts
   * Useful for tax reporting and net worth calculations
   *
   * @param userId - User context for data isolation
   * @param currencyTicker - Currency to calculate total for
   * @returns ResultAsync<Money, DomainError> - Total value in currency
   */
  calculateCurrencyTotal(userId: string, currencyTicker: string): ResultAsync<Money, DomainError> {
    return this.accountRepository.findByCurrency(userId, currencyTicker).andThen(accounts => {
      if (accounts.length === 0) {
        // Create zero money with appropriate scale (8 for most cryptos, 2 for fiat)
        const scale = this.getCurrencyScale(currencyTicker);
        const zeroResult = Money.fromDecimal('0', currencyTicker, scale);
        return fromPromise(
          Promise.resolve(zeroResult),
          () => new BalanceCalculationError(`Failed to create zero balance for ${currencyTicker}`)
        ).andThen(result => {
          if (result.isErr()) {
            return err(new BalanceCalculationError(`Failed to create zero balance for ${currencyTicker}`));
          }
          return ok(result.value);
        });
      }

      // Calculate balance for each account and sum them
      const balancePromises = accounts.map(account => this.calculateAccountBalanceFromAccount(userId, account));

      return fromPromise(
        Promise.all(
          balancePromises.map(promise =>
            promise.match(
              balance => balance.balance,
              error => {
                throw error;
              }
            )
          )
        ),
        (error: unknown) =>
          error instanceof DomainError
            ? error
            : new BalanceCalculationError('Failed to calculate currency total', { error })
      ).andThen(balances => {
        // Sum all balances (they should all be the same currency)
        let total = balances[0];
        for (let index = 1; index < balances.length; index++) {
          const addResult = total.add(balances[index]);
          if (addResult.isErr()) {
            return err(
              new BalanceCalculationError('Failed to sum currency balances', {
                error: addResult.error,
              })
            );
          }
          total = addResult.value;
        }
        return ok(total);
      });
    });
  }

  /**
   * Private helper to calculate balance from account and transactions
   */
  private calculateAccountBalanceFromAccount(
    userId: string,
    account: Account
  ): ResultAsync<CurrencyBalance, DomainError> {
    return this.transactionRepository
      .findBySource(userId, account.source!)
      .map(transactions => this.sumAccountEntriesFromTransactions(account, transactions));
  }

  /**
   * Private helper to sum entries for a specific account from transaction list
   */
  private sumAccountEntriesFromTransactions(account: Account, transactions: LedgerTransaction[]): CurrencyBalance {
    let totalValue = 0n;

    // Sum all entries that reference this account
    for (const transaction of transactions) {
      for (const entry of transaction.entries) {
        // In a real implementation, entries would have accountId references
        // For now, we match by currency (simplified)
        if (entry.amount.currency === account.currencyTicker) {
          totalValue += entry.amount.value;
        }
      }
    }

    // Create Money object from the calculated total
    const scale = this.getCurrencyScale(account.currencyTicker);
    const balanceResult = Money.fromBigInt(totalValue, account.currencyTicker, scale);

    return {
      accountId: account.id!,
      accountName: account.name,
      accountType: account.type,
      balance: balanceResult.isOk()
        ? balanceResult.value
        : Money.fromDecimal('0', account.currencyTicker, scale).unwrapOr(
            Money.fromBigInt(0n, account.currencyTicker, scale).unwrapOr(
              Money.fromDecimal('0', 'USD', 2)._unsafeUnwrap() // Fallback
            )
          ),
      currencyTicker: account.currencyTicker,
      source: account.source,
    };
  }

  /**
   * Get appropriate decimal scale for currency
   * This would typically come from a currency service
   */
  private getCurrencyScale(currencyTicker: string): number {
    const crypto8Decimals = ['BTC', 'ETH', 'LTC', 'BCH'];
    const fiat2Decimals = ['USD', 'EUR', 'GBP', 'JPY'];

    if (crypto8Decimals.includes(currencyTicker.toUpperCase())) {
      return 8;
    }
    if (fiat2Decimals.includes(currencyTicker.toUpperCase())) {
      return 2;
    }

    // Default to 8 decimals for unknown cryptocurrencies
    return 8;
  }
}
