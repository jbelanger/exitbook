import type {
  BalanceSnapshot,
  BalanceVerificationRecord,
} from "@crypto/balance";
import type { EnhancedTransaction } from "@crypto/core";
import { getLogger } from "@crypto/shared-logger";
import { Decimal } from "decimal.js";
import * as fs from "fs";
import * as path from "path";
import sqlite3Module from "sqlite3";
import type {
  CreateWalletAddressRequest,
  StoredTransaction,
  UpdateWalletAddressRequest,
  WalletAddress,
  WalletAddressQuery,
} from "../types/data-types.ts";
import type {
  DatabaseStats,
  SQLParam,
  StatRow,
  TransactionCountRow,
} from "../types/database-types.js";

const sqlite3 = sqlite3Module;

type SQLiteDatabase = InstanceType<typeof sqlite3Module.Database>;

// Local utility functions to avoid cyclic dependency with shared-utils
function moneyToDbString(money: {
  amount: Decimal | number;
  currency: string;
}): string {
  if (typeof money.amount === "number") {
    return String(money.amount);
  }
  return money.amount.toString();
}

export class Database {
  private db: SQLiteDatabase;
  private dbPath: string;
  private logger = getLogger("Database");

  constructor(dbPath?: string) {
    const defaultPath = path.join(process.cwd(), "data", "transactions.db");
    const finalPath = dbPath || defaultPath;
    this.dbPath = finalPath;

    // Ensure data directory exists
    const dataDir = path.dirname(finalPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    this.db = new sqlite3.Database(finalPath, (err) => {
      if (err) {
        this.logger.error(
          `Failed to connect to database: ${err.message} (path: ${finalPath})`,
        );
        throw err;
      }
      this.logger.info(`Connected to SQLite database: ${finalPath}`);
    });

    // Enable foreign keys and WAL mode for better performance
    this.db.serialize(() => {
      this.db.run("PRAGMA foreign_keys = ON");
      this.db.run("PRAGMA journal_mode = WAL");
      this.db.run("PRAGMA synchronous = NORMAL");
    });

    this.initializeTables();
  }

  async clearAndReinitialize(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.logger.debug("Clearing and reinitializing database");

      // Close current connection
      this.db.close((err) => {
        if (err) {
          this.logger.error(
            `Error closing database for reinitialization: ${err.message}`,
          );
          return reject(err);
        }

        // Recreate connection and reinitialize with clear flag
        this.db = new sqlite3.Database(this.dbPath, (dbErr) => {
          if (dbErr) {
            this.logger.error(
              `Failed to reconnect to database: ${dbErr.message}`,
            );
            return reject(dbErr);
          }

          // Enable foreign keys and WAL mode
          this.db.serialize(() => {
            this.db.run("PRAGMA foreign_keys = ON");
            this.db.run("PRAGMA journal_mode = WAL");
            this.db.run("PRAGMA synchronous = NORMAL");
          });

          // Initialize tables with clear flag
          this.initializeTables(true);
          this.logger.debug("Database cleared and reinitialized");
          resolve();
        });
      });
    });
  }

  private initializeTables(clearExisting: boolean = false): void {
    // Create tables first
    const tableQueries: string[] = [];

    if (clearExisting) {
      tableQueries.push(
        `DROP TABLE IF EXISTS transactions`,
        `DROP TABLE IF EXISTS raw_transactions`,
        `DROP TABLE IF EXISTS balance_snapshots`,
        `DROP TABLE IF EXISTS balance_verifications`,
        `DROP TABLE IF EXISTS wallet_addresses`,
      );
    }

    tableQueries.push(
      // Raw transactions table - stores unprocessed transaction data from adapters
      `CREATE TABLE ${clearExisting ? "" : "IF NOT EXISTS "}raw_transactions (
        id TEXT PRIMARY KEY,
        adapter_id TEXT NOT NULL,
        adapter_type TEXT NOT NULL,
        source_transaction_id TEXT NOT NULL,
        raw_data JSON NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        import_session_id TEXT,
        UNIQUE(adapter_id, source_transaction_id)
      )`,

      // Transactions table - stores transactions from all adapters with standardized structure
      // Using TEXT for decimal values to preserve precision
      `CREATE TABLE ${clearExisting ? "" : "IF NOT EXISTS "}transactions (
        id TEXT PRIMARY KEY,
        exchange TEXT NOT NULL,
        type TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        datetime TEXT,
        symbol TEXT,
        amount TEXT,
        amount_currency TEXT,
        side TEXT,
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
        hash TEXT UNIQUE NOT NULL,
        verified BOOLEAN DEFAULT 0,
        note_type TEXT,
        note_message TEXT,
        note_severity TEXT CHECK (note_severity IN ('info', 'warning', 'error')),
        note_metadata JSON,
        FOREIGN KEY (wallet_id) REFERENCES wallet_addresses (id)
      )`,

      // Balance snapshots - store point-in-time balance data
      `CREATE TABLE ${clearExisting ? "" : "IF NOT EXISTS "}balance_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        exchange TEXT NOT NULL,
        currency TEXT NOT NULL,
        balance TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
      )`,

      // Balance verification records - track verification results
      `CREATE TABLE ${clearExisting ? "" : "IF NOT EXISTS "}balance_verifications (
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
      `CREATE TABLE ${clearExisting ? "" : "IF NOT EXISTS "}wallet_addresses (
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
      )`,
    );

    // Create indexes after tables are created
    const indexQueries = [
      `CREATE INDEX IF NOT EXISTS idx_transactions_exchange_timestamp 
       ON transactions(exchange, timestamp)`,

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

      // Raw transactions indexes
      `CREATE INDEX IF NOT EXISTS idx_raw_transactions_adapter 
       ON raw_transactions(adapter_id, created_at)`,

      `CREATE INDEX IF NOT EXISTS idx_raw_transactions_session 
       ON raw_transactions(import_session_id) WHERE import_session_id IS NOT NULL`,
    ];

    // Run table and index creation synchronously
    this.db.serialize(() => {
      // Create tables first
      for (const query of tableQueries) {
        this.db.run(query, (err) => {
          if (err) {
            this.logger.error(
              `Failed to create table: ${err.message} (query: ${query})`,
            );
          }
        });
      }

      // Then create indexes after tables are complete
      for (const query of indexQueries) {
        this.db.run(query, (err) => {
          if (err) {
            this.logger.error(
              `Failed to create index: ${err.message} (query: ${query})`,
            );
          }
        });
      }
    });

    this.logger.debug("Database tables initialized");
  }

  // Raw transaction operations
  async saveRawTransaction(
    adapterId: string,
    adapterType: string,
    sourceTransactionId: string,
    rawData: unknown,
    importSessionId?: string
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO raw_transactions 
        (id, adapter_id, adapter_type, source_transaction_id, raw_data, import_session_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      const id = `${adapterId}-raw-${sourceTransactionId}`;
      const rawDataJson = JSON.stringify(rawData);

      stmt.run(
        [
          id,
          adapterId,
          adapterType,
          sourceTransactionId,
          rawDataJson,
          importSessionId || null,
        ],
        function (err) {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        },
      );

      stmt.finalize();
    });
  }

  async saveRawTransactions(
    adapterId: string,
    adapterType: string,
    rawTransactions: Array<{ id: string; data: unknown }>,
    importSessionId?: string
  ): Promise<number> {
    return new Promise((resolve, reject) => {
      let saved = 0;

      this.db.serialize(() => {
        this.db.run("BEGIN TRANSACTION");

        const stmt = this.db.prepare(`
          INSERT OR IGNORE INTO raw_transactions 
          (id, adapter_id, adapter_type, source_transaction_id, raw_data, import_session_id)
          VALUES (?, ?, ?, ?, ?, ?)
        `);

        for (const rawTx of rawTransactions) {
          const id = `${adapterId}-raw-${rawTx.id}`;
          const rawDataJson = JSON.stringify(rawTx.data);

          stmt.run(
            [
              id,
              adapterId,
              adapterType,
              rawTx.id,
              rawDataJson,
              importSessionId || null,
            ],
            function (err) {
              if (err && !err.message.includes("UNIQUE constraint failed")) {
                stmt.finalize();
                return reject(err);
              }
              if (this.changes > 0) saved++;
            },
          );
        }

        stmt.finalize();

        this.db.run("COMMIT", (err) => {
          if (err) {
            reject(err);
          } else {
            resolve(saved);
          }
        });
      });
    });
  }

  async getRawTransactions(
    adapterId?: string,
    importSessionId?: string
  ): Promise<Array<{
    id: string;
    adapterId: string;
    adapterType: string;
    sourceTransactionId: string;
    rawData: unknown;
    createdAt: number;
    importSessionId?: string;
  }>> {
    return new Promise((resolve, reject) => {
      let query = "SELECT * FROM raw_transactions";
      const params: SQLParam[] = [];
      const conditions: string[] = [];

      if (adapterId) {
        conditions.push("adapter_id = ?");
        params.push(adapterId);
      }

      if (importSessionId) {
        conditions.push("import_session_id = ?");
        params.push(importSessionId);
      }

      if (conditions.length > 0) {
        query += " WHERE " + conditions.join(" AND ");
      }

      query += " ORDER BY created_at DESC";

      this.db.all(query, params, (err, rows: any[]) => {
        if (err) {
          reject(err);
        } else {
          const results = rows.map(row => ({
            id: row.id,
            adapterId: row.adapter_id,
            adapterType: row.adapter_type,
            sourceTransactionId: row.source_transaction_id,
            rawData: JSON.parse(row.raw_data),
            createdAt: row.created_at,
            importSessionId: row.import_session_id,
          }));
          resolve(results);
        }
      });
    });
  }

  // Transaction operations
  async saveTransaction(transaction: EnhancedTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO transactions 
        (id, exchange, type, timestamp, datetime, symbol, amount, amount_currency, side, price, price_currency, fee_cost, fee_currency, status, raw_data, hash, verified, note_type, note_message, note_severity, note_metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const rawDataJson = JSON.stringify(transaction);

      // Extract currencies from Money type
      let amountCurrency: string | null = null;
      let priceCurrency: string | null = null;

      // Primary: Extract from Money type structure
      if (
        transaction.amount &&
        typeof transaction.amount === "object" &&
        transaction.amount.currency
      ) {
        amountCurrency = transaction.amount.currency;
      }

      if (
        transaction.price &&
        typeof transaction.price === "object" &&
        transaction.price.currency
      ) {
        priceCurrency = transaction.price.currency;
      }

      stmt.run(
        [
          transaction.id,
          transaction.source,
          transaction.type || "unknown",
          transaction.timestamp || Date.now(),
          transaction.datetime || null,
          transaction.symbol || null,
          typeof transaction.amount === "object"
            ? moneyToDbString(transaction.amount)
            : transaction.amount
              ? String(transaction.amount)
              : null,
          amountCurrency,
          transaction.side || null,
          typeof transaction.price === "object"
            ? moneyToDbString(transaction.price)
            : transaction.price
              ? String(transaction.price)
              : null,
          priceCurrency,
          typeof transaction.fee === "object"
            ? moneyToDbString(transaction.fee)
            : null,
          typeof transaction.fee === "object" ? transaction.fee.currency : null,
          transaction.status || null,
          rawDataJson,
          transaction.hash,
          transaction.verified ? 1 : 0,
          transaction.note?.type || null,
          transaction.note?.message || null,
          transaction.note?.severity || null,
          transaction.note?.metadata
            ? JSON.stringify(transaction.note.metadata)
            : null,
        ],
        function (err) {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        },
      );

      stmt.finalize();
    });
  }

  async saveTransactions(transactions: EnhancedTransaction[]): Promise<number> {
    return new Promise((resolve, reject) => {
      let saved = 0;

      this.db.serialize(() => {
        this.db.run("BEGIN TRANSACTION");

        const stmt = this.db.prepare(`
          INSERT OR IGNORE INTO transactions 
          (id, exchange, type, timestamp, datetime, symbol, amount, amount_currency, side, price, price_currency, fee_cost, fee_currency, status, wallet_id, raw_data, hash, verified, note_type, note_message, note_severity, note_metadata)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        for (const transaction of transactions) {
          const rawDataJson = JSON.stringify(transaction);

          // Extract currencies from Money type or fallback to legacy extraction
          let amountCurrency: string | null = null;
          let priceCurrency: string | null = null;

          // Primary: Extract from Money type structure
          if (
            transaction.amount &&
            typeof transaction.amount === "object" &&
            transaction.amount.currency
          ) {
            amountCurrency = transaction.amount.currency;
          }

          if (
            transaction.price &&
            typeof transaction.price === "object" &&
            transaction.price.currency
          ) {
            priceCurrency = transaction.price.currency;
          }

          // wallet_id will be updated later by the linkTransactionAddresses method
          const walletId = null;

          stmt.run(
            [
              transaction.id,
              transaction.source,
              transaction.type || "unknown",
              transaction.timestamp || Date.now(),
              transaction.datetime || null,
              transaction.symbol || null,
              typeof transaction.amount === "object"
                ? moneyToDbString(transaction.amount)
                : transaction.amount
                  ? String(transaction.amount)
                  : null,
              amountCurrency,
              transaction.side || null,
              typeof transaction.price === "object"
                ? moneyToDbString(transaction.price)
                : transaction.price
                  ? String(transaction.price)
                  : null,
              priceCurrency,
              typeof transaction.fee === "object"
                ? moneyToDbString(transaction.fee)
                : null,
              typeof transaction.fee === "object"
                ? transaction.fee.currency
                : null,
              transaction.status || null,
              walletId,
              rawDataJson,
              transaction.hash,
              transaction.verified ? 1 : 0,
              transaction.note?.type || null,
              transaction.note?.message || null,
              transaction.note?.severity || null,
              transaction.note?.metadata
                ? JSON.stringify(transaction.note.metadata)
                : null,
            ],
            function (err) {
              if (err && !err.message.includes("UNIQUE constraint failed")) {
                stmt.finalize();
                return reject(err);
              }
              if (this.changes > 0) saved++;
            },
          );
        }

        stmt.finalize();

        this.db.run("COMMIT", (err) => {
          if (err) {
            reject(err);
          } else {
            resolve(saved);
          }
        });
      });
    });
  }

  async getTransactions(
    exchange?: string,
    since?: number,
  ): Promise<StoredTransaction[]> {
    return new Promise((resolve, reject) => {
      let query = "SELECT * FROM transactions";
      const params: SQLParam[] = [];

      if (exchange || since) {
        query += " WHERE";
        const conditions: string[] = [];

        if (exchange) {
          conditions.push(" exchange = ?");
          params.push(exchange);
        }

        if (since) {
          conditions.push(" timestamp >= ?");
          params.push(since);
        }

        query += conditions.join(" AND");
      }

      query += " ORDER BY timestamp DESC";

      this.db.all(query, params, (err, rows: StoredTransaction[]) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  async getTransactionCount(exchange?: string): Promise<number> {
    return new Promise((resolve, reject) => {
      let query = "SELECT COUNT(*) as count FROM transactions";
      const params: SQLParam[] = [];

      if (exchange) {
        query += " WHERE exchange = ?";
        params.push(exchange);
      }

      this.db.get(query, params, (err, row: TransactionCountRow) => {
        if (err) {
          reject(err);
        } else {
          resolve(row.count);
        }
      });
    });
  }

  // Balance operations
  async saveBalanceSnapshot(snapshot: BalanceSnapshot): Promise<void> {
    return new Promise((resolve, reject) => {
      const stmt = this.db.prepare(`
        INSERT INTO balance_snapshots 
        (exchange, currency, balance, timestamp)
        VALUES (?, ?, ?, ?)
      `);

      stmt.run(
        [
          snapshot.exchange,
          snapshot.currency,
          String(snapshot.balance),
          snapshot.timestamp,
        ],
        function (err) {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        },
      );

      stmt.finalize();
    });
  }

  async saveBalanceVerification(
    verification: BalanceVerificationRecord,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const stmt = this.db.prepare(`
        INSERT INTO balance_verifications 
        (exchange, currency, expected_balance, actual_balance, difference, status, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        [
          verification.exchange,
          verification.currency,
          String(verification.expected_balance),
          String(verification.actual_balance),
          String(verification.difference),
          verification.status,
          verification.timestamp,
        ],
        function (err) {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        },
      );

      stmt.finalize();
    });
  }

  async getLatestBalanceVerifications(
    exchange?: string,
  ): Promise<BalanceVerificationRecord[]> {
    return new Promise((resolve, reject) => {
      let query = `
        SELECT * FROM balance_verifications 
        WHERE timestamp = (
          SELECT MAX(timestamp) FROM balance_verifications bv2 
          WHERE bv2.exchange = balance_verifications.exchange 
          AND bv2.currency = balance_verifications.currency
        )
      `;
      const params: SQLParam[] = [];

      if (exchange) {
        query += " AND exchange = ?";
        params.push(exchange);
      }

      query += " ORDER BY exchange, currency";

      this.db.all(query, params, (err, rows: BalanceVerificationRecord[]) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  async close(): Promise<void> {
    return new Promise((resolve) => {
      this.db.close((err) => {
        if (err) {
          this.logger.error(`Error closing database: ${err.message}`);
        } else {
          this.logger.info("Database connection closed");
        }
        resolve();
      });
    });
  }

  // Utility methods
  async vacuum(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.run("VACUUM", (err) => {
        if (err) {
          reject(err);
        } else {
          this.logger.info("Database vacuumed");
          resolve();
        }
      });
    });
  }

  async getStats(): Promise<DatabaseStats> {
    return new Promise((resolve, reject) => {
      const queries = [
        "SELECT COUNT(*) as total_transactions FROM transactions",
        "SELECT COUNT(DISTINCT exchange) as total_exchanges FROM transactions",
        "SELECT exchange, COUNT(*) as count FROM transactions GROUP BY exchange",
        "SELECT COUNT(*) as total_verifications FROM balance_verifications",
        "SELECT COUNT(*) as total_snapshots FROM balance_snapshots",
        "SELECT COUNT(*) as total_raw_transactions FROM raw_transactions",
      ];

      const results: DatabaseStats = {
        totalTransactions: 0,
        totalExchanges: 0,
        transactionsByExchange: [],
        totalVerifications: 0,
        totalSnapshots: 0,
        totalRawTransactions: 0,
      };

      this.db.serialize(() => {
        this.db.get(queries[0]!, (err, row: StatRow) => {
          if (err) return reject(err);
          results.totalTransactions = row.total_transactions || 0;
        });

        this.db.get(queries[1]!, (err, row: StatRow) => {
          if (err) return reject(err);
          results.totalExchanges = row.total_exchanges || 0;
        });

        this.db.all(
          queries[2]!,
          (err, rows: Array<{ exchange: string; count: number }>) => {
            if (err) return reject(err);
            results.transactionsByExchange = rows;
          },
        );

        this.db.get(queries[3]!, (err, row: StatRow) => {
          if (err) return reject(err);
          results.totalVerifications = row.total_verifications || 0;
        });

        this.db.get(queries[4]!, (err, row: StatRow) => {
          if (err) return reject(err);
          results.totalSnapshots = row.total_snapshots || 0;
        });

        this.db.get(queries[5]!, (err, row: StatRow) => {
          if (err) return reject(err);
          results.totalRawTransactions = row.total_raw_transactions || 0;
          resolve(results);
        });
      });
    });
  }

  // Wallet address management methods

  async addWalletAddress(
    request: CreateWalletAddressRequest,
  ): Promise<WalletAddress> {
    return new Promise((resolve, reject) => {
      const now = Math.floor(Date.now() / 1000);
      const addressType = request.addressType || "personal";

      const query = `
        INSERT INTO wallet_addresses (address, blockchain, label, address_type, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `;

      this.db.run(
        query,
        [
          request.address,
          request.blockchain,
          request.label,
          addressType,
          request.notes,
          now,
          now,
        ],
        function (err) {
          if (err) {
            if (err.message.includes("UNIQUE constraint failed")) {
              reject(
                new Error(
                  `Wallet address ${request.address} already exists for blockchain ${request.blockchain}`,
                ),
              );
            } else {
              reject(err);
            }
          } else {
            // Fetch the created record
            resolve({
              id: this.lastID,
              address: request.address,
              blockchain: request.blockchain,
              label: request.label ?? "",
              addressType: addressType as
                | "personal"
                | "exchange"
                | "contract"
                | "unknown",
              isActive: true,
              notes: request.notes ?? "",
              createdAt: now,
              updatedAt: now,
            });
          }
        },
      );
    });
  }

  async updateWalletAddress(
    id: number,
    updates: UpdateWalletAddressRequest,
  ): Promise<WalletAddress | null> {
    return new Promise((resolve, reject) => {
      const now = Math.floor(Date.now() / 1000);
      const setParts: string[] = [];
      const params: SQLParam[] = [];

      if (updates.label !== undefined) {
        setParts.push("label = ?");
        params.push(updates.label);
      }
      if (updates.addressType !== undefined) {
        setParts.push("address_type = ?");
        params.push(updates.addressType);
      }
      if (updates.isActive !== undefined) {
        setParts.push("is_active = ?");
        params.push(updates.isActive ? 1 : 0);
      }
      if (updates.notes !== undefined) {
        setParts.push("notes = ?");
        params.push(updates.notes);
      }

      if (setParts.length === 0) {
        this.getWalletAddress(id).then(resolve).catch(reject);
        return;
      }

      setParts.push("updated_at = ?");
      params.push(now);
      params.push(id);

      const query = `UPDATE wallet_addresses SET ${setParts.join(", ")} WHERE id = ?`;

      this.db.run(query, params, (err) => {
        if (err) {
          reject(err);
        } else {
          this.getWalletAddress(id).then(resolve).catch(reject);
        }
      });
    });
  }

  async getWalletAddress(id: number): Promise<WalletAddress | null> {
    return new Promise((resolve, reject) => {
      const query = "SELECT * FROM wallet_addresses WHERE id = ?";

      this.db.get<WalletAddress>(
        query,
        [id],
        (err, row: WalletAddress | undefined) => {
          if (err) {
            reject(err);
          } else if (!row) {
            resolve(null);
          } else {
            resolve({
              id: row.id,
              address: row.address,
              blockchain: row.blockchain,
              label: row.label,
              addressType: row.addressType,
              isActive: Boolean(row.isActive),
              notes: row.notes,
              createdAt: row.createdAt,
              updatedAt: row.updatedAt,
            });
          }
        },
      );
    });
  }

  async getWalletAddresses(
    query?: WalletAddressQuery,
  ): Promise<WalletAddress[]> {
    return new Promise((resolve, reject) => {
      let sql = "SELECT * FROM wallet_addresses";
      const conditions: string[] = [];
      const params: SQLParam[] = [];

      if (query) {
        if (query.blockchain) {
          conditions.push("blockchain = ?");
          params.push(query.blockchain);
        }
        if (query.addressType) {
          conditions.push("address_type = ?");
          params.push(query.addressType);
        }
        if (query.isActive !== undefined) {
          conditions.push("is_active = ?");
          params.push(query.isActive ? 1 : 0);
        }
        if (query.search) {
          conditions.push("(address LIKE ? OR label LIKE ? OR notes LIKE ?)");
          const searchTerm = `%${query.search}%`;
          params.push(searchTerm, searchTerm, searchTerm);
        }
      }

      if (conditions.length > 0) {
        sql += " WHERE " + conditions.join(" AND ");
      }

      sql += " ORDER BY created_at DESC";

      this.db.all(sql, params, (err, rows: WalletAddress[]) => {
        if (err) {
          reject(err);
        } else {
          const addresses = rows.map((row) => ({
            id: row.id,
            address: row.address,
            blockchain: row.blockchain,
            label: row.label,
            addressType: row.addressType,
            isActive: Boolean(row.isActive),
            notes: row.notes,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
          }));
          resolve(addresses);
        }
      });
    });
  }

  async findWalletAddressByAddress(
    address: string,
    blockchain: string,
  ): Promise<WalletAddress | null> {
    return new Promise((resolve, reject) => {
      const query =
        "SELECT * FROM wallet_addresses WHERE address = ? AND blockchain = ?";

      this.db.get(query, [address, blockchain], (err, row: WalletAddress) => {
        if (err) {
          reject(err);
        } else if (!row) {
          resolve(null);
        } else {
          resolve({
            id: row.id,
            address: row.address,
            blockchain: row.blockchain,
            label: row.label,
            addressType: row.addressType,
            isActive: Boolean(row.isActive),
            notes: row.notes,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
          });
        }
      });
    });
  }

  async findWalletAddressByAddressNormalized(
    normalizedAddress: string,
    blockchain: string,
  ): Promise<WalletAddress | null> {
    return new Promise((resolve, reject) => {
      // For Ethereum, do case-insensitive matching by comparing lowercase addresses
      let query: string;
      if (blockchain === "ethereum") {
        query =
          "SELECT * FROM wallet_addresses WHERE LOWER(address) = ? AND blockchain = ?";
      } else {
        query =
          "SELECT * FROM wallet_addresses WHERE address = ? AND blockchain = ?";
      }

      this.db.get(
        query,
        [normalizedAddress, blockchain],
        (err, row: WalletAddress) => {
          if (err) {
            reject(err);
          } else if (!row) {
            resolve(null);
          } else {
            resolve({
              id: row.id,
              address: row.address,
              blockchain: row.blockchain,
              label: row.label,
              addressType: row.addressType,
              isActive: Boolean(row.isActive),
              notes: row.notes,
              createdAt: row.createdAt,
              updatedAt: row.updatedAt,
            });
          }
        },
      );
    });
  }

  async deleteWalletAddress(id: number): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const query = "DELETE FROM wallet_addresses WHERE id = ?";

      this.db.run(query, [id], function (err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.changes > 0);
        }
      });
    });
  }

  async updateTransactionAddresses(
    transactionId: string,
    fromAddress?: string,
    toAddress?: string,
    walletId?: number,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const query = `
        UPDATE transactions 
        SET from_address = ?, to_address = ?, wallet_id = ?
        WHERE id = ?
      `;

      this.db.run(
        query,
        [fromAddress, toAddress, walletId, transactionId],
        (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        },
      );
    });
  }
}
