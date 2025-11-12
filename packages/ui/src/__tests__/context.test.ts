import { describe, expect, it, vi } from 'vitest';

import { emitProgress, runWithProgress } from '../context.ts';
import type { ProgressEmitter, ProgressEvent } from '../types.ts';

describe('context', () => {
  describe('runWithProgress', () => {
    it('should run function with emitter in context', async () => {
      const events: ProgressEvent[] = [];
      const emitter: ProgressEmitter = {
        emit: (event) => {
          events.push({ ...event, timestamp: Date.now() });
        },
      };

      const result = await runWithProgress(emitter, () => {
        emitProgress({ type: 'log', message: 'test message' });
        return Promise.resolve('success');
      });

      expect(result).toBe('success');
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'log',
        message: 'test message',
      });
      expect(events[0]?.timestamp).toBeTypeOf('number');
    });

    it('should allow nested async operations', async () => {
      const events: ProgressEvent[] = [];
      const emitter: ProgressEmitter = {
        emit: (event) => {
          events.push({ ...event, timestamp: Date.now() });
        },
      };

      await runWithProgress(emitter, async () => {
        emitProgress({ type: 'started', message: 'starting' });

        await Promise.resolve().then(() => {
          emitProgress({ type: 'progress', message: 'in progress' });
        });

        emitProgress({ type: 'completed', message: 'done' });
      });

      expect(events).toHaveLength(3);
      expect(events[0]?.type).toBe('started');
      expect(events[1]?.type).toBe('progress');
      expect(events[2]?.type).toBe('completed');
    });

    it('should include optional fields when provided', async () => {
      const events: ProgressEvent[] = [];
      const emitter: ProgressEmitter = {
        emit: (event) => {
          events.push({ ...event, timestamp: Date.now() });
        },
      };

      await runWithProgress(emitter, () => {
        emitProgress({
          type: 'progress',
          message: 'processing',
          source: 'TestService',
          data: { current: 5, total: 10, metadata: { key: 'value' } },
        });
        return Promise.resolve();
      });

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'progress',
        message: 'processing',
        source: 'TestService',
        data: {
          current: 5,
          total: 10,
          metadata: { key: 'value' },
        },
      });
    });
  });

  describe('emitProgress', () => {
    it('should gracefully no-op when called outside runWithProgress', () => {
      expect(() => {
        emitProgress({ type: 'log', message: 'test' });
      }).not.toThrow();
    });

    it('should not emit when no context is set', () => {
      const emitSpy = vi.fn();

      emitProgress({ type: 'log', message: 'test' });

      expect(emitSpy).not.toHaveBeenCalled();
    });
  });
});
