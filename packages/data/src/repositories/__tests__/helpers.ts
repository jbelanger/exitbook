/* eslint-disable unicorn/no-null -- acceptable for db */
import { createHash } from 'node:crypto';

import { computeMovementFingerprint } from '@exitbook/core';

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

function sha256Hex(material: string): string {
  return createHash('sha256').update(material).digest('hex');
}

function inferAccountType(source: string): 'blockchain' | 'exchange-api' {
  return ['bitcoin', 'cardano', 'cosmos', 'ethereum', 'near', 'solana', 'substrate', 'theta', 'xrp'].includes(source)
    ? 'blockchain'
    : 'exchange-api';
}

export function seedTxFingerprint(source: string, accountId: number, identityReference: string): string {
  const accountType = inferAccountType(source);
  const accountFingerprint = sha256Hex(`${accountType}|${source}|identifier-${accountId}`);

  const canonicalMaterial =
    accountType === 'blockchain'
      ? `${accountFingerprint}|blockchain|${source}|${identityReference}`
      : `${accountFingerprint}|exchange|${source}|${[identityReference].sort().join('|')}`;

  return sha256Hex(canonicalMaterial);
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
