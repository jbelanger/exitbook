import * as fs from 'node:fs';
import * as path from 'node:path';

import type { BalanceSnapshot, BalanceVerificationRecord } from '@crypto/balance';
import { getLogger } from '@crypto/shared-logger';
import type { Decimal } from 'decimal.js';
import sqlite3Module from 'sqlite3';

import type {
  CreateWalletAddressRequest,
  ImportSession,
  ImportSessionQuery,
  ImportSessionWithRawData,
  UpdateImportSessionRequest,
  UpdateWalletAddressRequest,
  WalletAddress,
  WalletAddressQuery,
} from '../types/data-types.ts';
import type {
  DatabaseStats,
  ImportSessionRow,
  SQLParam,
  StatRow,
  TransactionCountRow,
} from '../types/database-types.js';

const sqlite3 = sqlite3Module;

type SQLiteDatabase = InstanceType<typeof sqlite3Module.Database>;

export class Database {
  private db: SQLiteDatabase;
  private dbPath: string;
  private logger = getLogger('Database');

  constructor(dbPath?: string) {
    const defaultPath = path.join(process.cwd(), 'data', 'transactions.db');
    const finalPath = dbPath || defaultPath;
    this.dbPath = finalPath;

    // Ensure data directory exists
    const dataDir = path.dirname(finalPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    this.db = new sqlite3.Database(finalPath, (err) => {
      if (err) {
        this.logger.error(`Failed to connect to database: ${err.message} (path: ${finalPath})`);
        throw err;
      }
      this.logger.info(`Connected to SQLite database: ${finalPath}`);
    });

    // Enable foreign keys and WAL mode for better performance
    this.db.serialize(() => {
      this.db.run('PRAGMA foreign_keys = ON');
      this.db.run('PRAGMA journal_mode = WAL');
      this.db.run('PRAGMA synchronous = NORMAL');
    });

    this.initializeTables();
  }

  async clearAndReinitialize(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.logger.debug('Clearing and reinitializing database');

      // Close current connection
      this.db.close((err) => {
        if (err) {
          this.logger.error(`Error closing database for reinitialization: ${err.message}`);
          return reject(err);
        }

        // Recreate connection and reinitialize with clear flag
        this.db = new sqlite3.Database(this.dbPath, (dbErr) => {
          if (dbErr) {
            this.logger.error(`Failed to reconnect to database: ${dbErr.message}`);
            return reject(dbErr);
          }

          // Enable foreign keys and WAL mode
          this.db.serialize(() => {
            this.db.run('PRAGMA foreign_keys = ON');
            this.db.run('PRAGMA journal_mode = WAL');
            this.db.run('PRAGMA synchronous = NORMAL');
          });

          // Initialize tables with clear flag
          this.initializeTables(true);
          this.logger.debug('Database cleared and reinitialized');
          resolve();
        });
      });
    });
  }

  async close(): Promise<void> {
    return new Promise((resolve) => {
      this.db.close((err) => {
        if (err) {
          this.logger.error(`Error closing database: ${err.message}`);
        } else {
          this.logger.info('Database connection closed');
        }
        resolve();
      });
    });
  }

  async getStats(): Promise<DatabaseStats> {
    return new Promise((resolve, reject) => {
      const queries = [
        'SELECT COUNT(*) as total_transactions FROM transactions',
        'SELECT COUNT(DISTINCT source_id) as total_sources FROM transactions',
        'SELECT source_id, COUNT(*) as count FROM transactions GROUP BY source_id',
        'SELECT COUNT(*) as total_verifications FROM balance_verifications',
        'SELECT COUNT(*) as total_snapshots FROM balance_snapshots',
        'SELECT COUNT(*) as total_external_transactions FROM external_transaction_data',
        'SELECT COUNT(*) as total_import_sessions FROM import_sessions',
      ];

      const results: DatabaseStats = {
        totalExchanges: 0,
        totalExternalTransactions: 0,
        totalImportSessions: 0,
        totalSnapshots: 0,
        totalTransactions: 0,
        totalVerifications: 0,
        transactionsByExchange: [],
      };

      this.db.serialize(() => {
        this.db.get(queries[0], (err, row: StatRow) => {
          if (err) return reject(err);
          results.totalTransactions = row.total_transactions || 0;
        });

        this.db.get(queries[1], (err, row: StatRow) => {
          if (err) return reject(err);
          results.totalExchanges = row.total_sources || 0;
        });

        this.db.all(queries[2], (err, rows: { count: number; source_id: string }[]) => {
          if (err) return reject(err);
          results.transactionsByExchange = rows.map((row) => ({ count: row.count, exchange: row.source_id }));
        });

        this.db.get(queries[3], (err, row: StatRow) => {
          if (err) return reject(err);
          results.totalVerifications = row.total_verifications || 0;
        });

        this.db.get(queries[4], (err, row: StatRow) => {
          if (err) return reject(err);
          results.totalSnapshots = row.total_snapshots || 0;
        });

        this.db.get(queries[5], (err, row: StatRow) => {
          if (err) return reject(err);
          results.totalExternalTransactions = row.total_external_transactions || 0;
        });

        this.db.get(queries[6], (err, row: StatRow) => {
          if (err) return reject(err);
          results.totalImportSessions = row.total_import_sessions || 0;
          resolve(results);
        });
      });
    });
  }

  // Utility methods
  async vacuum(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.run('VACUUM', (err) => {
        if (err) {
          reject(err);
        } else {
          this.logger.info('Database vacuumed');
          resolve();
        }
      });
    });
  }

  private initializeTables(clearExisting = false): void {
    const tableQueries: string[] = [];

    if (clearExisting) {
      tableQueries.push(
        `DROP TABLE IF EXISTS transactions`,
        `DROP TABLE IF EXISTS external_transaction_data`,
        `DROP TABLE IF EXISTS raw_transactions`,
        `DROP TABLE IF EXISTS balance_snapshots`,
        `DROP TABLE IF EXISTS balance_verifications`,
        `DROP TABLE IF EXISTS wallet_addresses`,
        `DROP TABLE IF EXISTS import_sessions`
      );
    }

    tableQueries.push(
      // Import sessions table - tracks import session metadata and execution details
      `CREATE TABLE ${clearExisting ? '' : 'IF NOT EXISTS '}import_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_id TEXT NOT NULL,
        source_type TEXT NOT NULL CHECK (source_type IN ('exchange', 'blockchain')),
        provider_id TEXT,
        status TEXT NOT NULL DEFAULT 'started' CHECK (status IN ('started', 'completed', 'failed', 'cancelled')),
        started_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        completed_at INTEGER,
        duration_ms INTEGER,
        error_message TEXT,
        error_details JSON,
        session_metadata JSON,
        transactions_imported INTEGER DEFAULT 0,
        transactions_failed INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
      )`,

      // External transaction data table - stores unprocessed transaction data from sources
      `CREATE TABLE ${clearExisting ? '' : 'IF NOT EXISTS '}external_transaction_data (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_id TEXT NOT NULL,
        source_type TEXT NOT NULL,
        provider_id TEXT,
        raw_data JSON NOT NULL,
        metadata JSON,
        processing_status TEXT DEFAULT 'pending',
        processing_error TEXT,
        processed_at INTEGER,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        import_session_id INTEGER,
        UNIQUE(source_id, provider_id),
        FOREIGN KEY (import_session_id) REFERENCES import_sessions (id)
      )`,

      // Transactions table - stores transactions from all sources with standardized structure
      // Using TEXT for decimal values to preserve precision
      `CREATE TABLE ${clearExisting ? '' : 'IF NOT EXISTS '}transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_id TEXT NOT NULL,
        type TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        datetime TEXT,
        symbol TEXT,
        amount TEXT,
        amount_currency TEXT,
        price TEXT,
        price_currency TEXT,
        fee_cost TEXT,
        fee_currency TEXT,
        status TEXT,
        from_address TEXT,
        to_address TEXT,
        wallet_id INTEGER,
        raw_data JSON NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        hash TEXT,
        verified BOOLEAN DEFAULT 0,
        note_type TEXT,
        note_message TEXT,
        note_severity TEXT CHECK (note_severity IN ('info', 'warning', 'error')),
        note_metadata JSON,
        FOREIGN KEY (wallet_id) REFERENCES wallet_addresses (id)
      )`,

      // Balance snapshots - store point-in-time balance data
      `CREATE TABLE ${clearExisting ? '' : 'IF NOT EXISTS '}balance_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        exchange TEXT NOT NULL,
        currency TEXT NOT NULL,
        balance TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
      )`,

      // Balance verification records - track verification results
      `CREATE TABLE ${clearExisting ? '' : 'IF NOT EXISTS '}balance_verifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        exchange TEXT NOT NULL,
        currency TEXT NOT NULL,
        expected_balance TEXT NOT NULL,
        actual_balance TEXT NOT NULL,
        difference TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('match', 'mismatch', 'warning')),
        timestamp INTEGER NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
      )`,

      // Wallet addresses - store user's wallet addresses for tracking and consolidation
      `CREATE TABLE ${clearExisting ? '' : 'IF NOT EXISTS '}wallet_addresses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        address TEXT NOT NULL,
        blockchain TEXT NOT NULL,
        label TEXT,
        address_type TEXT NOT NULL DEFAULT 'personal' CHECK (address_type IN ('personal', 'exchange', 'contract', 'unknown')),
        is_active BOOLEAN DEFAULT 1,
        notes TEXT,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        UNIQUE(address, blockchain)
      )`
    );

    const indexQueries = [
      `CREATE INDEX IF NOT EXISTS idx_transactions_source_timestamp
       ON transactions(source_id, timestamp)`,

      `CREATE INDEX IF NOT EXISTS idx_transactions_type_timestamp
       ON transactions(type, timestamp)`,

      `CREATE INDEX IF NOT EXISTS idx_transactions_symbol
       ON transactions(symbol) WHERE symbol IS NOT NULL`,

      `CREATE INDEX IF NOT EXISTS idx_balance_snapshots_exchange_currency
       ON balance_snapshots(exchange, currency, timestamp)`,

      `CREATE INDEX IF NOT EXISTS idx_balance_verifications_exchange_timestamp
       ON balance_verifications(exchange, timestamp)`,

      // New indexes for wallet address tracking
      `CREATE INDEX IF NOT EXISTS idx_transactions_from_address
       ON transactions(from_address) WHERE from_address IS NOT NULL`,

      `CREATE INDEX IF NOT EXISTS idx_transactions_to_address
       ON transactions(to_address) WHERE to_address IS NOT NULL`,

      `CREATE INDEX IF NOT EXISTS idx_transactions_wallet_id
       ON transactions(wallet_id) WHERE wallet_id IS NOT NULL`,

      `CREATE INDEX IF NOT EXISTS idx_wallet_addresses_blockchain_address
       ON wallet_addresses(blockchain, address)`,

      `CREATE INDEX IF NOT EXISTS idx_wallet_addresses_active
       ON wallet_addresses(is_active) WHERE is_active = 1`,

      // Import sessions indexes
      `CREATE INDEX IF NOT EXISTS idx_import_sessions_source
       ON import_sessions(source_id, started_at)`,

      `CREATE INDEX IF NOT EXISTS idx_import_sessions_status
       ON import_sessions(status, started_at)`,

      `CREATE INDEX IF NOT EXISTS idx_import_sessions_source_type
       ON import_sessions(source_type, started_at)`,

      // External transaction data indexes
      `CREATE INDEX IF NOT EXISTS idx_external_transaction_data_source
       ON external_transaction_data(source_id, created_at)`,

      `CREATE INDEX IF NOT EXISTS idx_external_transaction_data_session
       ON external_transaction_data(import_session_id) WHERE import_session_id IS NOT NULL`,
    ];

    this.db.serialize(() => {
      for (const query of tableQueries) {
        this.db.run(query, (err) => {
          if (err) {
            this.logger.error(`Failed to create table: ${err.message} (query: ${query})`);
          }
        });
      }

      // Then create indexes after tables are complete
      for (const query of indexQueries) {
        this.db.run(query, (err) => {
          if (err) {
            this.logger.error(`Failed to create index: ${err.message} (query: ${query})`);
          }
        });
      }
    });

    this.logger.debug('Database tables initialized');
  }
}
