import {
  bigint,
  index,
  integer,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

import { accounts } from './accounts';
import { currencies } from './currencies';

export const directionEnum = pgEnum('direction', ['CREDIT', 'DEBIT']);
export const entryTypeEnum = pgEnum('entry_type', [
  'TRADE',
  'DEPOSIT',
  'WITHDRAWAL',
  'FEE',
  'REWARD',
  'STAKING',
  'AIRDROP',
  'MINING',
  'LOAN',
  'REPAYMENT',
  'TRANSFER',
  'GAS',
]);

export const ledgerTransactions = pgTable(
  'ledger_transactions',
  {
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    description: text('description').notNull(),
    externalId: varchar('external_id', { length: 255 }).notNull(),
    id: serial('id').primaryKey(),
    source: varchar('source', { length: 50 }).notNull(),
    transactionDate: timestamp('transaction_date', { withTimezone: true }).notNull(),
  },
  table => ({
    // Ensures idempotency - prevents duplicate transactions from retried jobs
    externalIdSourceIdx: uniqueIndex('external_id_source_idx').on(table.externalId, table.source),
    sourceIdx: index('idx_ledger_transactions_source').on(table.source),
    transactionDateIdx: index('idx_ledger_transactions_date').on(table.transactionDate),
  })
);

export const entries = pgTable(
  'entries',
  {
    accountId: integer('account_id')
      .references(() => accounts.id, { onDelete: 'restrict' })
      .notNull(),
    amount: bigint('amount', { mode: 'bigint' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    currencyId: integer('currency_id')
      .references(() => currencies.id, { onDelete: 'restrict' })
      .notNull(),
    direction: directionEnum('direction').notNull(),
    entryType: entryTypeEnum('entry_type').notNull(),
    id: serial('id').primaryKey(),
    transactionId: integer('transaction_id')
      .references(() => ledgerTransactions.id, { onDelete: 'cascade' })
      .notNull(),
  },
  table => ({
    // Critical indexes for performance
    accountCurrencyIdx: index('idx_entries_account_currency').on(table.accountId, table.currencyId),
    currencyIdx: index('idx_entries_currency').on(table.currencyId),
    entryTypeIdx: index('idx_entries_type').on(table.entryType),
    transactionIdx: index('idx_entries_transaction').on(table.transactionId),
  })
);
