export { createSqliteDatabase, type CreateSqliteDatabaseOptions } from './database.js';
export { runMigrations } from './migrations.js';
export { closeSqliteDatabase } from './close.js';
export {
  SqliteTypeAdapterPlugin,
  sqliteTypeAdapterPlugin,
  convertValueForSqlite,
} from './plugins/sqlite-type-adapter-plugin.js';

// Re-export commonly used Kysely types so consumers don't need kysely as a direct dependency
export {
  Kysely,
  Migrator,
  sql,
  type ColumnType,
  type ControlledTransaction,
  type Generated,
  type Insertable,
  type KyselyPlugin,
  type Migration,
  type Selectable,
  type Updateable,
} from 'kysely';
