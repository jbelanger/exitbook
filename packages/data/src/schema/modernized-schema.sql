-- Modernized PostgreSQL-compatible database schema
-- Uses ISO 8601 datetime strings and proper foreign key relationships

-- Import sessions table - tracks import session metadata and execution details
CREATE TABLE import_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Modern datetime handling (ISO 8601 strings)
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'utc') || 'Z'),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now', 'utc') || 'Z'),

  -- Session identification
  source_id TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('exchange', 'blockchain')),
  provider_id TEXT,

  -- Status and metrics
  status TEXT NOT NULL DEFAULT 'started' CHECK (status IN ('started', 'completed', 'failed', 'cancelled')),
  transactions_imported INTEGER NOT NULL DEFAULT 0,
  transactions_failed INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER,

  -- Error handling
  error_message TEXT,
  error_details JSON,

  -- Metadata
  session_metadata JSON
);

-- Wallet addresses - store user's wallet addresses for tracking and consolidation
CREATE TABLE wallet_addresses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Modern datetime handling
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'utc') || 'Z'),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', 'utc') || 'Z'),

  -- Address information
  address TEXT NOT NULL,
  blockchain TEXT NOT NULL,
  address_type TEXT NOT NULL DEFAULT 'personal' CHECK (address_type IN ('personal', 'exchange', 'contract', 'unknown')),

  -- User-defined metadata
  label TEXT,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT 1,

  -- Constraints
  UNIQUE(address, blockchain)
);

-- External transaction data table - stores unprocessed transaction data from sources
CREATE TABLE external_transaction_data (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Modern datetime handling
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'utc') || 'Z'),
  processed_at TEXT,

  -- Foreign key relationship
  import_session_id INTEGER,

  -- Source information
  source_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  provider_id TEXT,

  -- Processing status
  processing_status TEXT NOT NULL DEFAULT 'pending' CHECK (processing_status IN ('pending', 'processed', 'failed', 'skipped')),
  processing_error TEXT,

  -- Data storage
  raw_data JSON NOT NULL,
  metadata JSON,

  -- Foreign key constraints
  FOREIGN KEY (import_session_id) REFERENCES import_sessions(id) ON DELETE SET NULL,

  -- Unique constraint
  UNIQUE(source_id, provider_id)
);

-- Transactions table - stores transactions from all sources with standardized structure
-- Using TEXT for decimal values to preserve precision
CREATE TABLE transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Modern datetime handling (PostgreSQL compatible)
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'utc') || 'Z'),
  transaction_datetime TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now', 'utc') || 'Z'),

  -- Financial data (keep TEXT for precision)
  amount TEXT,
  amount_currency TEXT,
  fee_cost TEXT,
  fee_currency TEXT,
  price TEXT,
  price_currency TEXT,

  -- Proper foreign keys
  wallet_address_id INTEGER,
  import_session_id INTEGER,

  -- Standardized enums
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('trade', 'transfer', 'deposit', 'withdrawal', 'fee', 'reward', 'mining')),
  transaction_status TEXT NOT NULL DEFAULT 'pending' CHECK (transaction_status IN ('pending', 'confirmed', 'failed', 'cancelled')),
  source_type TEXT NOT NULL CHECK (source_type IN ('exchange', 'blockchain')),

  -- Core identification
  source_id TEXT NOT NULL,
  external_id TEXT, -- hash, transaction ID, etc.
  symbol TEXT,

  -- Address information
  from_address TEXT,
  to_address TEXT,

  -- Notes and metadata
  note_message TEXT,
  note_type TEXT,
  note_severity TEXT CHECK (note_severity IN ('info', 'warning', 'error')),
  note_metadata JSON,

  -- Audit trail
  raw_data JSON NOT NULL, -- Keep for debugging/audit
  verified BOOLEAN NOT NULL DEFAULT 0,

  -- Foreign key constraints
  FOREIGN KEY (wallet_address_id) REFERENCES wallet_addresses(id) ON DELETE SET NULL,
  FOREIGN KEY (import_session_id) REFERENCES import_sessions(id) ON DELETE SET NULL
);

-- Balance snapshots - store point-in-time balance data
CREATE TABLE balance_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Modern datetime handling
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'utc') || 'Z'),
  snapshot_datetime TEXT NOT NULL,

  -- Balance data
  balance TEXT NOT NULL,
  currency TEXT NOT NULL,
  exchange TEXT NOT NULL
);

-- Balance verification records - track verification results
CREATE TABLE balance_verifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Modern datetime handling
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'utc') || 'Z'),
  verification_datetime TEXT NOT NULL,

  -- Verification data
  currency TEXT NOT NULL,
  exchange TEXT NOT NULL,
  expected_balance TEXT NOT NULL,
  actual_balance TEXT NOT NULL,
  difference TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('match', 'mismatch', 'warning'))
);

-- Indexes for performance optimization
CREATE INDEX idx_transactions_source_datetime ON transactions(source_id, transaction_datetime);
CREATE INDEX idx_transactions_type_datetime ON transactions(transaction_type, transaction_datetime);
CREATE INDEX idx_transactions_symbol ON transactions(symbol) WHERE symbol IS NOT NULL;
CREATE INDEX idx_transactions_wallet_address ON transactions(wallet_address_id) WHERE wallet_address_id IS NOT NULL;
CREATE INDEX idx_transactions_import_session ON transactions(import_session_id) WHERE import_session_id IS NOT NULL;
CREATE INDEX idx_transactions_from_address ON transactions(from_address) WHERE from_address IS NOT NULL;
CREATE INDEX idx_transactions_to_address ON transactions(to_address) WHERE to_address IS NOT NULL;

CREATE INDEX idx_balance_snapshots_exchange_currency ON balance_snapshots(exchange, currency, snapshot_datetime);
CREATE INDEX idx_balance_verifications_exchange_datetime ON balance_verifications(exchange, verification_datetime);

CREATE INDEX idx_wallet_addresses_blockchain_address ON wallet_addresses(blockchain, address);
CREATE INDEX idx_wallet_addresses_active ON wallet_addresses(is_active) WHERE is_active = 1;

CREATE INDEX idx_import_sessions_source ON import_sessions(source_id, started_at);
CREATE INDEX idx_import_sessions_status ON import_sessions(status, started_at);
CREATE INDEX idx_import_sessions_source_type ON import_sessions(source_type, started_at);

CREATE INDEX idx_external_transaction_data_source ON external_transaction_data(source_id, created_at);
CREATE INDEX idx_external_transaction_data_session ON external_transaction_data(import_session_id) WHERE import_session_id IS NOT NULL;
CREATE INDEX idx_external_transaction_data_status ON external_transaction_data(processing_status, created_at);

-- Update triggers for updated_at columns
CREATE TRIGGER update_import_sessions_updated_at
  AFTER UPDATE ON import_sessions
  BEGIN
    UPDATE import_sessions SET updated_at = datetime('now', 'utc') || 'Z' WHERE id = NEW.id;
  END;

CREATE TRIGGER update_wallet_addresses_updated_at
  AFTER UPDATE ON wallet_addresses
  BEGIN
    UPDATE wallet_addresses SET updated_at = datetime('now', 'utc') || 'Z' WHERE id = NEW.id;
  END;

CREATE TRIGGER update_transactions_updated_at
  AFTER UPDATE ON transactions
  BEGIN
    UPDATE transactions SET updated_at = datetime('now', 'utc') || 'Z' WHERE id = NEW.id;
  END;
