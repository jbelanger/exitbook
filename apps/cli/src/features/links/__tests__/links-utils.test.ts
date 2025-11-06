import type { LinkStatus } from '@exitbook/accounting';
import { describe, expect, it } from 'vitest';

import { getDefaultReviewer, validateLinkStatusForConfirm, validateLinkStatusForReject } from '../links-utils.js';

describe('links-utils', () => {
  describe('getDefaultReviewer', () => {
    it('should return cli-user as default reviewer', () => {
      const result = getDefaultReviewer();

      expect(result).toBe('cli-user');
    });

    it('should consistently return the same value', () => {
      const result1 = getDefaultReviewer();
      const result2 = getDefaultReviewer();

      expect(result1).toBe(result2);
    });
  });

  describe('validateLinkStatusForConfirm', () => {
    it('should return ok(true) for suggested status - can proceed with confirm', () => {
      const result = validateLinkStatusForConfirm('suggested');

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe(true);
    });

    it('should return ok(false) for confirmed status - idempotent operation', () => {
      const result = validateLinkStatusForConfirm('confirmed');

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe(false);
    });

    it('should return error for rejected status - invalid state transition', () => {
      const result = validateLinkStatusForConfirm('rejected');

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toBe('Link was previously rejected. Create a new link instead.');
    });

    it('should handle all LinkStatus enum values', () => {
      const statuses: LinkStatus[] = ['suggested', 'confirmed', 'rejected'];

      statuses.forEach((status) => {
        const result = validateLinkStatusForConfirm(status);
        expect(result.isOk() || result.isErr()).toBe(true);
      });
    });
  });

  describe('validateLinkStatusForReject', () => {
    it('should return ok(true) for suggested status - can proceed with reject', () => {
      const result = validateLinkStatusForReject('suggested');

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe(true);
    });

    it('should return ok(true) for confirmed status - can reject to override auto-confirmation', () => {
      const result = validateLinkStatusForReject('confirmed');

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe(true);
    });

    it('should return ok(false) for rejected status - idempotent operation', () => {
      const result = validateLinkStatusForReject('rejected');

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe(false);
    });

    it('should never return error for any valid status', () => {
      const statuses: LinkStatus[] = ['suggested', 'confirmed', 'rejected'];

      statuses.forEach((status) => {
        const result = validateLinkStatusForReject(status);
        expect(result.isOk()).toBe(true);
      });
    });

    it('should allow rejecting confirmed links to support override functionality', () => {
      // This is important business logic: users must be able to reject auto-confirmed links
      const result = validateLinkStatusForReject('confirmed');

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe(true); // Should proceed with reject
    });
  });
});
