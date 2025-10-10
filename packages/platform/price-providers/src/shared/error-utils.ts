/**
 * Error handling utilities for price providers
 *
 * Pure functions for consistent error handling across the package
 */

import { getErrorMessage } from '@exitbook/core';
import type { Result } from 'neverthrow';
import { err } from 'neverthrow';

/**
 * Wrap an unknown error with context message
 * Returns a Result.err with contextualized error
 *
 * Uses core getErrorMessage utility for safe error extraction
 */
export function wrapError<T = never>(error: unknown, context: string): Result<T, Error> {
  const message = getErrorMessage(error);
  return err(new Error(`${context}: ${message}`));
}
