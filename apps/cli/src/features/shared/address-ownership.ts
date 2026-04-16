export type AddressOwnership = 'tracked' | 'untracked';

export function resolveAddressOwnership(
  endpoint: string | undefined,
  trackedIdentifiers: ReadonlySet<string>
): AddressOwnership | undefined {
  if (endpoint === undefined) {
    return undefined;
  }

  return trackedIdentifiers.has(endpoint) ? 'tracked' : 'untracked';
}
