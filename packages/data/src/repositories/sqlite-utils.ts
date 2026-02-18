/* eslint-disable unicorn/no-null -- null required for db */

/**
 * Convert SQLite INTEGER-backed booleans (0/1) to JavaScript booleans.
 */
export function fromSqliteBoolean(value: number | null): boolean | undefined {
  if (value === null) {
    return undefined;
  }

  return value === 1;
}

/**
 * Convert JavaScript booleans to SQLite INTEGER-backed booleans (0/1).
 */
export function toSqliteBoolean(value: boolean | undefined): number | null {
  if (value === undefined) {
    return null;
  }

  return value ? 1 : 0;
}
