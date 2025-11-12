import { AsyncLocalStorage } from 'node:async_hooks';

import type { ProgressEmitter, ProgressEvent } from './types.ts';

const progressContext = new AsyncLocalStorage<ProgressEmitter>();

export function runWithProgress<T>(emitter: ProgressEmitter, fn: () => Promise<T>): Promise<T> {
  return progressContext.run(emitter, fn);
}

export function emitProgress(event: Omit<ProgressEvent, 'timestamp'>): void {
  const emitter = progressContext.getStore();
  emitter?.emit(event);
}
