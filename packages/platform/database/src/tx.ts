import type { Context } from 'effect';
import { Effect } from 'effect';
import type { Kysely } from 'kysely';

import { DbClient } from './client';

export const Db = {
  of<DB>() {
    return DbClient as unknown as Context.Tag<string, Kysely<DB>>;
  },

  tx: <A>(f: (db: Kysely<unknown>) => Promise<A>) =>
    Effect.flatMap(DbClient, (db) =>
      Effect.tryPromise(() => db.transaction().execute(() => f(db))),
    ),
} as const;
