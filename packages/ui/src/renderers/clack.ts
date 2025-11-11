import { intro, log, outro } from '@clack/prompts';

import type { ProgressEmitter } from '../types.ts';

export function createClackEmitter(): ProgressEmitter {
  return {
    emit: (event) => {
      const fullEvent = { ...event, timestamp: Date.now() };

      switch (fullEvent.type) {
        case 'started':
          intro(fullEvent.message);
          break;
        case 'log': {
          const src = fullEvent.source ? ` [${fullEvent.source}]` : '';
          log.message(`${fullEvent.message}${src}`);
          break;
        }
        case 'progress':
          if (fullEvent.data?.current && fullEvent.data?.total) {
            const pct = Math.round((fullEvent.data.current / fullEvent.data.total) * 100);
            log.message(`${fullEvent.message} (${pct}%)`);
          } else {
            log.message(fullEvent.message);
          }
          break;
        case 'warning':
          log.warn(fullEvent.message);
          break;
        case 'completed':
          outro(fullEvent.message);
          break;
        case 'error':
          log.error(fullEvent.message);
          outro('Failed');
          break;
      }
    },
  };
}
