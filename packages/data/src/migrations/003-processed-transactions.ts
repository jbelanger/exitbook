import { getLogger } from '@crypto/shared-logger';
import type sqlite3Module from 'sqlite3';

type SQLiteDatabase = InstanceType<typeof sqlite3Module.Database>;

const logger = getLogger('Migration-003');

export interface Migration003Config {
  dropExisting?: boolean;
}

/**
 * Migration 003: ProcessedTransaction + Purpose Classifier Tables
 *
 * Creates tables for the new ProcessedTransaction architecture:
 * - processed_transactions: Core transaction data with unclassified movements
 * - movements: Individual money flows within transactions
 * - movement_classifications: Purpose classification results
 */
export function applyMigration003(db: SQLiteDatabase, config: Migration003Config = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const { dropExisting = false } = config;

    logger.debug('Starting migration 003: ProcessedTransaction tables');

    const tableQueries: string[] = [];

    // Drop existing tables if requested
    if (dropExisting) {
      tableQueries.push(
        'DROP TABLE IF EXISTS movement_classifications',
        'DROP TABLE IF EXISTS movements',
        'DROP TABLE IF EXISTS processed_transactions'
      );
    }

    // Core processed transactions table - unclassified movements from processors
    tableQueries.push(`
      CREATE TABLE ${dropExisting ? '' : 'IF NOT EXISTS '}processed_transactions (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL, -- ISO-8601 UTC
        source_kind TEXT NOT NULL CHECK (source_kind IN ('exchange', 'blockchain')),
        source_venue_or_chain TEXT NOT NULL,
        external_id TEXT NOT NULL,
        import_session_id TEXT NOT NULL,
        created_at INTEGER DEFAULT (strftime('%s', 'now'))
      )
    `);

    // Individual money movements within transactions
    tableQueries.push(`
      CREATE TABLE ${dropExisting ? '' : 'IF NOT EXISTS '}movements (
        id TEXT PRIMARY KEY,
        tx_id TEXT NOT NULL REFERENCES processed_transactions(id),
        amount_value TEXT NOT NULL, -- DecimalString for precision
        amount_currency TEXT NOT NULL,
        direction TEXT NOT NULL CHECK (direction IN ('IN', 'OUT')),
        hint TEXT CHECK (hint IN ('FEE', 'GAS')), -- Optional hint for classifier
        sequence INTEGER,
        metadata TEXT, -- JSON
        created_at INTEGER DEFAULT (strftime('%s', 'now'))
      )
    `);

    // Classification results - separate table for classified movements
    tableQueries.push(`
      CREATE TABLE ${dropExisting ? '' : 'IF NOT EXISTS '}movement_classifications (
        movement_id TEXT PRIMARY KEY REFERENCES movements(id),
        purpose TEXT NOT NULL CHECK (purpose IN ('PRINCIPAL', 'FEE', 'GAS')),
        rule_id TEXT NOT NULL,
        version TEXT NOT NULL,
        reason TEXT NOT NULL,
        confidence REAL NOT NULL CHECK (confidence >= 0.0 AND confidence <= 1.0),
        classified_at TEXT NOT NULL, -- ISO-8601 UTC
        created_at INTEGER DEFAULT (strftime('%s', 'now'))
      )
    `);

    // Indexes for performance
    const indexQueries = [
      'CREATE INDEX IF NOT EXISTS idx_transactions_source ON processed_transactions(source_kind, source_venue_or_chain)',
      'CREATE INDEX IF NOT EXISTS idx_transactions_timestamp ON processed_transactions(timestamp)',
      'CREATE INDEX IF NOT EXISTS idx_transactions_import_session ON processed_transactions(import_session_id)',
      'CREATE INDEX IF NOT EXISTS idx_movements_tx ON movements(tx_id)',
      'CREATE INDEX IF NOT EXISTS idx_movements_direction ON movements(direction)',
      'CREATE INDEX IF NOT EXISTS idx_movements_currency ON movements(amount_currency)',
      'CREATE INDEX IF NOT EXISTS idx_classifications_purpose ON movement_classifications(purpose)',
      'CREATE INDEX IF NOT EXISTS idx_classifications_rule ON movement_classifications(rule_id)',
    ];

    db.serialize(() => {
      // Create tables first
      for (const query of tableQueries) {
        db.run(query, (err) => {
          if (err) {
            logger.error(`Failed to create ProcessedTransaction table: ${err.message}`);
            logger.error(`Query: ${query}`);
            return reject(err);
          }
        });
      }

      // Then create indexes
      for (const query of indexQueries) {
        db.run(query, (err) => {
          if (err) {
            logger.error(`Failed to create ProcessedTransaction index: ${err.message}`);
            logger.error(`Query: ${query}`);
            return reject(err);
          }
        });
      }

      logger.info('Migration 003 completed: ProcessedTransaction tables created');
      resolve();
    });
  });
}

/**
 * Rollback Migration 003
 */
export function rollbackMigration003(db: SQLiteDatabase): Promise<void> {
  return new Promise((resolve, reject) => {
    logger.debug('Rolling back migration 003: ProcessedTransaction tables');

    const dropQueries = [
      'DROP TABLE IF EXISTS movement_classifications',
      'DROP TABLE IF EXISTS movements',
      'DROP TABLE IF EXISTS processed_transactions',
    ];

    db.serialize(() => {
      for (const query of dropQueries) {
        db.run(query, (err) => {
          if (err) {
            logger.error(`Failed to drop ProcessedTransaction table: ${err.message}`);
            return reject(err);
          }
        });
      }

      logger.info('Migration 003 rollback completed: ProcessedTransaction tables dropped');
      resolve();
    });
  });
}
