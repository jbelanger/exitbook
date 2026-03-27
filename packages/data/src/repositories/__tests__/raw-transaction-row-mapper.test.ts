/* eslint-disable unicorn/no-null -- null needed for db row fixtures */
import { assertErr, assertOk } from '@exitbook/foundation/test-utils';
import { describe, expect, it } from 'vitest';

import { toRawTransaction } from '../raw-transaction-row-mapper.js';

describe('toRawTransaction', () => {
  const validRow = {
    id: 1,
    account_id: 10,
    provider_name: 'blockstream',
    source_address: 'bc1q...',
    transaction_type_hint: null,
    event_id: 'tx-123',
    blockchain_transaction_hash: 'abc123',
    timestamp: 1_700_000_000_000,
    provider_data: '{"raw":"data"}',
    normalized_data: '{"normalized":"data"}',
    processing_status: 'pending' as const,
    processed_at: null,
    created_at: '2025-01-01T00:00:00.000Z',
  };

  it('converts a valid row to RawTransaction', () => {
    const result = assertOk(toRawTransaction(validRow));
    expect(result).toEqual({
      id: 1,
      accountId: 10,
      providerName: 'blockstream',
      sourceAddress: 'bc1q...',
      transactionTypeHint: undefined,
      eventId: 'tx-123',
      blockchainTransactionHash: 'abc123',
      timestamp: 1_700_000_000_000,
      providerData: { raw: 'data' },
      normalizedData: { normalized: 'data' },
      processingStatus: 'pending',
      processedAt: undefined,
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
    });
  });

  it('converts processedAt when present', () => {
    const row = { ...validRow, processed_at: '2025-06-01T12:00:00.000Z' };
    const result = assertOk(toRawTransaction(row));
    expect(result.processedAt).toEqual(new Date('2025-06-01T12:00:00.000Z'));
  });

  it('returns error when provider_name is missing', () => {
    const row = { ...validRow, provider_name: '' };
    const error = assertErr(toRawTransaction(row));
    expect(error.message).toContain('provider_name');
  });

  it('handles null optional fields as undefined', () => {
    const row = {
      ...validRow,
      source_address: null,
      blockchain_transaction_hash: null,
      transaction_type_hint: null,
    };
    const result = assertOk(toRawTransaction(row));
    expect(result.sourceAddress).toBeUndefined();
    expect(result.blockchainTransactionHash).toBeUndefined();
    expect(result.transactionTypeHint).toBeUndefined();
  });
});
