import type { Account } from '@exitbook/core';

import { maskIdentifier } from '../query/account-query-utils.js';

type CliSerializableAccount = Pick<
  Account,
  'accountType' | 'createdAt' | 'id' | 'identifier' | 'name' | 'platformKey' | 'providerName'
>;

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
