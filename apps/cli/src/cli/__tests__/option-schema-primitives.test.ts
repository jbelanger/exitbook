import { describe, expect, it } from 'vitest';

import { OptionalSourceSelectionSchema, SourceSelectionSchema } from '../option-schema-primitives.js';

describe('SourceSelectionSchema', () => {
  it('accepts exchange-only selection', () => {
    const result = SourceSelectionSchema.safeParse({ exchange: 'kraken' });

    expect(result.success).toBe(true);
  });

  it('accepts blockchain-only selection', () => {
    const result = SourceSelectionSchema.safeParse({ blockchain: 'bitcoin' });

    expect(result.success).toBe(true);
  });

  it('rejects missing source selection', () => {
    const result = SourceSelectionSchema.safeParse({});

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('Either --exchange or --blockchain is required');
  });

  it('rejects selecting both exchange and blockchain', () => {
    const result = SourceSelectionSchema.safeParse({ blockchain: 'bitcoin', exchange: 'kraken' });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('Cannot specify both --exchange and --blockchain');
  });
});

describe('OptionalSourceSelectionSchema', () => {
  it('accepts exchange-only selection', () => {
    const result = OptionalSourceSelectionSchema.safeParse({ exchange: 'kraken' });

    expect(result.success).toBe(true);
  });

  it('accepts blockchain-only selection', () => {
    const result = OptionalSourceSelectionSchema.safeParse({ blockchain: 'bitcoin' });

    expect(result.success).toBe(true);
  });

  it('accepts omitting both sources', () => {
    const result = OptionalSourceSelectionSchema.safeParse({});

    expect(result.success).toBe(true);
  });

  it('rejects selecting both exchange and blockchain', () => {
    const result = OptionalSourceSelectionSchema.safeParse({ blockchain: 'bitcoin', exchange: 'kraken' });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('Cannot specify both --exchange and --blockchain');
  });
});
