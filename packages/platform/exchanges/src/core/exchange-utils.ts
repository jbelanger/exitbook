// Pure exchange utility functions
// All functions are pure - no side effects

import { wrapError, type RawTransactionWithMetadata } from '@exitbook/core';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';
import { type ZodSchema } from 'zod';

import { PartialImportError } from './errors.ts';
import { ExchangeLedgerEntrySchema, type ExchangeLedgerEntry } from './schemas.ts';

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
 * @param items - Raw items to process
 * @param extractor - Function to extract raw data from each item
 * @param validator - Function to validate extracted data
 * @param metadataMapper - Function to extract cursor, externalId, and rawData from validated item
 * @param exchangeId - Exchange identifier for metadata
 * @param currentCursor - Current cursor state for resumption
 * @returns Result with array of processed transactions or PartialImportError
 */
export function processItems<TRaw, TValidated>(
  items: TRaw[],
  extractor: (item: TRaw) => unknown,
  validator: (raw: unknown) => Result<TValidated, Error>,
  metadataMapper: (parsed: TValidated) => {
    cursor: Record<string, number>;
    externalId: string;
    normalizedData: ExchangeLedgerEntry;
  },
  exchangeId: string,
  currentCursor: Record<string, number>
): Result<RawTransactionWithMetadata[], PartialImportError> {
  const transactions: RawTransactionWithMetadata[] = [];
  const lastSuccessfulCursor = { ...currentCursor };

  for (const item of items) {
    const rawItem = extractor(item);
    const validationResult = validator(rawItem);

    if (validationResult.isErr()) {
      return err(
        new PartialImportError(
          `Validation failed for item: ${validationResult.error.message}`,
          transactions,
          rawItem,
          lastSuccessfulCursor
        )
      );
    }

    const validatedData = validationResult.value;
    const { cursor, externalId, normalizedData } = metadataMapper(validatedData);

    // Validate normalized data conforms to ExchangeLedgerEntry schema
    const normalizedValidation = ExchangeLedgerEntrySchema.safeParse(normalizedData);
    if (!normalizedValidation.success) {
      return err(
        new PartialImportError(
          `Normalized data validation failed: ${normalizedValidation.error.message}`,
          transactions,
          normalizedData,
          lastSuccessfulCursor
        )
      );
    }

    transactions.push({
      cursor,
      externalId,
      metadata: {
        providerId: exchangeId,
      },
      rawData: validatedData as unknown,
      normalizedData: normalizedValidation.data as unknown,
    });

    // Update last successful cursor
    Object.assign(lastSuccessfulCursor, cursor);
  }

  return ok(transactions);
}
