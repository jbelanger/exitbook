import { trace } from '@opentelemetry/api';
import type { Kysely } from 'kysely';

import { installDbInstruments } from './metrics';

const tracer = trace.getTracer('@exitbook/platform-database');

// Configurable thresholds for slow query logging
const WARN_MS = Number(process.env['DB_SLOW_WARN_MS'] ?? '100');
const ERROR_MS = Number(process.env['DB_SLOW_ERROR_MS'] ?? '1000');

// Symbol to mark instrumented instances
const INSTRUMENTED_SYMBOL = Symbol('kysely-instrumented');

// Simple logging-based instrumentation since Kysely plugin API is complex
export function attachKyselyPlugin(db: Kysely<unknown>) {
  // Guard against double instrumentation
  if ((db as unknown as Record<symbol, boolean>)[INSTRUMENTED_SYMBOL]) {
    return;
  }

  const instruments = installDbInstruments();

  // Wrap the database execute method to add instrumentation
  const originalExecute = db.executeQuery.bind(db);

  db.executeQuery = async (query) => {
    const startTime = Date.now();
    const compiledQuery = 'compile' in query ? query.compile() : query;
    const operation = extractOperationFromSQL(compiledQuery.sql);
    const table = extractTableFromSQL(compiledQuery.sql);

    const span = tracer.startSpan(`db.${operation}`, {
      attributes: {
        'db.operation': operation,
        'db.sql.table': table,
        'db.table': table,
      },
    });

    try {
      const result = await originalExecute(query);
      const duration = Date.now() - startTime;

      // Record metrics
      instruments.queryDurationHistogram.record(duration, {
        operation,
        table,
      });

      // Log slow queries
      if (duration > ERROR_MS) {
        console.error(`[SLOW QUERY] ${operation} on ${table} took ${duration}ms`);
      } else if (duration > WARN_MS) {
        console.warn(`[SLOW QUERY] ${operation} on ${table} took ${duration}ms`);
      }

      span.setAttributes({
        'db.duration_ms': duration,
        'db.rows_affected': Number(result.numAffectedRows ?? 0),
      });

      span.setStatus({ code: 1 }); // StatusCode.OK
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;

      // Record error metrics
      instruments.queryErrorCounter.add(1, {
        error_type: getErrorType(error),
        operation,
        table,
      });

      span.recordException(error as Error);
      span.setStatus({
        code: 2, // StatusCode.ERROR
        message: error instanceof Error ? error.message : String(error),
      });

      console.error(`[DB ERROR] ${operation} on ${table} failed after ${duration}ms:`, error);

      throw error;
    } finally {
      span.end();
    }
  };

  // Mark as instrumented
  (db as unknown as Record<symbol, boolean>)[INSTRUMENTED_SYMBOL] = true;
}

function extractOperationFromSQL(sql: string): string {
  const trimmed = sql.trim().toLowerCase();
  if (trimmed.startsWith('select')) return 'select';
  if (trimmed.startsWith('insert')) return 'insert';
  if (trimmed.startsWith('update')) return 'update';
  if (trimmed.startsWith('delete')) return 'delete';
  return 'unknown';
}

function extractTableFromSQL(sql: string): string {
  // Simple regex to extract table name - could be enhanced
  const match = sql.match(/(?:from|into|update)\s+["'`]?(\w+)["'`]?/i);
  return match?.[1] || 'unknown';
}

function getErrorType(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    return String(error.code);
  }
  return 'unknown';
}
