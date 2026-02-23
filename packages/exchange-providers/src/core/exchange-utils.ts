// Pure exchange utility functions
// All functions are pure - no side effects

import { wrapError } from '@exitbook/core';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';
import { type ZodType } from 'zod';

/**
 * Validate credentials against a Zod schema
 */
export function validateCredentials<T>(schema: ZodType<T>, credentials: unknown, exchangeId: string): Result<T, Error> {
  const validationResult = schema.safeParse(credentials);
  if (!validationResult.success) {
    return err(new Error(`Invalid ${exchangeId} credentials: ${validationResult.error.message}`));
  }
  return ok(validationResult.data);
}

/**
 * Validate raw data against a Zod schema
 */
export function validateRawData<T>(schema: ZodType<T>, rawData: unknown, exchangeId: string): Result<T, Error> {
  try {
    const parsed = schema.parse(rawData);
    return ok(parsed);
  } catch (error) {
    return wrapError(error, `${exchangeId} data validation failed`);
  }
}

/**
 * Process CCXT balance response into balance record
 * Filters out CCXT metadata fields and skips zero balances
 *
 * @param ccxtBalance - Raw balance object from CCXT
 * @param normalizeAsset - Optional function to normalize asset symbols
 * @returns Balance record mapping currency to total balance string
 */
export function processCCXTBalance(
  ccxtBalance: Record<string, unknown>,
  normalizeAsset?: (assetSymbol: string) => string
): Record<string, string> {
  const balances: Record<string, string> = {};
  const normalize = normalizeAsset ?? ((assetSymbol: string) => assetSymbol);

  for (const [currency, amounts] of Object.entries(ccxtBalance)) {
    if (currency === 'info' || currency === 'timestamp' || currency === 'datetime') {
      continue;
    }

    const total = (amounts as { total?: number }).total ?? 0;
    if (total !== 0) {
      balances[normalize(currency)] = total.toString();
    }
  }

  return balances;
}
