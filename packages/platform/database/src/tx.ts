import { Effect } from 'effect';
import type { Kysely } from 'kysely';

import { DbClient } from './client';

export const Db = {
  tx: <A>(f: (trx: Kysely<unknown>) => Promise<A>) =>
    Effect.flatMap(DbClient, (db) =>
      Effect.tryPromise(() => db.transaction().execute((trx) => f(trx))),
    ),
} as const;
