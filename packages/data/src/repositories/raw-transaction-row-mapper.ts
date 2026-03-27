import type { RawTransaction } from '@exitbook/core';
import { err, resultDo, type Result } from '@exitbook/foundation';
import type { Selectable } from '@exitbook/sqlite';

import type { RawTransactionTable } from '../database-schema.js';
import { parseJson } from '../utils/json-column-codec.js';

export function toRawTransaction(row: Selectable<RawTransactionTable>): Result<RawTransaction, Error> {
  return resultDo(function* () {
    const providerData = yield* parseJson(row.provider_data);
    const normalizedData = yield* parseJson(row.normalized_data);

    if (!row.provider_name) {
      yield* err(new Error('Missing required provider_name field'));
    }

    return {
      id: row.id,
      accountId: row.account_id,
      providerName: row.provider_name,
      sourceAddress: row.source_address ?? undefined,
      transactionTypeHint: row.transaction_type_hint ?? undefined,
      eventId: row.event_id,
      blockchainTransactionHash: row.blockchain_transaction_hash ?? undefined,
      timestamp: row.timestamp,
      providerData,
      normalizedData,
      processingStatus: row.processing_status,
      processedAt: row.processed_at ? new Date(row.processed_at) : undefined,
      createdAt: new Date(row.created_at),
    };
  });
}
