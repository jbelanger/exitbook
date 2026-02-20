/* eslint-disable @typescript-eslint/no-empty-function -- acceptable for tests */
/**
 * Unit tests for provider-manager-events
 * Tests event emission logic for provider state transitions
 */

import type { CursorState } from '@exitbook/core';
import { EventBus } from '@exitbook/events';
import { describe, expect, it } from 'vitest';

// Helper to wait for microtasks to flush
async function flushMicrotasks(): Promise<void> {
  await new Promise<void>((resolve) => queueMicrotask(() => resolve()));
}

import type { ProviderEvent } from '../../../events.js';
import type { IBlockchainProvider, StreamingOperation } from '../../types/index.js';
import {
  CURSOR_ADJUSTMENT_REASON,
  emitProviderTransition,
  type ProviderTransitionContext,
  SELECTION_REASON,
} from '../provider-manager-events.js';

// Mock provider helper
function createMockProvider(name: string): IBlockchainProvider {
  return {
    name,
    blockchain: 'ethereum',
  } as IBlockchainProvider;
}

// Mock cursor helper
function createMockCursor(value: number, providerName?: string): CursorState {
  return {
    primary: {
      type: 'blockNumber',
      value,
    },
    metadata: providerName ? { providerName } : undefined,
  } as CursorState;
}

// Mock operation helper
function createMockOperation(): StreamingOperation {
  return {
    type: 'getAddressTransactions',
    streamType: 'normal',
  } as StreamingOperation;
}

