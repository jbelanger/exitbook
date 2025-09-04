import type { InferSelectModel } from 'drizzle-orm';
import { index, integer, pgEnum, pgTable, serial, text, timestamp, varchar } from 'drizzle-orm/pg-core';

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
  'EXPENSE_FEES_TRADE',
]);

export const accounts = pgTable(
  'accounts',
  {
    accountType: accountTypeEnum('account_type').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    currencyId: integer('currency_id')
      .references(() => currencies.id, { onDelete: 'restrict' })
      .notNull(),
    externalAddress: varchar('external_address', { length: 255 }),
    id: serial('id').primaryKey(),
    name: varchar('name', { length: 255 }).notNull(),
    network: varchar('network', { length: 50 }),
    parentAccountId: integer('parent_account_id'),
    source: varchar('source', { length: 50 }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    accountTypeIdx: index('idx_accounts_type').on(table.accountType),
    // Indexes for performance
    currencyIdx: index('idx_accounts_currency').on(table.currencyId),
    parentIdx: index('idx_accounts_parent').on(table.parentAccountId),
    sourceIdx: index('idx_accounts_source').on(table.source),
  })
);

// Note: The self-referencing foreign key constraint (parent_account_id -> id)
// is handled in the database migration to avoid circular reference issues in TypeScript

export type Account = InferSelectModel<typeof accounts>;
