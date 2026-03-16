/* eslint-disable unicorn/no-null -- acceptable for db */
import { computeMovementFingerprint, computeTxFingerprint } from '@exitbook/core';

import type { KyselyDB } from '../../database.js';

export async function seedUser(db: KyselyDB): Promise<void> {
  await db.insertInto('users').values({ id: 1, created_at: new Date().toISOString() }).execute();
}

export async function seedAccount(
  db: KyselyDB,
  accountId: number,
  type: string,
  source: string,
  options?: {
    parentAccountId?: number | undefined;
  }
): Promise<void> {
  await db
    .insertInto('accounts')
    .values({
      id: accountId,
      user_id: 1,
      account_type: type,
      source_name: source,
      identifier: `identifier-${accountId}`,
      provider_name: null,
      parent_account_id: options?.parentAccountId ?? null,
      last_cursor: null,
      created_at: new Date().toISOString(),
      updated_at: null,
    })
    .execute();
}

export async function seedImportSession(db: KyselyDB, sessionId: number, accountId: number): Promise<void> {
  await db
    .insertInto('import_sessions')
    .values({
      id: sessionId,
      account_id: accountId,
      started_at: new Date().toISOString(),
      status: 'completed',
      transactions_imported: 0,
      transactions_skipped: 0,
      created_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    })
    .execute();
}

export function seedTxFingerprint(source: string, accountId: number, externalId: string): string {
  const result = computeTxFingerprint({ source, accountId, externalId });
  if (result.isErr()) {
    throw result.error;
  }

  return result.value;
}

export function seedMovementFingerprint(
  txFingerprint: string,
  movementType: 'inflow' | 'outflow' | 'fee',
  position: number
): string {
  const result = computeMovementFingerprint({ txFingerprint, movementType, position });
  if (result.isErr()) {
    throw result.error;
  }

  return result.value;
}
