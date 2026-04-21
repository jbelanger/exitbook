import { describe, expect, it } from 'vitest';

import { LinksBrowseCommandOptionsSchema, LinksRunCommandOptionsSchema } from '../links-option-schemas.js';

describe('LinksBrowseCommandOptionsSchema', () => {
  it('accepts ordered confidence bounds', () => {
    const result = LinksBrowseCommandOptionsSchema.safeParse({
      maxConfidence: 0.9,
      minConfidence: 0.7,
    });

    expect(result.success).toBe(true);
  });

  it('rejects min-confidence above max-confidence with the exact message', () => {
    const result = LinksBrowseCommandOptionsSchema.safeParse({
      maxConfidence: 0.7,
      minConfidence: 0.8,
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('min-confidence must be less than or equal to max-confidence');
  });
});

describe('LinksRunCommandOptionsSchema', () => {
  it('accepts auto-confirm-threshold at or above min-confidence', () => {
    const result = LinksRunCommandOptionsSchema.safeParse({
      autoConfirmThreshold: 0.95,
      minConfidence: 0.7,
    });

    expect(result.success).toBe(true);
  });

  it('rejects auto-confirm-threshold below min-confidence with the exact message', () => {
    const result = LinksRunCommandOptionsSchema.safeParse({
      autoConfirmThreshold: 0.8,
      minConfidence: 0.9,
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      'auto-confirm-threshold must be greater than or equal to min-confidence'
    );
  });
});