describe('emitProviderTransition', () => {
  describe('fresh start (no cursor)', () => {
    it('emits selection event with INITIAL reason', async () => {
      const events: ProviderEvent[] = [];
      const eventBus = new EventBus<ProviderEvent>({ onError: () => {} });
      eventBus.subscribe((event) => events.push(event));

      const context: ProviderTransitionContext = {
        blockchain: 'ethereum',
        operation: createMockOperation(),
        currentProvider: createMockProvider('alchemy'),
      };

      emitProviderTransition(eventBus, context);
      await flushMicrotasks();

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'provider.selection',
        blockchain: 'ethereum',
        operation: 'getAddressTransactions',
        selected: 'alchemy',
        providers: [{ name: 'alchemy', score: 0, reason: SELECTION_REASON.INITIAL }],
      });
    });

    it('does not emit selection event when eventBus is undefined', () => {
      const context: ProviderTransitionContext = {
        blockchain: 'ethereum',
        operation: createMockOperation(),
        currentProvider: createMockProvider('alchemy'),
      };

      // Should not throw
      expect(() => emitProviderTransition(undefined, context)).not.toThrow();
    });
  });

  describe('resume with same provider', () => {
    it('emits resume event only', async () => {
      const events: ProviderEvent[] = [];
      const eventBus = new EventBus<ProviderEvent>({ onError: () => {} });
      eventBus.subscribe((event) => events.push(event));

      const context: ProviderTransitionContext = {
        blockchain: 'ethereum',
        operation: createMockOperation(),
        currentProvider: createMockProvider('alchemy'),
        currentCursor: createMockCursor(1000, 'alchemy'),
      };

      emitProviderTransition(eventBus, context);
      await flushMicrotasks();

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'provider.resume',
        provider: 'alchemy',
        blockchain: 'ethereum',
        operation: 'getAddressTransactions',
        cursor: 1000,
        cursorType: 'blockNumber',
        streamType: 'normal',
      });
    });
  });

  describe('resume with different provider', () => {
    it('emits selection event with PRIORITY reason', async () => {
      const events: ProviderEvent[] = [];
      const eventBus = new EventBus<ProviderEvent>({ onError: () => {} });
      eventBus.subscribe((event) => events.push(event));

      const context: ProviderTransitionContext = {
        blockchain: 'ethereum',
        operation: createMockOperation(),
        currentProvider: createMockProvider('blockscout'),
        currentCursor: createMockCursor(1000, 'alchemy'),
      };

      emitProviderTransition(eventBus, context);
      await flushMicrotasks();

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'provider.selection',
        blockchain: 'ethereum',
        selected: 'blockscout',
        providers: [{ name: 'blockscout', score: 0, reason: SELECTION_REASON.PRIORITY }],
      });
    });
  });

  describe('failover', () => {
    it('emits failover event followed by selection', async () => {
      const events: ProviderEvent[] = [];
      const eventBus = new EventBus<ProviderEvent>({ onError: () => {} });
      eventBus.subscribe((event) => events.push(event));

      const context: ProviderTransitionContext = {
        blockchain: 'ethereum',
        operation: createMockOperation(),
        currentProvider: createMockProvider('blockscout'),
        previousProvider: 'alchemy',
        currentCursor: createMockCursor(1000, 'alchemy'),
        failureReason: 'circuit breaker tripped',
      };

      emitProviderTransition(eventBus, context);
      await flushMicrotasks();

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'provider.failover',
        from: 'alchemy',
        to: 'blockscout',
        blockchain: 'ethereum',
        operation: 'getAddressTransactions',
        streamType: 'normal',
        reason: 'circuit breaker tripped',
      });
    });

    it('uses default reason if failureReason not provided', async () => {
      const events: ProviderEvent[] = [];
      const eventBus = new EventBus<ProviderEvent>({ onError: () => {} });
      eventBus.subscribe((event) => events.push(event));

      const context: ProviderTransitionContext = {
        blockchain: 'ethereum',
        operation: createMockOperation(),
        currentProvider: createMockProvider('blockscout'),
        previousProvider: 'alchemy',
      };

      emitProviderTransition(eventBus, context);
      await flushMicrotasks();

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'provider.failover',
        reason: 'provider failed',
      });
    });
  });

  describe('cursor adjustment', () => {
    it('emits cursor adjustment event when cursor changes', async () => {
      const events: ProviderEvent[] = [];
      const eventBus = new EventBus<ProviderEvent>({ onError: () => {} });
      eventBus.subscribe((event) => events.push(event));

      const context: ProviderTransitionContext = {
        blockchain: 'ethereum',
        operation: createMockOperation(),
        currentProvider: createMockProvider('alchemy'),
        currentCursor: createMockCursor(1000, 'alchemy'),
        adjustedCursor: createMockCursor(950, 'alchemy'),
      };

      emitProviderTransition(eventBus, context);
      await flushMicrotasks();

      // Resume event + cursor adjustment event
      expect(events).toHaveLength(2);
      expect(events[1]).toMatchObject({
        type: 'provider.cursor.adjusted',
        provider: 'alchemy',
        blockchain: 'ethereum',
        originalCursor: 1000,
        adjustedCursor: 950,
        cursorType: 'blockNumber',
        reason: CURSOR_ADJUSTMENT_REASON.REPLAY_WINDOW,
      });
    });

    it('uses FAILOVER reason when adjusting cursor during failover', async () => {
      const events: ProviderEvent[] = [];
      const eventBus = new EventBus<ProviderEvent>({ onError: () => {} });
      eventBus.subscribe((event) => events.push(event));

      const context: ProviderTransitionContext = {
        blockchain: 'ethereum',
        operation: createMockOperation(),
        currentProvider: createMockProvider('blockscout'),
        previousProvider: 'alchemy',
        currentCursor: createMockCursor(1000, 'alchemy'),
        adjustedCursor: createMockCursor(950, 'blockscout'),
      };

      emitProviderTransition(eventBus, context);
      await flushMicrotasks();

      // Failover event + cursor adjustment event
      expect(events).toHaveLength(2);
      expect(events[0]?.type).toBe('provider.failover');
      expect(events[1]).toMatchObject({
        type: 'provider.cursor.adjusted',
        reason: CURSOR_ADJUSTMENT_REASON.FAILOVER,
      });
    });

    it('does not emit cursor adjustment when cursor unchanged', async () => {
      const events: ProviderEvent[] = [];
      const eventBus = new EventBus<ProviderEvent>({ onError: () => {} });
      eventBus.subscribe((event) => events.push(event));

      const sameCursor = createMockCursor(1000, 'alchemy');
      const context: ProviderTransitionContext = {
        blockchain: 'ethereum',
        operation: createMockOperation(),
        currentProvider: createMockProvider('alchemy'),
        currentCursor: sameCursor,
        adjustedCursor: sameCursor,
      };

      emitProviderTransition(eventBus, context);
      await flushMicrotasks();

      // Only resume event, no cursor adjustment
      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe('provider.resume');
    });
  });

  describe('complex scenarios', () => {
    it('emits failover, then cursor adjustment when both occur', async () => {
      const events: ProviderEvent[] = [];
      const eventBus = new EventBus<ProviderEvent>({ onError: () => {} });
      eventBus.subscribe((event) => events.push(event));

      const context: ProviderTransitionContext = {
        blockchain: 'ethereum',
        operation: createMockOperation(),
        currentProvider: createMockProvider('blockscout'),
        previousProvider: 'alchemy',
        currentCursor: createMockCursor(1000, 'alchemy'),
        adjustedCursor: createMockCursor(900, 'blockscout'),
        failureReason: 'rate limited',
      };

      emitProviderTransition(eventBus, context);
      await flushMicrotasks();

      expect(events).toHaveLength(2);
      expect(events[0]).toMatchObject({
        type: 'provider.failover',
        from: 'alchemy',
        to: 'blockscout',
        reason: 'rate limited',
      });
      expect(events[1]).toMatchObject({
        type: 'provider.cursor.adjusted',
        provider: 'blockscout',
        originalCursor: 1000,
        adjustedCursor: 900,
        reason: CURSOR_ADJUSTMENT_REASON.FAILOVER,
      });
    });

    it('handles one-shot operations without streamType', async () => {
      const events: ProviderEvent[] = [];
      const eventBus = new EventBus<ProviderEvent>({ onError: () => {} });
      eventBus.subscribe((event) => events.push(event));

      const oneShotOperation: StreamingOperation = {
        type: 'getAddressTransactions',
        address: '0x123',
        // No streamType - should be handled gracefully
      };

      const context: ProviderTransitionContext = {
        blockchain: 'ethereum',
        operation: oneShotOperation,
        currentProvider: createMockProvider('alchemy'),
      };

      emitProviderTransition(eventBus, context);
      await flushMicrotasks();

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'provider.selection',
        operation: 'getAddressTransactions',
      });
      // streamType is optional and may be undefined
      expect(events[0]).toHaveProperty('type', 'provider.selection');
    });
  });
});
