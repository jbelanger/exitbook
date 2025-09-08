import { v4 as uuidv4 } from 'uuid';

// Trading-specific identifiers
export type AccountId = string & { readonly __brand: 'AccountId' };
export const AccountId = {
  generate: (): AccountId => uuidv4() as AccountId,
  of: (value: string): AccountId => value as AccountId,
};

export type ExternalId = string & { readonly __brand: 'ExternalId' };
export const ExternalId = {
  of: (value: string): ExternalId => value as ExternalId,
};
