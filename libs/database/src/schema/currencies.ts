import type { InferSelectModel } from 'drizzle-orm';
import { boolean, index, integer, pgEnum, pgTable, serial, timestamp, varchar } from 'drizzle-orm/pg-core';

export const assetClassEnum = pgEnum('asset_class', ['CRYPTO', 'FIAT', 'NFT', 'STOCK']);

export const currencies = pgTable(
  'currencies',
  {
    assetClass: assetClassEnum('asset_class').notNull(),
    contractAddress: varchar('contract_address', { length: 100 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    decimals: integer('decimals').notNull(),
    id: serial('id').primaryKey(),
    isNative: boolean('is_native').default(false),
    name: varchar('name', { length: 100 }).notNull(),
    network: varchar('network', { length: 50 }),
    ticker: varchar('ticker', { length: 20 }).unique().notNull(),
  },
  table => ({
    networkIdx: index('idx_currencies_network').on(table.network),
    tickerIdx: index('idx_currencies_ticker').on(table.ticker),
  })
);

export type Currency = InferSelectModel<typeof currencies>;
