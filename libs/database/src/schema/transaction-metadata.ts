import type { InferSelectModel } from 'drizzle-orm';
import { index, integer, pgEnum, pgTable, serial, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';

import { ledgerTransactions } from './ledger';

export const metadataTypeEnum = pgEnum('metadata_type', ['string', 'number', 'json', 'boolean']);

export const transactionMetadata = pgTable(
  'transaction_metadata',
  {
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    dataType: metadataTypeEnum('data_type').notNull(),
    id: serial('id').primaryKey(),
    key: varchar('key', { length: 100 }).notNull(),
    transactionId: integer('transaction_id')
      .references(() => ledgerTransactions.id, { onDelete: 'cascade' })
      .notNull(),
    value: text('value').notNull(),
  },
  table => ({
    keyIdx: index('idx_metadata_key').on(table.key),
    transactionIdx: index('idx_metadata_transaction').on(table.transactionId),
    uniqueKeyPerTransaction: uniqueIndex('unique_transaction_metadata_key').on(table.transactionId, table.key),
  })
);

export type TransactionMetadata = InferSelectModel<typeof transactionMetadata>;
