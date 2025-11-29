// Pure exchange utility functions
// All functions are pure - no side effects

import { wrapError, type CursorState, type ExternalTransaction } from '@exitbook/core';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';
import { type ZodSchema } from 'zod';

import { PartialImportError } from './errors.js';
import { ExchangeLedgerEntrySchema, type ExchangeLedgerEntry } from './schemas.js';

/**
 * Validate credentials against a Zod schema
 */
export function validateCredentials<T>(
  schema: ZodSchema<T>,
  credentials: unknown,
  exchangeId: string
): Result<T, Error> {
  const validationResult = schema.safeParse(credentials);
  if (!validationResult.success) {
    return err(new Error(`Invalid ${exchangeId} credentials: ${validationResult.error.message}`));
  }
  return ok(validationResult.data);
}

/**
 * Validate raw data against a Zod schema
 */
export function validateRawData<T>(schema: ZodSchema<T>, rawData: unknown, exchangeId: string): Result<T, Error> {
  try {
    const parsed = schema.parse(rawData);
    return ok(parsed);
  } catch (error) {
    return wrapError(error, `${exchangeId} data validation failed`);
  }
}

/**
 * Process a batch of items with validation and metadata extraction
 * This is the pure functional core of ledger/transaction processing
 *
 * @deprecated INTERNAL USE ONLY - Used by Coinbase client until refactored to inline loop pattern.
 * See packages/exchange-providers/src/exchanges/kraken/client.ts for the preferred pattern.
 *
 * This function uses PartialImportError to carry successful items through the error channel,
 * which is an architectural inconsistency. New code should inline the validation loop instead.
 *
 * @param items - Raw items to process
 * @param extractor - Function to extract raw data from each item
 * @param validator - Function to validate extracted data
 * @param metadataMapper - Function to extract cursor, externalId, and rawData from validated item and original item
 * @param exchangeId - Exchange identifier for metadata
 * @returns Result with processed transactions and updated cursor, or PartialImportError
 */
export function processItems<TRaw, TValidated>(
  items: TRaw[],
  extractor: (item: TRaw) => unknown,
  validator: (raw: unknown) => Result<TValidated, Error>,
  metadataMapper: (
    parsed: TValidated,
    item: TRaw
  ) => {
    cursorUpdates: Record<string, CursorState>;
    externalId: string;
    normalizedData: ExchangeLedgerEntry;
  },
  exchangeId: string
): Result<{ cursorUpdates: Record<string, CursorState>; transactions: ExternalTransaction[] }, PartialImportError> {
  const transactions: ExternalTransaction[] = [];
  const lastSuccessfulCursorUpdates: Record<string, CursorState> = {};

  for (const item of items) {
    const rawItem = extractor(item);
    const validationResult = validator(rawItem);

    if (validationResult.isErr()) {
      return err(
        new PartialImportError(
          `Validation failed for item: ${validationResult.error.message}`,
          transactions,
          rawItem,
          lastSuccessfulCursorUpdates
        )
      );
    }

    const validatedData = validationResult.value;
    const { cursorUpdates, externalId, normalizedData } = metadataMapper(validatedData, item);

    // Validate normalized data conforms to ExchangeLedgerEntry schema
    const normalizedValidation = ExchangeLedgerEntrySchema.safeParse(normalizedData);
    if (!normalizedValidation.success) {
      return err(
        new PartialImportError(
          `Normalized data validation failed: ${normalizedValidation.error.message}`,
          transactions,
          normalizedData,
          lastSuccessfulCursorUpdates
        )
      );
    }

    transactions.push({
      externalId,
      providerName: exchangeId,
      rawData: validatedData as unknown,
      normalizedData: normalizedValidation.data as unknown,
    });

    // Merge cursor updates
    Object.assign(lastSuccessfulCursorUpdates, cursorUpdates);
  }

  return ok({ transactions, cursorUpdates: lastSuccessfulCursorUpdates });
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
  normalizeAsset?: (asset: string) => string
): Record<string, string> {
  const balances: Record<string, string> = {};
  const normalize = normalizeAsset ?? ((asset: string) => asset);

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
