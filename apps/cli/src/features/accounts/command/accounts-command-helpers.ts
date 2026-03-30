import type { Account } from '@exitbook/core';
import type { Result } from '@exitbook/foundation';

import { CliCommandError } from '../../shared/cli-command-error.js';
import type { ExitCode } from '../../shared/exit-codes.js';
import { maskIdentifier } from '../query/account-query-utils.js';

type CliSerializableAccount = Pick<
  Account,
  'accountType' | 'createdAt' | 'id' | 'identifier' | 'name' | 'platformKey' | 'providerName'
>;

export function requireCliResult<T>(result: Result<T, Error>, exitCode: ExitCode): T {
  if (result.isErr()) {
    if (result.error instanceof CliCommandError) {
      throw result.error;
    }

    throw new CliCommandError(result.error.message, exitCode, { cause: result.error });
  }

  return result.value;
}

export function requireCliValue<T>(value: T | undefined, message: string, exitCode: ExitCode): T {
  if (value === undefined) {
    throw new CliCommandError(message, exitCode);
  }

  return value;
}

export function serializeAccountForCli(account: CliSerializableAccount) {
  return {
    id: account.id,
    name: account.name,
    accountType: account.accountType,
    platformKey: account.platformKey,
    identifier: maskIdentifier(account),
    providerName: account.providerName,
    createdAt: account.createdAt.toISOString(),
  };
}
