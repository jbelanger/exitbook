import { bigint, index, integer, pgEnum, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';

import { ledgerTransactions } from './ledger';

export const blockchainStatusEnum = pgEnum('blockchain_status', ['pending', 'confirmed', 'failed']);

export const blockchainTransactionDetails = pgTable(
  'blockchain_transaction_details',
  {
    blockHeight: integer('block_height'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    gasPrice: bigint('gas_price', { mode: 'bigint' }), // Use bigint to prevent overflow with high gas prices
    gasUsed: integer('gas_used'),
    status: blockchainStatusEnum('status').notNull(),
    transactionId: integer('transaction_id')
      .primaryKey()
      .references(() => ledgerTransactions.id, { onDelete: 'cascade' }),
    txHash: varchar('tx_hash', { length: 100 }).unique().notNull(),
  },
  table => ({
    blockHeightIdx: index('idx_blockchain_block_height').on(table.blockHeight),
    statusIdx: index('idx_blockchain_status').on(table.status),
    txHashIdx: index('idx_blockchain_tx_hash').on(table.txHash),
  })
);
