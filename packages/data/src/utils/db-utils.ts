import { type RawTransaction, wrapError } from '@exitbook/core';
import { type Logger } from '@exitbook/logger';
import type { ControlledTransaction, Kysely, Selectable } from '@exitbook/sqlite';
import { Decimal } from 'decimal.js';
import { err, ok, type Result } from 'neverthrow';
import type { z } from 'zod';

import type { RawTransactionTable } from '../database-schema.js';

function isDecimalLike(value: unknown): value is { toFixed: () => string } {
  return (
    value !== null &&
    typeof value === 'object' &&
    'd' in value &&
    'e' in value &&
    's' in value &&
    'toFixed' in value &&
    typeof value.toFixed === 'function'
  );
}

/**
 * Serialize data to JSON, converting Decimal values to fixed-point strings.
 */
export function serializeToJson(data: unknown): Result<string | undefined, Error> {
  if (data === undefined || data === null) return ok(undefined);

  try {
    const serialized = JSON.stringify(
      data,
      function replacer(this: Record<string, unknown>, key: string, value: unknown) {
        const holderValue = this[key];

        if (holderValue instanceof Decimal || isDecimalLike(holderValue)) return holderValue.toFixed();
        if (value instanceof Decimal || isDecimalLike(value)) return value.toFixed();

        return value;
      }
    );
    return ok(serialized);
  } catch (error) {
    return err(new Error(`Failed to serialize JSON: ${error instanceof Error ? error.message : String(error)}`));
  }
}

/**
 * Parse a JSON string and validate it against a Zod schema.
 */
export function parseWithSchema<T>(value: unknown, schema: z.ZodType<T>): Result<T | undefined, Error> {
  if (!value) return ok(undefined);

  try {
    const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value;
    const result = schema.safeParse(parsed);

    if (!result.success) {
      return err(new Error(`Schema validation failed: ${result.error.message}`));
    }

    return ok(result.data);
  } catch (error) {
    return err(new Error(`Failed to parse JSON: ${error instanceof Error ? error.message : String(error)}`));
  }
}

/**
 * Execute a Result-returning function within a manually controlled transaction.
 * Rolls back on Result.isErr() or thrown exceptions; commits on Result.isOk().
 */
export async function withControlledTransaction<T, TDB>(
  db: Kysely<TDB>,
  logger: Logger,
  fn: (trx: ControlledTransaction<TDB>) => Promise<Result<T, Error>>,
  errorContext: string
): Promise<Result<T, Error>> {
  let trx: ControlledTransaction<TDB> | undefined;

  try {
    trx = await db.startTransaction().execute();
    const result = await fn(trx);

    if (result.isErr()) {
      await trx.rollback().execute();
      return result;
    }

    await trx.commit().execute();
    return result;
  } catch (error) {
    if (trx) {
      try {
        await trx.rollback().execute();
      } catch (rollbackError) {
        logger.error({ rollbackError }, 'Failed to rollback controlled transaction');
      }
    }
    return wrapError(error, errorContext);
  }
}

/**
 * Parse a JSON string without schema validation.
 */
export function parseJson<T = unknown>(value: unknown): Result<T | undefined, Error> {
  if (!value) return ok(undefined);

  try {
    const parsed = typeof value === 'string' ? (JSON.parse(value) as T) : (value as T);
    return ok(parsed);
  } catch (error) {
    return err(new Error(`Failed to parse JSON: ${error instanceof Error ? error.message : String(error)}`));
  }
}

/**
 * Convert raw_transactions row to RawTransaction domain model.
 */
export function toRawTransaction(row: Selectable<RawTransactionTable>): Result<RawTransaction, Error> {
  const rawDataResult = parseJson<unknown>(row.provider_data);
  const normalizedDataResult = parseJson<unknown>(row.normalized_data);

  if (rawDataResult.isErr()) {
    return err(rawDataResult.error);
  }
  if (normalizedDataResult.isErr()) {
    return err(normalizedDataResult.error);
  }

  if (!row.provider_name) {
    return err(new Error('Missing required provider_name field'));
  }

  return ok({
    id: row.id,
    accountId: row.account_id,
    providerName: row.provider_name,
    sourceAddress: row.source_address ?? undefined,
    transactionTypeHint: row.transaction_type_hint ?? undefined,
    eventId: row.event_id,
    blockchainTransactionHash: row.blockchain_transaction_hash ?? undefined,
    timestamp: row.timestamp,
    providerData: rawDataResult.value,
    normalizedData: normalizedDataResult.value,
    processingStatus: row.processing_status,
    processedAt: row.processed_at ? new Date(row.processed_at) : undefined,
    createdAt: new Date(row.created_at),
  });
}
