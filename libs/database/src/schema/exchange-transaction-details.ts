import type { InferSelectModel } from 'drizzle-orm';
import { index, integer, pgEnum, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';

import { ledgerTransactions } from './ledger';

export const tradeSideEnum = pgEnum('trade_side', ['buy', 'sell']);

export const exchangeTransactionDetails = pgTable(
  'exchange_transaction_details',
  {
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    orderId: varchar('order_id', { length: 100 }),
    side: tradeSideEnum('side'),
    symbol: varchar('symbol', { length: 20 }),
    tradeId: varchar('trade_id', { length: 100 }),
    transactionId: integer('transaction_id')
      .primaryKey()
      .references(() => ledgerTransactions.id, { onDelete: 'cascade' }),
  },
  table => ({
    orderIdIdx: index('idx_exchange_order_id').on(table.orderId),
    symbolIdx: index('idx_exchange_symbol').on(table.symbol),
    tradeIdIdx: index('idx_exchange_trade_id').on(table.tradeId),
  })
);

export type ExchangeTransactionDetails = InferSelectModel<typeof exchangeTransactionDetails>;
