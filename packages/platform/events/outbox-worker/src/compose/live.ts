import { EventStoreWithOutboxDefault } from '@exitbook/platform-event-store/compose/live';
import { MessageBusDefault } from '@exitbook/platform-messaging';
import { Layer, Effect } from 'effect';

import { OutboxDaemonLive, OutboxDaemonTag, type DaemonConfig } from '../daemon';
import { ConsoleOutboxMetricsLive } from '../metrics';
import { OutboxProcessorLive } from '../processor';

// Default outbox worker composition with all dependencies
export const OutboxWorkerDefault = Layer.provide(
  Layer.mergeAll(OutboxProcessorLive(), OutboxDaemonLive(), ConsoleOutboxMetricsLive),
  Layer.mergeAll(EventStoreWithOutboxDefault, MessageBusDefault),
);

/**
 * One-liner function to run the outbox daemon with the given configuration.
 * This provides a simple entry point for worker applications.
 */
export const runOutboxDaemon = (_config?: Partial<DaemonConfig>) => {
  const program = Effect.gen(function* () {
    const daemon = yield* OutboxDaemonTag;
    yield* daemon.start();
    // Keep the process alive
    yield* Effect.never;
  });

  return Effect.provide(program, OutboxWorkerDefault);
};
