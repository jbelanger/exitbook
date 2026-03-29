#!/usr/bin/env node

import { flushLoggers, getLogger } from '@exitbook/logger';

import { runCli } from './cli.js';

// Only catch initialization errors (before commands run).
// All command errors MUST go through displayCliError() to ensure consistent
// JSON/text formatting and respect for --json flag. Global handlers would bypass
// this function and produce inconsistent output.
runCli().catch((error) => {
  const logger = getLogger('CLI');
  logger.error(`CLI initialization failed: ${String(error)}`);
  flushLoggers();
  process.exit(1);
});
