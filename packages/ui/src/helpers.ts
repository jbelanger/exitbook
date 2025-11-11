import { emitProgress } from './context.ts';

export const progress = {
  log: (message: string, source?: string) =>
    emitProgress({
      type: 'log',
      message,
      ...(source !== undefined && { source }),
    }),

  warn: (message: string, source?: string) =>
    emitProgress({
      type: 'warning',
      message,
      ...(source !== undefined && { source }),
    }),

  update: (message: string, current?: number, total?: number, source?: string) =>
    emitProgress({
      type: 'progress',
      message,
      ...(source !== undefined && { source }),
      ...((current !== undefined || total !== undefined) && {
        data: {
          ...(current !== undefined && { current }),
          ...(total !== undefined && { total }),
        },
      }),
    }),

  start: (message: string, source?: string) =>
    emitProgress({
      type: 'started',
      message,
      ...(source !== undefined && { source }),
    }),

  complete: (message: string, source?: string) =>
    emitProgress({
      type: 'completed',
      message,
      ...(source !== undefined && { source }),
    }),

  error: (message: string, source?: string) =>
    emitProgress({
      type: 'error',
      message,
      ...(source !== undefined && { source }),
    }),
};
