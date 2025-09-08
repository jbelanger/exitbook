import type { CurrencyMismatchError } from '@exitbook/core';
import { Money } from '@exitbook/core';
import { Effect, pipe, Data } from 'effect';

export class UnbalancedEntriesError extends Data.TaggedError('UnbalancedEntriesError')<{
  readonly currency: string;
  readonly difference: Money;
}> {}

export class InvalidAccountCombinationError extends Data.TaggedError(
  'InvalidAccountCombinationError',
)<{
  readonly accountType: string;
  readonly assetType: string;
}> {}

export interface LedgerEntry {
  readonly accountId: string;
  readonly amount: Money;
  readonly direction: 'DEBIT' | 'CREDIT';
  readonly entryType: string;
}

export class LedgerRules {
  static validateBalance(
    entries: readonly LedgerEntry[],
  ): Effect.Effect<void, UnbalancedEntriesError | CurrencyMismatchError> {
    return pipe(
      Effect.succeed(entries),
      Effect.flatMap((entries) => {
        // Group by currency
        const byCurrency = new Map<string, Money>();

        return Effect.forEach(
          entries,
          (entry) => {
            const currency = entry.amount.currency.symbol;
            const current = byCurrency.get(currency) || Money.zero(entry.amount.currency);

            return pipe(
              entry.direction === 'DEBIT'
                ? current.subtract(entry.amount)
                : current.add(entry.amount),
              Effect.map((updated) => {
                byCurrency.set(currency, updated);
                return updated;
              }),
            );
          },
          { concurrency: 'unbounded' },
        ).pipe(
          Effect.flatMap(() => {
            // Check each currency balances to zero
            for (const [currency, balance] of byCurrency) {
              if (!balance.isZero()) {
                return Effect.fail(
                  new UnbalancedEntriesError({
                    currency,
                    difference: balance,
                  }),
                );
              }
            }
            return Effect.void;
          }),
        );
      }),
    );
  }

  static validateAccountTypes(
    entries: readonly LedgerEntry[],
    accountTypes: Map<string, string>,
    assetTypes: Map<string, string>,
  ): Effect.Effect<void, InvalidAccountCombinationError> {
    return Effect.forEach(
      entries,
      (entry) => {
        const accountType = accountTypes.get(entry.accountId);
        const assetType = assetTypes.get(entry.amount.currency.symbol);

        if (!accountType || !assetType) {
          return Effect.void;
        }

        // NFT accounts can only hold NFTs
        if (accountType === 'NFT_WALLET' && assetType !== 'NFT') {
          return Effect.fail(
            new InvalidAccountCombinationError({
              accountType,
              assetType,
            }),
          );
        }

        // LP accounts can only hold LP tokens
        if (accountType === 'DEFI_LP' && assetType !== 'LP_TOKEN') {
          return Effect.fail(
            new InvalidAccountCombinationError({
              accountType,
              assetType,
            }),
          );
        }

        return Effect.void;
      },
      { concurrency: 'unbounded' },
    ).pipe(Effect.asVoid);
  }
}
