import { describe, expect, it } from 'vitest';

import {
  getDefaultReviewer,
  validateLinkStatusForConfirm,
  validateLinkStatusForReject,
} from '../link-review-policy.js';

describe('link-review-policy', () => {
  describe('getDefaultReviewer', () => {
    it('returns cli-user as default reviewer', () => {
      expect(getDefaultReviewer()).toBe('cli-user');
    });
  });

  describe('validateLinkStatusForConfirm', () => {
    it('allows confirmation of suggested links', () => {
      const result = validateLinkStatusForConfirm('suggested');
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(true);
      }
    });

    it('returns false for already confirmed links', () => {
      const result = validateLinkStatusForConfirm('confirmed');
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(false);
      }
    });

    it('returns error for rejected links', () => {
      const result = validateLinkStatusForConfirm('rejected');
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('previously rejected');
      }
    });
  });

  describe('validateLinkStatusForReject', () => {
    it('allows rejection of suggested links', () => {
      const result = validateLinkStatusForReject('suggested');
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(true);
      }
    });

    it('allows rejection of confirmed links', () => {
      const result = validateLinkStatusForReject('confirmed');
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(true);
      }
    });

    it('returns false for already rejected links', () => {
      const result = validateLinkStatusForReject('rejected');
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(false);
      }
    });
  });
});
