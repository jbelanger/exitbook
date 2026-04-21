#!/usr/bin/env node

import { flushLoggers, getLogger } from '@exitbook/logger';

import { runCli } from './cli.js';

// Only catch initialization errors (before commands run).
// Command execution should route failures through the shared CLI boundary so
// JSON/text formatting and semantic exit codes stay consistent. Global handlers
// would bypass that boundary and produce inconsistent output.
process.on('exit', () => flushLoggers());

runCli().catch((error) => {
  const logger = getLogger('CLI');
  logger.error(`CLI initialization failed: ${String(error)}`);
  flushLoggers();
  process.exit(1);
});
