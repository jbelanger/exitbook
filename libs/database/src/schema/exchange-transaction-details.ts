import { pgTable, integer, varchar, timestamp, pgEnum, index } from 'drizzle-orm/pg-core';
import { ledgerTransactions } from './ledger';

export const tradeSideEnum = pgEnum('trade_side', ['buy', 'sell']);

export const exchangeTransactionDetails = pgTable('exchange_transaction_details', {
  transactionId: integer('transaction_id').primaryKey().references(() => ledgerTransactions.id, { onDelete: 'cascade' }),
  orderId: varchar('order_id', { length: 100 }),
  tradeId: varchar('trade_id', { length: 100 }),
  symbol: varchar('symbol', { length: 20 }),
  side: tradeSideEnum('side'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  orderIdIdx: index('idx_exchange_order_id').on(table.orderId),
  tradeIdIdx: index('idx_exchange_trade_id').on(table.tradeId),
  symbolIdx: index('idx_exchange_symbol').on(table.symbol),
}));