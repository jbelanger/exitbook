import { v4 as uuidv4 } from 'uuid';

// Simple branded types without Effect's Brand for now
export type UserId = string & { readonly __brand: 'UserId' };
export const UserId = (value: string): UserId => value as UserId;

export type TransactionId = string & { readonly __brand: 'TransactionId' };
export const TransactionId = {
  generate: (): TransactionId => uuidv4() as TransactionId,
  of: (value: string): TransactionId => value as TransactionId,
};

// Base ID generator for creating new ID types
export const createIdType = <T extends string>() => {
  type Id = string & { readonly __brand: T };
  return {
    generate: (): Id => uuidv4() as Id,
    of: (value: string): Id => value as Id,
  };
};
