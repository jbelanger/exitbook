import { Layer, Effect } from 'effect';

import { DbClient } from './client';
import { attachKyselyPlugin } from './instrumentation/kyselyPlugin';
import { installDbInstruments } from './instrumentation/metrics';

export const DbTelemetryLive = Layer.effect(
  DbClient,
  Effect.gen(function* () {
    const db = yield* DbClient;

    // Install metrics instruments
    installDbInstruments();

    // Attach instrumentation plugin
    attachKyselyPlugin(db);

    return db;
  }),
);
