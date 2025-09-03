import { pgTable, serial, varchar, integer, boolean, timestamp, pgEnum } from 'drizzle-orm/pg-core';

export const assetClassEnum = pgEnum('asset_class', ['CRYPTO', 'FIAT', 'NFT', 'STOCK']);

export const currencies = pgTable('currencies', {
  id: serial('id').primaryKey(),
  ticker: varchar('ticker', { length: 20 }).unique().notNull(),
  name: varchar('name', { length: 100 }).notNull(),
  decimals: integer('decimals').notNull(),
  assetClass: assetClassEnum('asset_class').notNull(),
  network: varchar('network', { length: 50 }),
  contractAddress: varchar('contract_address', { length: 100 }),
  isNative: boolean('is_native').default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});