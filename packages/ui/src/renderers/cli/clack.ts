import type { ProgressEmitter, ProgressEvent } from '../../types.ts';

import { taskLog } from './taskLog.ts';

export function createClackEmitter(): ProgressEmitter {
  let taskLogger: ReturnType<typeof taskLog> | undefined;

  const ensureLogger = (message?: string) => {
    if (!taskLogger) {
      taskLogger = taskLog({
        title: message ?? 'Working...',
      });
    }
  };

  const resetLogger = () => {
    taskLogger = undefined;
  };

  return {
    emit: (event) => {
      const fullEvent = { ...event, timestamp: Date.now() } as ProgressLike;

      switch (fullEvent.type) {
        case 'started':
          taskLogger = taskLog({ title: fullEvent.message ?? 'Working...' });
          break;
        case 'log':
          ensureLogger();
          taskLogger?.message(formatMessage(fullEvent));
          break;
        case 'progress':
          ensureLogger();
          taskLogger?.message(formatProgress(fullEvent));
          break;
        case 'warning':
          ensureLogger();
          taskLogger?.message(`⚠️  ${formatMessage(fullEvent)}`);
          break;
        case 'completed':
          ensureLogger();
          taskLogger?.success(fullEvent.message ?? 'Complete');
          resetLogger();
          break;
        case 'error':
          ensureLogger();
          taskLogger?.error(formatMessage(fullEvent));
          resetLogger();
          break;
      }
    },
  };
}

function formatMessage(event: ProgressLike, suffix = ''): string {
  const source = event.source ? ` [${event.source}]` : '';
  return `${event.message}${suffix}${source}`;
}

function formatProgress(event: ProgressLike): string {
  const { current, total } = event.data ?? {};

  if (typeof current === 'number' && typeof total === 'number' && total > 0) {
    const pct = Math.min(100, Math.max(0, Math.round((current / total) * 100)));
    return formatMessage(event, ` (${current}/${total} · ${pct}%)`);
  }

  if (typeof current === 'number') {
    return formatMessage(event, ` (${current})`);
  }

  if (typeof total === 'number' && total > 0) {
    return formatMessage(event, ` (0/${total})`);
  }

  return formatMessage(event);
}

interface ProgressLike extends Omit<ProgressEvent, 'timestamp'> {
  timestamp: number;
}
