/* eslint-disable unicorn/no-null -- null is required for db */

/**
 * Recursively converts values for SQLite compatibility
 * - undefined -> null
 * - boolean -> 0 or 1
 * - Keeps all other types unchanged
 */
export function convertValueForSqlite(value: unknown): unknown {
  if (value === undefined) {
    return null;
  }

  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }

  if (Array.isArray(value)) {
    return value.map(convertValueForSqlite);
  }

  if (value && typeof value === 'object' && value.constructor === Object) {
    const converted: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      converted[key] = convertValueForSqlite(val);
    }
    return converted;
  }

  return value;
}
