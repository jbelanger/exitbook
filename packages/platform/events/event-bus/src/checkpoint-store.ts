import type { Effect } from 'effect';
import { Context } from 'effect';

import type { CheckpointError } from './errors';

export interface CheckpointStore {
  load: (subscriptionKey: string) => Effect.Effect<bigint | undefined, CheckpointError>;
  save: (subscriptionKey: string, position: bigint) => Effect.Effect<void, CheckpointError>;
  saveWithMetadata?: (
    subscriptionKey: string,
    position: bigint,
    metadata: { eventsProcessed: number; lastProcessed: Date },
  ) => Effect.Effect<void, CheckpointError>;
}

export const CheckpointStore = Context.GenericTag<CheckpointStore>('@platform/CheckpointStore');
