import type { DataSession } from '@exitbook/data/session';
import type { Result } from '@exitbook/foundation';
import { resultDoAsync } from '@exitbook/foundation';

export type AddressOwnership = 'owned' | 'other-profile' | 'unknown';

export interface AddressOwnershipLookup {
  otherProfileIdentifiers: ReadonlySet<string>;
  ownedIdentifiers: ReadonlySet<string>;
}

export function createAddressOwnershipLookup(params: {
  otherProfileIdentifiers?: Iterable<string> | undefined;
  ownedIdentifiers?: Iterable<string> | undefined;
}): AddressOwnershipLookup {
  return {
    otherProfileIdentifiers: new Set(params.otherProfileIdentifiers ?? []),
    ownedIdentifiers: new Set(params.ownedIdentifiers ?? []),
  };
}

export async function loadAddressOwnershipLookup(
  database: DataSession,
  activeProfileId: number
): Promise<Result<AddressOwnershipLookup, Error>> {
  return resultDoAsync(async function* () {
    const accounts = yield* await database.accounts.findAll();
    const ownedIdentifiers = new Set<string>();
    const otherProfileIdentifiers = new Set<string>();

    for (const account of accounts) {
      if (account.profileId === activeProfileId) {
        ownedIdentifiers.add(account.identifier);
        continue;
      }

      otherProfileIdentifiers.add(account.identifier);
    }

    return createAddressOwnershipLookup({
      ownedIdentifiers,
      otherProfileIdentifiers,
    });
  });
}

export function resolveAddressOwnership(
  endpoint: string | undefined,
  ownershipLookup: AddressOwnershipLookup
): AddressOwnership | undefined {
  if (endpoint === undefined) {
    return undefined;
  }

  if (ownershipLookup.ownedIdentifiers.has(endpoint)) {
    return 'owned';
  }

  if (ownershipLookup.otherProfileIdentifiers.has(endpoint)) {
    return 'other-profile';
  }

  return 'unknown';
}
