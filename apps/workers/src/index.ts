#!/usr/bin/env node

import { runOutboxDaemon, type DaemonConfig } from '@exitbook/platform-outbox-worker';
import { Runtime } from 'effect';

// One-liner outbox worker main entry point with environment configuration
const config: Partial<DaemonConfig> = {
  baseDelayMs: Number(process.env['OUTBOX_BASE_DELAY_MS']) || 1000,
  batchSize: Number(process.env['OUTBOX_BATCH_SIZE']) || 100,
  intervalMs: Number(process.env['OUTBOX_INTERVAL_MS']) || 1000,
  jitterMs: Number(process.env['OUTBOX_JITTER_MS']) || 250,
  maxAttempts: Number(process.env['OUTBOX_MAX_ATTEMPTS']) || 7,
  maxDelayMs: Number(process.env['OUTBOX_MAX_DELAY_MS']) || 300000,
  maxIdleRounds: Number(process.env['OUTBOX_MAX_IDLE_ROUNDS']) || 10,
  publishConcurrency: Number(process.env['OUTBOX_PUBLISH_CONCURRENCY']) || 16,
};

// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call -- Effect types not properly inferred from library
const main = runOutboxDaemon(config);

// eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- Effect types not properly inferred from library
Runtime.runPromise(Runtime.defaultRuntime)(main).catch(console.error);
