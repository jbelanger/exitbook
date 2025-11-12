import { taskLog } from '@clack/prompts';

import type { ProgressEmitter } from '../types.ts';

export function createClackEmitter(): ProgressEmitter {
  let taskLogger: ReturnType<typeof taskLog> | undefined;

  return {
    emit: (event) => {
      const fullEvent = { ...event, timestamp: Date.now() };

      switch (fullEvent.type) {
        case 'started':
          taskLogger = taskLog({
            title: fullEvent.message,
          });
          break;
        case 'log': {
          const src = fullEvent.source ? ` [${fullEvent.source}]` : '';
          taskLogger?.message(`${fullEvent.message}${src}`);
          break;
        }
        case 'progress':
          if (fullEvent.data?.current && fullEvent.data?.total) {
            const pct = Math.round((fullEvent.data.current / fullEvent.data.total) * 100);
            taskLogger?.message(`${fullEvent.message} (${pct}%)`);
          } else {
            taskLogger?.message(fullEvent.message);
          }
          break;
        case 'warning':
          taskLogger?.message(`⚠️  ${fullEvent.message}`);
          break;
        case 'completed':
          taskLogger?.success(fullEvent.message, { showLog: true });
          break;
        case 'error':
          taskLogger?.error(fullEvent.message, { showLog: true });
          break;
      }
    },
  };
}
