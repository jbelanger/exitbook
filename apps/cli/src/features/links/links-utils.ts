// Pure utility functions for link operations (Functional Core)

import type { LinkStatus } from '@exitbook/accounting';
import { err, ok, type Result } from 'neverthrow';

/**
 * Returns the default reviewer identifier for CLI operations.
 * In the future, this could be replaced with actual user authentication.
 */
export function getDefaultReviewer(): string {
  return 'cli-user';
}

/**
 * Validates if a link can be confirmed based on its current status.
 *
 * @param currentStatus - The current status of the link
 * @returns Result<boolean, Error> where:
 *   - ok(true) = proceed with status update to 'confirmed'
 *   - ok(false) = already confirmed (idempotent, no update needed)
 *   - err(...) = invalid state transition
 */
export function validateLinkStatusForConfirm(currentStatus: LinkStatus): Result<boolean, Error> {
  if (currentStatus === 'confirmed') {
    return ok(false); // Already confirmed, idempotent
  }

  if (currentStatus === 'rejected') {
    return err(new Error('Link was previously rejected. Create a new link instead.'));
  }

  // Status is 'suggested'
  return ok(true); // Proceed with update
}

/**
 * Validates if a link can be rejected based on its current status.
 *
 * @param currentStatus - The current status of the link
 * @returns Result<boolean, Error> where:
 *   - ok(true) = proceed with status update to 'rejected'
 *   - ok(false) = already rejected (idempotent, no update needed)
 *   - err(...) = invalid state transition
 */
export function validateLinkStatusForReject(currentStatus: LinkStatus): Result<boolean, Error> {
  if (currentStatus === 'rejected') {
    return ok(false); // Already rejected, idempotent
  }

  // Can reject both 'suggested' and 'confirmed' links
  // This allows users to override incorrect auto-confirmations
  return ok(true); // Proceed with update
}
