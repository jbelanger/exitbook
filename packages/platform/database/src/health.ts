import { Effect } from 'effect';

import { DbPool } from './pool';

export const dbHealth = Effect.gen(function* () {
  const { pool } = yield* DbPool;
  const started = Date.now();
  yield* Effect.tryPromise(() => pool.query('SELECT 1'));
  return { latencyMs: Date.now() - started, ok: true as const };
});
