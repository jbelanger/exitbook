import { describe, expect, it } from 'vitest';

import { generateSolanaTransactionEventId } from '../utils.js';

describe('solana event identity', () => {
  it('generates a deterministic eventId from signature', () => {
    const eventId1 = generateSolanaTransactionEventId({ signature: '5QxYZ123...' });
    const eventId2 = generateSolanaTransactionEventId({ signature: '5QxYZ123...' });

    expect(eventId1).toBe(eventId2);
    expect(eventId1).toMatch(/^[a-f0-9]{64}$/);
  });

  it('generates different eventIds for different signatures', () => {
    const eventId1 = generateSolanaTransactionEventId({ signature: '5QxYZ123...' });
    const eventId2 = generateSolanaTransactionEventId({ signature: '7AbCDef456...' });

    expect(eventId1).not.toBe(eventId2);
  });
});
