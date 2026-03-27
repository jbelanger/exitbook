// Pure policy functions for link review transitions

import type { LinkStatus } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/foundation';

export function getDefaultReviewer(): string {
  return 'cli-user';
}

export function validateLinkStatusForConfirm(currentStatus: LinkStatus): Result<boolean, Error> {
  if (currentStatus === 'confirmed') {
    return ok(false);
  }

  if (currentStatus === 'rejected') {
    return err(new Error('Link was previously rejected. Create a new link instead.'));
  }

  return ok(true);
}

export function validateLinkStatusForReject(currentStatus: LinkStatus): Result<boolean, Error> {
  if (currentStatus === 'rejected') {
    return ok(false);
  }

  return ok(true);
}
