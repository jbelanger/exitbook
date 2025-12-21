/**
 * Unit tests for cursor-utils
 * Pure function tests without mocks
 */

import type { PaginationCursor } from '@exitbook/core';
import { describe, expect, it, vi } from 'vitest';

import type { TransactionWithRawData } from '../../types/index.js';
import type { CursorStateConfig } from '../cursor-utils.js';
import { buildCursorState, createEmptyCompletionCursor } from '../cursor-utils.js';

describe('Cursor Utils', () => {
  describe('buildCursorState', () => {
    const mockExtractCursors = (tx: { blockHeight: number; timestamp: number }): PaginationCursor[] => {
      return [
        { type: 'blockNumber', value: tx.blockHeight },
        { type: 'timestamp', value: tx.timestamp },
      ];
    };

    it('should build cursor state with pageToken', () => {
      const transactions: TransactionWithRawData<{
        blockHeight: number;
        eventId: string;
        id: string;
        timestamp: number;
      }>[] = [
        {
          raw: {},
          normalized: { id: 'tx-1', eventId: 'event-1', blockHeight: 15000000, timestamp: 1640000000000 },
        },
        {
          raw: {},
          normalized: { id: 'tx-2', eventId: 'event-2', blockHeight: 15000001, timestamp: 1640000001000 },
        },
      ];

      const config: CursorStateConfig<{ blockHeight: number; eventId: string; id: string; timestamp: number }> = {
        transactions,
        extractCursors: mockExtractCursors,
        totalFetched: 200,
        providerName: 'moralis',
        pageToken: 'next-page-token',
      };

      const cursorState = buildCursorState(config);

      expect(cursorState).toMatchObject({
        primary: { type: 'pageToken', value: 'next-page-token', providerName: 'moralis' },
        alternatives: [
          { type: 'blockNumber', value: 15000001 },
          { type: 'timestamp', value: 1640000001000 },
        ],
        lastTransactionId: 'event-2',
        totalFetched: 200,
        metadata: {
          providerName: 'moralis',
        },
      });
      expect(cursorState.metadata?.updatedAt).toBeGreaterThan(0);
    });

    it('should build cursor state without pageToken (using blockNumber fallback)', () => {
      const transactions: TransactionWithRawData<{
        blockHeight: number;
        eventId: string;
        id: string;
        timestamp: number;
      }>[] = [
        {
          raw: {},
          normalized: { id: 'tx-1', eventId: 'event-1', blockHeight: 15000000, timestamp: 1640000000000 },
        },
      ];

      const config: CursorStateConfig<{ blockHeight: number; eventId: string; id: string; timestamp: number }> = {
        transactions,
        extractCursors: mockExtractCursors,
        totalFetched: 100,
        providerName: 'moralis',
        pageToken: undefined,
      };

      const cursorState = buildCursorState(config);

      expect(cursorState).toMatchObject({
        primary: { type: 'blockNumber', value: 15000000 },
        alternatives: [
          { type: 'blockNumber', value: 15000000 },
          { type: 'timestamp', value: 1640000000000 },
        ],
        lastTransactionId: 'event-1',
        totalFetched: 100,
        metadata: {
          providerName: 'moralis',
        },
      });
    });

    it('should use last transaction for cursor extraction', () => {
      const extractCursorsSpy = vi.fn(mockExtractCursors);

      const transactions: TransactionWithRawData<{
        blockHeight: number;
        eventId: string;
        id: string;
        timestamp: number;
      }>[] = [
        {
          raw: {},
          normalized: { id: 'tx-1', eventId: 'event-1', blockHeight: 15000000, timestamp: 1640000000000 },
        },
        {
          raw: {},
          normalized: { id: 'tx-2', eventId: 'event-2', blockHeight: 15000001, timestamp: 1640000001000 },
        },
        {
          raw: {},
          normalized: { id: 'tx-3', eventId: 'event-3', blockHeight: 15000002, timestamp: 1640000002000 },
        },
      ];

      const config: CursorStateConfig<{ blockHeight: number; eventId: string; id: string; timestamp: number }> = {
        transactions,
        extractCursors: extractCursorsSpy,
        totalFetched: 300,
        providerName: 'moralis',
        pageToken: 'token',
      };

      buildCursorState(config);

      // Should only call extractCursors on last transaction
      expect(extractCursorsSpy).toHaveBeenCalledTimes(1);
      expect(extractCursorsSpy).toHaveBeenCalledWith({
        id: 'tx-3',
        eventId: 'event-3',
        blockHeight: 15000002,
        timestamp: 1640000002000,
      });
    });

    it('should handle zero blockNumber fallback when no cursors extracted', () => {
      const transactions: TransactionWithRawData<{ eventId: string; id: string }>[] = [
        {
          raw: {},
          normalized: { id: 'tx-1', eventId: 'event-1' },
        },
      ];

      const config: CursorStateConfig<{ eventId: string; id: string }> = {
        transactions,
        extractCursors: () => [], // No cursors available
        totalFetched: 1,
        providerName: 'moralis',
        pageToken: undefined,
      };

      const cursorState = buildCursorState(config);

      expect(cursorState.primary).toEqual({ type: 'blockNumber', value: 0 });
    });

    it('should namespace customMetadata to prevent collision with core fields', () => {
      const transactions: TransactionWithRawData<{
        blockHeight: number;
        eventId: string;
        id: string;
        timestamp: number;
      }>[] = [
        {
          raw: {},
          normalized: { id: 'tx-1', eventId: 'event-1', blockHeight: 15000000, timestamp: 1640000000000 },
        },
      ];

      const config: CursorStateConfig<{ blockHeight: number; eventId: string; id: string; timestamp: number }> = {
        transactions,
        extractCursors: mockExtractCursors,
        totalFetched: 100,
        providerName: 'nearblocks',
        pageToken: 'page-2',
        customMetadata: {
          prevBalances: { account1: '1000' },
          activitiesCursor: 'cursor-abc',
          enrichmentTruncated: false,
        },
      };

      const cursorState = buildCursorState(config);

      // Custom metadata should be namespaced under 'custom'
      expect(cursorState.metadata).toMatchObject({
        providerName: 'nearblocks',

        custom: {
          prevBalances: { account1: '1000' },
          activitiesCursor: 'cursor-abc',
          enrichmentTruncated: false,
        },
      });

      // Ensure custom metadata doesn't clobber core fields
      expect(cursorState.metadata?.providerName).toBe('nearblocks');
    });

    it('should omit custom key when customMetadata is omitted', () => {
      const transactions: TransactionWithRawData<{
        blockHeight: number;
        eventId: string;
        id: string;
        timestamp: number;
      }>[] = [
        {
          raw: {},
          normalized: { id: 'tx-1', eventId: 'event-1', blockHeight: 15000000, timestamp: 1640000000000 },
        },
      ];

      const config: CursorStateConfig<{ blockHeight: number; eventId: string; id: string; timestamp: number }> = {
        transactions,
        extractCursors: mockExtractCursors,
        totalFetched: 100,
        providerName: 'moralis',
        pageToken: undefined,
        // customMetadata omitted
      };

      const cursorState = buildCursorState(config);

      // Should not have 'custom' key when customMetadata is omitted
      expect(cursorState.metadata?.custom).toBeUndefined();
      expect(cursorState.metadata).toMatchObject({
        providerName: 'moralis',
      });
    });
  });

  describe('createEmptyCompletionCursor', () => {
    it('should create empty completion cursor with all required fields', () => {
      const cursor = createEmptyCompletionCursor({
        providerName: 'moralis',
        operationType: 'internal',
        identifier: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb4',
      });

      expect(cursor).toMatchObject({
        primary: { type: 'blockNumber', value: 0 },
        lastTransactionId: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb4:internal:empty',
        totalFetched: 0,
        metadata: {
          providerName: 'moralis',
        },
      });
      expect(cursor.metadata?.updatedAt).toBeGreaterThan(0);
    });

    it('should use "unknown" identifier when not provided', () => {
      const cursor = createEmptyCompletionCursor({
        providerName: 'alchemy',
        operationType: 'token',
      });

      expect(cursor.lastTransactionId).toBe('unknown:token:empty');
    });

    it('should create cursor with custom operation type', () => {
      const cursor = createEmptyCompletionCursor({
        providerName: 'routescan',
        operationType: 'balances',
        identifier: 'account-123',
      });

      expect(cursor.lastTransactionId).toBe('account-123:balances:empty');
      expect(cursor.metadata?.providerName).toBe('routescan');
    });

    it('should have zero totalFetched', () => {
      const cursor = createEmptyCompletionCursor({
        providerName: 'test',
        operationType: 'test-op',
      });

      expect(cursor.totalFetched).toBe(0);
    });

    it('should have blockNumber cursor as primary', () => {
      const cursor = createEmptyCompletionCursor({
        providerName: 'test',
        operationType: 'test-op',
      });

      expect(cursor.primary).toEqual({ type: 'blockNumber', value: 0 });
    });
  });
});
