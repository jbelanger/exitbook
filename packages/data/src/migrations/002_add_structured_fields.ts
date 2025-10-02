import type { Kysely } from 'kysely';

import type { KyselyDB } from '../storage/database.ts';

export async function up(db: Kysely<KyselyDB>): Promise<void> {
  // Add structured movements fields
  await db.schema
    .alterTable('transactions')
    .addColumn('movements_inflows', 'text')
    .addColumn('movements_outflows', 'text')
    .addColumn('movements_primary_asset', 'text')
    .addColumn('movements_primary_amount', 'text')
    .addColumn('movements_primary_currency', 'text')
    .addColumn('movements_primary_direction', 'text')
    .execute();

  // Add structured fees fields
  await db.schema
    .alterTable('transactions')
    .addColumn('fees_network', 'text')
    .addColumn('fees_platform', 'text')
    .addColumn('fees_total', 'text')
    .execute();

  // Add enhanced operation classification fields
  await db.schema
    .alterTable('transactions')
    .addColumn('operation_category', 'text')
    .addColumn('operation_type', 'text')
    .execute();

  // Add blockchain metadata fields
  await db.schema
    .alterTable('transactions')
    .addColumn('blockchain_name', 'text')
    .addColumn('blockchain_block_height', 'integer')
    .addColumn('blockchain_transaction_hash', 'text')
    .addColumn('blockchain_is_confirmed', 'boolean')
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Remove blockchain metadata fields
  await db.schema
    .alterTable('transactions')
    .dropColumn('blockchain_name')
    .dropColumn('blockchain_block_height')
    .dropColumn('blockchain_transaction_hash')
    .dropColumn('blockchain_is_confirmed')
    .execute();

  // Remove enhanced operation classification fields
  await db.schema.alterTable('transactions').dropColumn('operation_category').dropColumn('operation_type').execute();

  // Remove structured fees fields
  await db.schema
    .alterTable('transactions')
    .dropColumn('fees_network')
    .dropColumn('fees_platform')
    .dropColumn('fees_total')
    .execute();

  // Remove structured movements fields
  await db.schema
    .alterTable('transactions')
    .dropColumn('movements_inflows')
    .dropColumn('movements_outflows')
    .dropColumn('movements_primary_asset')
    .dropColumn('movements_primary_amount')
    .dropColumn('movements_primary_currency')
    .dropColumn('movements_primary_direction')
    .execute();
}
