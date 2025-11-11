import * as p from '@clack/prompts';

import type { ProgressEmitter } from '../types.ts';

export function createClackEmitter(): ProgressEmitter {
  const spinner = p.spinner();

  return {
    emit: (event) => {
      const fullEvent = { ...event, timestamp: Date.now() };

      switch (fullEvent.type) {
        case 'started':
          spinner.start(fullEvent.message);
          break;
        case 'log': {
          const src = fullEvent.source ? ` [${fullEvent.source}]` : '';
          process.stderr.write(`\x1b[2m│  ${fullEvent.message}${src}\x1b[0m\n`);
          break;
        }
        case 'progress':
          if (fullEvent.data?.current && fullEvent.data?.total) {
            const pct = Math.round((fullEvent.data.current / fullEvent.data.total) * 100);
            process.stderr.write(`\x1b[2m│  ${fullEvent.message} (${pct}%)\x1b[0m\n`);
          } else {
            process.stderr.write(`\x1b[2m│  ${fullEvent.message}\x1b[0m\n`);
          }
          break;
        case 'warning':
          process.stderr.write(`\x1b[33m│  ⚠️  ${fullEvent.message}\x1b[0m\n`);
          break;
        case 'completed':
          spinner.stop(fullEvent.message);
          break;
        case 'error':
          spinner.stop('Failed');
          process.stderr.write(`\x1b[31m│  ❌ ${fullEvent.message}\x1b[0m\n`);
          break;
      }
    },
  };
}
