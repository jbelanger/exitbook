export const PostgresErrorCodes = {
  CHECK_VIOLATION: '23514',
  EXCLUSION_VIOLATION: '23P01',
  FOREIGN_KEY_VIOLATION: '23503',
  NOT_NULL_VIOLATION: '23502',
  UNIQUE_VIOLATION: '23505',
} as const;

export function isPostgresError(error: unknown): error is { code: string; message: string } {
  return typeof error === 'object' && error !== null && 'code' in error && 'message' in error;
}

export function getErrorCategory(error: unknown): string {
  if (!isPostgresError(error)) {
    return 'unknown';
  }

  switch (error.code) {
    case PostgresErrorCodes.UNIQUE_VIOLATION:
      return 'constraint_violation';
    case PostgresErrorCodes.FOREIGN_KEY_VIOLATION:
      return 'foreign_key_violation';
    case PostgresErrorCodes.NOT_NULL_VIOLATION:
      return 'not_null_violation';
    case PostgresErrorCodes.CHECK_VIOLATION:
      return 'check_violation';
    case PostgresErrorCodes.EXCLUSION_VIOLATION:
      return 'exclusion_violation';
    default:
      return 'database_error';
  }
}
