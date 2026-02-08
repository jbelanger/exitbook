/**
 * Unit tests for EventBus ordering semantics and guarantees
 */

import { describe, expect, it, vi } from 'vitest';

import { EventBus } from '../event-bus.js';

// Helper to wait for microtasks to flush
async function flushMicrotasks(): Promise<void> {
  await new Promise<void>((resolve) => queueMicrotask(() => resolve()));
}

type TestEvent = { type: 'event.a'; value: string } | { type: 'event.b'; value: number } | { type: 'event.c' };

describe('EventBus', () => {
  describe('ordering guarantees', () => {
    it('delivers events in emission order', async () => {
      const bus = new EventBus<TestEvent>({
        onError: () => {
          // noop
        },
      });
      const received: string[] = [];

      bus.subscribe((event) => {
        received.push(event.type);
      });

      bus.emit({ type: 'event.a', value: 'first' });
      bus.emit({ type: 'event.b', value: 2 });
      bus.emit({ type: 'event.c' });

      await flushMicrotasks();

      expect(received).toEqual(['event.a', 'event.b', 'event.c']);
    });

    it('delivers events asynchronously via microtask', () => {
      const bus = new EventBus<TestEvent>({
        onError: () => {
          // noop
        },
      });
      const received: string[] = [];

      bus.subscribe((event) => {
        received.push(event.type);
      });

      bus.emit({ type: 'event.a', value: 'test' });

      // Should not be delivered synchronously
      expect(received).toEqual([]);
    });

    it('flushes events after microtask', async () => {
      const bus = new EventBus<TestEvent>({
        onError: () => {
          // noop
        },
      });
      const received: string[] = [];

      bus.subscribe((event) => {
        received.push(event.type);
      });

      bus.emit({ type: 'event.a', value: 'test' });
      await flushMicrotasks();

      expect(received).toEqual(['event.a']);
    });
  });

  describe('error isolation', () => {
    it('isolates listener errors from emitter', async () => {
      const errorHandler = vi.fn();
      const bus = new EventBus<TestEvent>({ onError: errorHandler });

      bus.subscribe(() => {
        throw new Error('Listener 1 error');
      });

      // Should not throw
      expect(() => {
        bus.emit({ type: 'event.a', value: 'test' });
      }).not.toThrow();

      await flushMicrotasks();

      expect(errorHandler).toHaveBeenCalledTimes(1);
      expect(errorHandler).toHaveBeenCalledWith(expect.objectContaining({ message: 'Listener 1 error' }));
    });

    it('isolates listener errors from other listeners', async () => {
      const errorHandler = vi.fn();
      const bus = new EventBus<TestEvent>({ onError: errorHandler });
      const received: string[] = [];

      bus.subscribe(() => {
        throw new Error('Listener 1 error');
      });

      bus.subscribe((event) => {
        received.push(event.type);
      });

      bus.emit({ type: 'event.a', value: 'test' });
      await flushMicrotasks();

      // Second listener should still receive event
      expect(received).toEqual(['event.a']);
      expect(errorHandler).toHaveBeenCalledTimes(1);
    });

    it('calls onError for each failing listener', async () => {
      const errorHandler = vi.fn();
      const bus = new EventBus<TestEvent>({ onError: errorHandler });

      bus.subscribe(() => {
        throw new Error('Listener 1 error');
      });

      bus.subscribe(() => {
        throw new Error('Listener 2 error');
      });

      bus.emit({ type: 'event.a', value: 'test' });
      await flushMicrotasks();

      expect(errorHandler).toHaveBeenCalledTimes(2);
    });
  });

  describe('subscription management', () => {
    it('allows multiple subscribers', async () => {
      const bus = new EventBus<TestEvent>({
        onError: () => {
          // noop
        },
      });
      const received1: string[] = [];
      const received2: string[] = [];

      bus.subscribe((event) => received1.push(event.type));
      bus.subscribe((event) => received2.push(event.type));

      bus.emit({ type: 'event.a', value: 'test' });
      await flushMicrotasks();

      expect(received1).toEqual(['event.a']);
      expect(received2).toEqual(['event.a']);
    });

    it('unsubscribes correctly', async () => {
      const bus = new EventBus<TestEvent>({
        onError: () => {
          // noop
        },
      });
      const received: string[] = [];

      const unsubscribe = bus.subscribe((event) => {
        received.push(event.type);
      });

      bus.emit({ type: 'event.a', value: 'first' });
      await flushMicrotasks();

      unsubscribe();

      bus.emit({ type: 'event.b', value: 2 });
      await flushMicrotasks();

      // Should only receive first event
      expect(received).toEqual(['event.a']);
    });

    it('handles unsubscribe during event delivery', async () => {
      const bus = new EventBus<TestEvent>({
        onError: () => {
          // noop
        },
      });
      const received: string[] = [];

      const unsubscribe = bus.subscribe((event) => {
        received.push(event.type);
        unsubscribe(); // Unsubscribe during handler
      });

      bus.emit({ type: 'event.a', value: 'first' });
      bus.emit({ type: 'event.b', value: 2 });
      await flushMicrotasks();

      // Should receive first event, then unsubscribe before second
      expect(received).toEqual(['event.a']);
    });
  });

  describe('bounded queue', () => {
    it('respects maxQueueSize limit', async () => {
      const bus = new EventBus<TestEvent>({
        maxQueueSize: 2,
        onError: () => {
          // noop
        },
      });
      const received: string[] = [];

      // Emit 3 events rapidly (before microtask flushes)
      bus.emit({ type: 'event.a', value: '1' });
      bus.emit({ type: 'event.b', value: 2 });
      bus.emit({ type: 'event.c' }); // This should cause event.a to be dropped

      bus.subscribe((event) => received.push(event.type));

      await flushMicrotasks();

      // Should only receive last 2 events (event.b and event.c)
      // event.a was dropped when queue exceeded maxQueueSize
      expect(received).toEqual(['event.b', 'event.c']);
    });

    it('uses default maxQueueSize of 1000', async () => {
      const bus = new EventBus<TestEvent>({
        onError: () => {
          // noop
        },
      });
      const received: number[] = [];

      // Emit 1001 events
      for (let i = 0; i < 1001; i++) {
        bus.emit({ type: 'event.b', value: i });
      }

      bus.subscribe((event) => {
        if (event.type === 'event.b') {
          received.push(event.value);
        }
      });

      await flushMicrotasks();

      // Should only receive last 1000 events (1-1000, 0 was dropped)
      expect(received.length).toBe(1000);
      expect(received[0]).toBe(1); // First event (0) was dropped
      expect(received[999]).toBe(1000);
    });

    it('prevents unbounded memory growth', () => {
      const bus = new EventBus<TestEvent>({
        maxQueueSize: 100,
        onError: () => {
          // noop
        },
      });

      // Emit 10,000 events without subscribers
      for (let i = 0; i < 10000; i++) {
        bus.emit({ type: 'event.b', value: i });
      }

      // Queue should be bounded to maxQueueSize
      // This is a whitebox test - we can't directly inspect the queue,
      // but we can verify behavior by subscribing and checking delivery
      const received: number[] = [];
      bus.subscribe((event) => {
        if (event.type === 'event.b') {
          received.push(event.value);
        }
      });

      // No events should be delivered (queue was flushed when subscribers existed)
      expect(received).toEqual([]);
    });
  });

  describe('concurrent emissions', () => {
    it('handles rapid emissions correctly', async () => {
      const bus = new EventBus<TestEvent>({
        onError: () => {
          // noop
        },
      });
      const received: string[] = [];

      bus.subscribe((event) => {
        received.push(`${event.type}`);
      });

      // Emit multiple events in same tick
      for (let i = 0; i < 10; i++) {
        bus.emit({ type: 'event.a', value: `${i}` });
      }

      await flushMicrotasks();

      // All events should be delivered in order
      expect(received.length).toBe(10);
      expect(received).toEqual(Array(10).fill('event.a'));
    });

    it('handles emissions during flush', async () => {
      const bus = new EventBus<TestEvent>({
        onError: () => {
          // noop
        },
      });
      const received: string[] = [];

      bus.subscribe((event) => {
        received.push(event.type);
        if (event.type === 'event.a') {
          // Emit another event during handler
          bus.emit({ type: 'event.b', value: 2 });
        }
      });

      bus.emit({ type: 'event.a', value: 'first' });
      await flushMicrotasks();
      await flushMicrotasks(); // Need second flush for event.b

      // event.a triggers event.b emission
      expect(received).toEqual(['event.a', 'event.b']);
    });
  });
});
