import type { Account } from '@exitbook/core';

import { maskIdentifier } from '../query/account-query-utils.js';

type CliSerializableAccount = Pick<
  Account,
  'accountFingerprint' | 'accountType' | 'createdAt' | 'id' | 'identifier' | 'name' | 'platformKey' | 'providerName'
>;

export function serializeAccountForCli(account: CliSerializableAccount) {
  return {
    id: account.id,
    accountFingerprint: account.accountFingerprint,
    name: account.name,
    accountType: account.accountType,
    platformKey: account.platformKey,
    identifier: maskIdentifier(account),
    providerName: account.providerName,
    createdAt: account.createdAt.toISOString(),
  };
}
