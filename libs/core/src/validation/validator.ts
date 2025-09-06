import { Result, ok, err } from 'neverthrow';

import { RequiredFieldError, InvalidFormatError } from '../errors/domain-errors';

/**
 * Domain validation helpers for the core library.
 *
 * These validators enforce domain rules and return Result types for composable error handling.
 * They belong in the core domain because they implement business rules specific to ExitBook,
 * not generic utility functions.
 */

/**
 * Validates that a string field is present and not empty after trimming
 */
export function validateRequiredString(
  value: string | undefined | null,
  fieldName: string
): Result<string, RequiredFieldError> {
  if (!value || value.trim() === '') {
    return err(new RequiredFieldError(fieldName));
  }
  return ok(value.trim());
}

/**
 * Validates email format using a simple regex
 */
export function validateEmailFormat(
  email: string | undefined | null,
  fieldName: string = 'email'
): Result<string, RequiredFieldError | InvalidFormatError> {
  // First check if it's required
  const requiredResult = validateRequiredString(email, fieldName);
  if (requiredResult.isErr()) {
    return err(requiredResult.error);
  }

  // Then validate format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const trimmedEmail = requiredResult.value.toLowerCase();

  if (!emailRegex.test(trimmedEmail)) {
    return err(new InvalidFormatError(fieldName, 'email address', email));
  }

  return ok(trimmedEmail);
}

/**
 * Validates that a value is one of the allowed enum values
 */
export function validateEnumValue<T>(value: T, allowedValues: T[], fieldName: string): Result<T, InvalidFormatError> {
  if (!allowedValues.includes(value)) {
    return err(new InvalidFormatError(fieldName, `one of: ${allowedValues.join(', ')}`, value));
  }
  return ok(value);
}
