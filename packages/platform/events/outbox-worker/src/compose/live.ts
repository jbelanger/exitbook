import { EventStoreWithOutboxDefault } from '@exitbook/platform-event-store/compose/live';
import { MessageBusDefault } from '@exitbook/platform-messaging';
import { Layer } from 'effect';

import { OutboxDaemonLive } from '../daemon';
import { ConsoleOutboxMetricsLive } from '../metrics';
import { OutboxProcessorLive } from '../processor';

// Default outbox worker composition with all dependencies
export const OutboxWorkerDefault = Layer.provide(
  Layer.mergeAll(OutboxProcessorLive(), OutboxDaemonLive(), ConsoleOutboxMetricsLive),
  Layer.mergeAll(EventStoreWithOutboxDefault, MessageBusDefault),
);
