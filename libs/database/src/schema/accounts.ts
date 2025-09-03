import { pgTable, serial, varchar, timestamp, text, pgEnum, integer, index } from 'drizzle-orm/pg-core';
import { currencies } from './currencies';

export const accountTypeEnum = pgEnum('account_type', [
  'ASSET_WALLET',
  'ASSET_EXCHANGE',
  'ASSET_DEFI_LP',
  'LIABILITY_LOAN',
  'EQUITY_OPENING_BALANCE',
  'EQUITY_MANUAL_ADJUSTMENT',
  'INCOME_STAKING',
  'INCOME_TRADING',
  'INCOME_AIRDROP',
  'INCOME_MINING',
  'EXPENSE_FEES_GAS',
  'EXPENSE_FEES_TRADE'
]);

export const accounts = pgTable('accounts', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  currencyId: integer('currency_id').references(() => currencies.id, { onDelete: 'restrict' }).notNull(),
  accountType: accountTypeEnum('account_type').notNull(),
  network: varchar('network', { length: 50 }),
  externalAddress: varchar('external_address', { length: 255 }),
  source: varchar('source', { length: 50 }),
  parentAccountId: integer('parent_account_id').references(() => accounts.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  // Indexes for performance
  currencyIdx: index('idx_accounts_currency').on(table.currencyId),
  accountTypeIdx: index('idx_accounts_type').on(table.accountType),
  sourceIdx: index('idx_accounts_source').on(table.source),
  parentIdx: index('idx_accounts_parent').on(table.parentAccountId),
}));