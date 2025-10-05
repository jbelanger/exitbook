/**
 * Generic exchange credentials type
 * Each exchange validates its own required fields via Zod schemas
 */
export type ExchangeCredentials = Record<string, string>;
