import { ok, err, type Result } from 'neverthrow';

import type { KyselyDB } from '../database.js';

import { BaseRepository } from './base-repository.js';

export interface RawDataProcessedState {
  processedAt: Date;
  accountHash: string;
}

export class RawDataProcessedStateRepository extends BaseRepository {
  constructor(db: KyselyDB) {
    super(db, 'raw-data-processed-state-repository');
  }

  async get(): Promise<Result<RawDataProcessedState | undefined, Error>> {
    try {
      const row = await this.db
        .selectFrom('raw_data_processed_state')
        .selectAll()
        .where('id', '=', 1)
        .executeTakeFirst();

      if (!row) return ok(undefined);

      return ok({
        processedAt: new Date(row.built_at),
        accountHash: row.account_hash,
      });
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async upsert(state: RawDataProcessedState): Promise<Result<void, Error>> {
    try {
      await this.db
        .insertInto('raw_data_processed_state')
        .values({
          id: 1,
          built_at: state.processedAt.toISOString(),
          account_hash: state.accountHash,
        })
        .onConflict((oc) =>
          oc.column('id').doUpdateSet({
            built_at: state.processedAt.toISOString(),
            account_hash: state.accountHash,
          })
        )
        .execute();

      return ok(undefined);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }
}
