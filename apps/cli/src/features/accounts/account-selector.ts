import { AmbiguousAccountFingerprintRefError, type Account } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/foundation';
import { z } from 'zod';

import { ExitCodes, type ExitCode } from '../../cli/exit-codes.js';

export const ACCOUNT_FINGERPRINT_REF_LENGTH = 10;
export const AccountSelectorValueSchema = z.string().trim().min(1);

export const OptionalBareAccountSelectorSchema = z.object({
  selector: AccountSelectorValueSchema.optional(),
});

export type OptionalBareAccountSelector = z.infer<typeof OptionalBareAccountSelectorSchema>;

interface AccountSelectorService {
  getByFingerprintRef(profileId: number, fingerprintRef: string): Promise<Result<Account | undefined, Error>>;
  getByName(profileId: number, name: string): Promise<Result<Account | undefined, Error>>;
}

export interface ResolvedAccountSelector {
  account: Account;
  kind: 'name' | 'ref';
  value: string;
}

export class AccountSelectorResolutionError extends Error {
  readonly kind: 'ambiguous' | 'missing' | 'not-found';

  constructor(kind: 'ambiguous' | 'missing' | 'not-found', message: string) {
    super(message);
    this.kind = kind;
    this.name = 'AccountSelectorResolutionError';
  }
}

function normalizeAccountSelectorValue(value: string): string {
  return value.trim().toLowerCase();
}

function isSelectorResolutionErrorKind(error: Error, kind: AccountSelectorResolutionError['kind']): boolean {
  return error instanceof AccountSelectorResolutionError && error.kind === kind;
}

function buildResolvedAccountSelector(
  account: Account,
  kind: ResolvedAccountSelector['kind'],
  value: string
): ResolvedAccountSelector {
  return {
    account,
    kind,
    value,
  };
}

async function resolveAccountNameSelector(
  accountService: AccountSelectorService,
  profileId: number,
  accountName: string
): Promise<Result<ResolvedAccountSelector, Error>> {
  const normalizedName = normalizeAccountSelectorValue(accountName);
  const accountResult = await accountService.getByName(profileId, accountName);
  if (accountResult.isErr()) {
    return err(accountResult.error);
  }
  if (!accountResult.value) {
    return err(new AccountSelectorResolutionError('not-found', `Account name '${normalizedName}' not found`));
  }

  return ok(buildResolvedAccountSelector(accountResult.value, 'name', accountResult.value.name ?? normalizedName));
}

async function resolveAccountRefSelector(
  accountService: AccountSelectorService,
  profileId: number,
  accountRef: string
): Promise<Result<ResolvedAccountSelector, Error>> {
  const normalizedRef = normalizeAccountSelectorValue(accountRef);
  const accountResult = await accountService.getByFingerprintRef(profileId, normalizedRef);
  if (accountResult.isErr()) {
    if (accountResult.error instanceof AmbiguousAccountFingerprintRefError) {
      const matchSuffix =
        accountResult.error.matches.length > 0 ? ` Matches include: ${accountResult.error.matches.join(', ')}` : '';
      return err(
        new AccountSelectorResolutionError(
          'ambiguous',
          `Account selector '${normalizedRef}' is ambiguous. Use a longer fingerprint prefix.${matchSuffix}`
        )
      );
    }

    return err(accountResult.error);
  }
  if (!accountResult.value) {
    return err(new AccountSelectorResolutionError('not-found', `Account ref '${normalizedRef}' not found`));
  }

  return ok(buildResolvedAccountSelector(accountResult.value, 'ref', normalizedRef));
}

export function hasAccountSelectorArgument(selector: OptionalBareAccountSelector): boolean {
  return selector.selector !== undefined;
}

export function formatAccountFingerprintRef(accountFingerprint: string): string {
  if (accountFingerprint.length <= ACCOUNT_FINGERPRINT_REF_LENGTH) {
    return accountFingerprint;
  }

  return accountFingerprint.slice(0, ACCOUNT_FINGERPRINT_REF_LENGTH);
}

export function formatAccountSelectorLabel(account: Pick<Account, 'accountFingerprint' | 'name'>): string {
  return account.name ?? formatAccountFingerprintRef(account.accountFingerprint);
}

export function formatResolvedAccountSelectorInput(selector: Pick<ResolvedAccountSelector, 'value'>): string {
  return `Account selector '${selector.value}'`;
}

export function buildAccountSelectorFilters(selector: ResolvedAccountSelector | undefined): {
  account?: string | undefined;
} {
  if (!selector) {
    return {};
  }

  return { account: selector.value };
}

export async function resolveOwnedAccountSelector(
  accountService: AccountSelectorService,
  profileId: number,
  selector: string
): Promise<Result<ResolvedAccountSelector, Error>> {
  const normalizedSelector = normalizeAccountSelectorValue(selector);
  const accountByNameResult = await resolveAccountNameSelector(accountService, profileId, selector);
  if (accountByNameResult.isOk()) {
    return accountByNameResult;
  }
  if (!isSelectorResolutionErrorKind(accountByNameResult.error, 'not-found')) {
    return err(accountByNameResult.error);
  }

  const accountByRefResult = await resolveAccountRefSelector(accountService, profileId, normalizedSelector);
  if (accountByRefResult.isErr() && isSelectorResolutionErrorKind(accountByRefResult.error, 'not-found')) {
    return err(new AccountSelectorResolutionError('not-found', `Account selector '${normalizedSelector}' not found`));
  }

  return accountByRefResult;
}

export async function resolveOwnedOptionalAccountSelector(
  accountService: AccountSelectorService,
  profileId: number,
  selector: string | undefined
): Promise<Result<ResolvedAccountSelector | undefined, Error>> {
  if (!selector) {
    return ok(undefined);
  }

  return resolveOwnedAccountSelector(accountService, profileId, selector);
}

export function getAccountSelectorErrorExitCode(error: Error): ExitCode {
  if (!(error instanceof AccountSelectorResolutionError)) {
    return ExitCodes.GENERAL_ERROR;
  }

  switch (error.kind) {
    case 'not-found':
      return ExitCodes.NOT_FOUND;
    case 'ambiguous':
    case 'missing':
      return ExitCodes.INVALID_ARGS;
  }
}

export async function resolveRequiredOwnedAccountSelector(
  accountService: AccountSelectorService,
  profileId: number,
  selector: string | undefined,
  missingMessage: string
): Promise<Result<ResolvedAccountSelector, Error>> {
  const selectionResult = await resolveOwnedOptionalAccountSelector(accountService, profileId, selector);
  if (selectionResult.isErr()) {
    return err(selectionResult.error);
  }
  if (!selectionResult.value) {
    return err(new AccountSelectorResolutionError('missing', missingMessage));
  }

  return ok(selectionResult.value);
}
