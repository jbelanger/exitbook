import { pgTable, serial, integer, varchar, text, timestamp, pgEnum, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { ledgerTransactions } from './ledger';

export const metadataTypeEnum = pgEnum('metadata_type', ['string', 'number', 'json', 'boolean']);

export const transactionMetadata = pgTable('transaction_metadata', {
  id: serial('id').primaryKey(),
  transactionId: integer('transaction_id').references(() => ledgerTransactions.id, { onDelete: 'cascade' }).notNull(),
  key: varchar('key', { length: 100 }).notNull(),
  value: text('value').notNull(),
  dataType: metadataTypeEnum('data_type').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  uniqueKeyPerTransaction: uniqueIndex('unique_transaction_metadata_key').on(table.transactionId, table.key),
  transactionIdx: index('idx_metadata_transaction').on(table.transactionId),
  keyIdx: index('idx_metadata_key').on(table.key),
}));