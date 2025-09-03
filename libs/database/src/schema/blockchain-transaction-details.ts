import { pgTable, integer, varchar, timestamp, bigint, pgEnum, index } from 'drizzle-orm/pg-core';
import { ledgerTransactions } from './ledger';

export const blockchainStatusEnum = pgEnum('blockchain_status', ['pending', 'confirmed', 'failed']);

export const blockchainTransactionDetails = pgTable('blockchain_transaction_details', {
  transactionId: integer('transaction_id').primaryKey().references(() => ledgerTransactions.id, { onDelete: 'cascade' }),
  txHash: varchar('tx_hash', { length: 100 }).unique().notNull(),
  blockHeight: integer('block_height'),
  status: blockchainStatusEnum('status').notNull(),
  gasUsed: integer('gas_used'),
  gasPrice: bigint('gas_price', { mode: 'bigint' }), // Use bigint to prevent overflow with high gas prices
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  txHashIdx: index('idx_blockchain_tx_hash').on(table.txHash),
  statusIdx: index('idx_blockchain_status').on(table.status),
  blockHeightIdx: index('idx_blockchain_block_height').on(table.blockHeight),
}));