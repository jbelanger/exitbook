import { AmbiguousAccountFingerprintRefError, type Account } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/foundation';
import { z } from 'zod';

import { ExitCodes, type ExitCode } from '../../cli/exit-codes.js';

export const ACCOUNT_FINGERPRINT_REF_LENGTH = 10;
export const ACCOUNT_REF_OPTION_ERROR = '--account-ref must be a fingerprint or unique fingerprint prefix';

export const AccountRefOptionSchema = z
  .string()
  .trim()
  .min(1)
  .regex(/^[a-f0-9]+$/i, ACCOUNT_REF_OPTION_ERROR)
  .transform((value) => value.toLowerCase());

export const OptionalAccountSelectorSchema = z
  .object({
    accountName: z.string().trim().min(1).optional(),
    accountRef: AccountRefOptionSchema.optional(),
  })
  .refine((data) => !(data.accountName && data.accountRef), {
    message: 'Cannot specify both --account-name and --account-ref',
  });

export type OptionalAccountSelector = z.infer<typeof OptionalAccountSelectorSchema>;

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
  readonly kind: 'ambiguous' | 'conflict' | 'missing' | 'not-found';

  constructor(kind: 'ambiguous' | 'conflict' | 'missing' | 'not-found', message: string) {
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
      return err(new AccountSelectorResolutionError('ambiguous', accountResult.error.message));
    }

    return err(accountResult.error);
  }
  if (!accountResult.value) {
    return err(new AccountSelectorResolutionError('not-found', `Account ref '${normalizedRef}' not found`));
  }

  return ok(buildResolvedAccountSelector(accountResult.value, 'ref', normalizedRef));
}

export function hasAccountSelector(selector: OptionalAccountSelector): boolean {
  return selector.accountName !== undefined || selector.accountRef !== undefined;
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

export function formatResolvedAccountSelectorInput(selector: Pick<ResolvedAccountSelector, 'kind' | 'value'>): string {
  return selector.kind === 'name' ? `Account name '${selector.value}'` : `Account ref '${selector.value}'`;
}

export function buildAccountSelectorFilters(selector: ResolvedAccountSelector | undefined): OptionalAccountSelector {
  if (!selector) {
    return {};
  }

  return selector.kind === 'name' ? { accountName: selector.value } : { accountRef: selector.value };
}

export async function resolveOwnedBrowseAccountSelector(
  accountService: AccountSelectorService,
  profileId: number,
  accountSelector: string
): Promise<Result<ResolvedAccountSelector, Error>> {
  const normalizedSelector = normalizeAccountSelectorValue(accountSelector);
  const accountByNameResult = await resolveAccountNameSelector(accountService, profileId, accountSelector);
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

export function getAccountSelectorErrorExitCode(error: Error): ExitCode {
  if (!(error instanceof AccountSelectorResolutionError)) {
    return ExitCodes.GENERAL_ERROR;
  }

  switch (error.kind) {
    case 'not-found':
      return ExitCodes.NOT_FOUND;
    case 'ambiguous':
    case 'conflict':
    case 'missing':
      return ExitCodes.INVALID_ARGS;
  }
}

export async function resolveOwnedAccountSelector(
  accountService: AccountSelectorService,
  profileId: number,
  selector: OptionalAccountSelector
): Promise<Result<ResolvedAccountSelector | undefined, Error>> {
  if (selector.accountName && selector.accountRef) {
    return err(new AccountSelectorResolutionError('conflict', 'Cannot specify both --account-name and --account-ref'));
  }

  if (selector.accountName) {
    return resolveAccountNameSelector(accountService, profileId, selector.accountName);
  }

  if (selector.accountRef) {
    return resolveAccountRefSelector(accountService, profileId, selector.accountRef);
  }

  return ok(undefined);
}

export async function resolveRequiredOwnedAccountSelector(
  accountService: AccountSelectorService,
  profileId: number,
  selector: OptionalAccountSelector,
  missingMessage: string
): Promise<Result<ResolvedAccountSelector, Error>> {
  const selectionResult = await resolveOwnedAccountSelector(accountService, profileId, selector);
  if (selectionResult.isErr()) {
    return err(selectionResult.error);
  }
  if (!selectionResult.value) {
    return err(new AccountSelectorResolutionError('missing', missingMessage));
  }

  return ok(selectionResult.value);
}
