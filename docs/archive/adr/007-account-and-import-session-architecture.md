# ADR 007: Account and Import Session Architecture

**Date**: 2025-01-14
**Status**: Accepted
**Deciders**: Joel Belanger (maintainer)
**Tags**: database, architecture, accounts, users, import-sessions, data-model

---

## Context and Problem Statement

The system needs to import cryptocurrency transaction data from multiple sources (exchanges, blockchains) and track this data over time. We need to design the data model for:

1. **Account tracking**: Users connect to various accounts (Kraken API, Bitcoin addresses, etc.)
2. **Import execution**: Data is imported from these accounts via scheduled runs or manual triggers
3. **Multi-account scenarios**: Users may have multiple accounts on the same exchange or blockchain
4. **Investigation use case**: Users track not just their own accounts, but also external wallets for analysis
5. **Audit and debugging**: Track when imports ran, what data was fetched, and troubleshoot issues

### Key Requirements

**Account Identity:**

- Support multiple accounts per exchange (personal + business Kraken)
- Support multiple blockchain addresses per chain
- Support different access methods (API vs CSV for exchanges)
- Track account-level state (resume cursors, last balance check)

**Import History:**

- Track every import attempt (successful and failed)
- Record timing, transaction counts, errors for each run
- Support incremental imports (1000 txs initially, +50 next week)
- Enable debugging: "which import created transaction #12345?"

**Multi-User Support:**

- CLI: Single default user
- Future: Web app with multiple users
- Distinguish owned accounts vs tracked external wallets

**Resume and Recovery:**

- Crash during import → resume from last cursor
- Streaming imports persist progress after each batch
- Account state (cursors, verification) persists across sessions

---

## Decision

Design a multi-table architecture that separates user identity, account identity, and import execution:

1. **`users`**: Who is using the system
2. **`accounts`**: What accounts are being tracked (persistent identity and state). Supports hierarchical accounts (parent xpub -> child addresses).
3. **`import_sessions`**: Import execution history (temporal events)
4. **`raw_transactions`**: Unprocessed transaction data from sources, scoped by account

### Core Principles

1. **Separation of identity and execution**:
   - Accounts = persistent entities ("I have a Kraken account")
   - Import sessions = temporal events ("I ran an import on Jan 15 at 3pm")

2. **Hierarchical Accounts for xpubs**:
   - Parent account represents the xpub itself
   - Child accounts represent derived addresses linked via `parent_account_id`
   - Each child account has its own cursors and import sessions

3. **One session per import run**:
   - Every import creates a new session record
   - Full audit trail of all attempts (success and failure)

4. **Account-level state**:
   - Resume cursors stored on account (survive crashes)
   - Balance verification stored on account (current state)

5. **Explicit account types**:
   - Distinguish blockchain vs exchange
   - Distinguish exchange API vs CSV (different identifier semantics)

6. **Tracking vs ownership**:
   - User's accounts: `user_id` NOT NULL
   - External tracking: `user_id` NULL (investigation use case)

---

## Detailed Design

### Users Table

```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

**Purpose**: Track who is using the system

**CLI behavior**: Auto-create default user (id=1) on first run

**Future extensibility**: Add email, auth tokens, preferences for web app

### Accounts Table

```sql
CREATE TABLE accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NULLABLE REFERENCES users(id),  -- NULL = tracking only
  parent_account_id INTEGER NULLABLE REFERENCES accounts(id), -- For derived addresses (xpub child accounts)

  account_type TEXT NOT NULL,  -- 'blockchain' | 'exchange-api' | 'exchange-csv'
  source_name TEXT NOT NULL,   -- 'kraken', 'bitcoin', 'ethereum', etc.
  identifier TEXT NOT NULL,    -- address/xpub/apiKey or stable string logic
  provider_name TEXT,          -- preferred provider for blockchain imports

  credentials TEXT,            -- JSON: ExchangeCredentials (apiKey, apiSecret, etc.) - for exchange-api
  last_cursor TEXT,            -- JSON: Record<operationType, CursorState>
  last_balance_check_at TEXT,
  verification_metadata TEXT,  -- JSON

  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT,

  -- Constraint: One account per (type, source, identifier, user) combination
  CONSTRAINT idx_accounts_unique UNIQUE (
    account_type,
    source_name,
    identifier,
    COALESCE(user_id, 0)
  )
);
```

**Purpose**: Represent a persistent account that can be imported multiple times

**Account Types:**

- **`blockchain`**: Cryptocurrency blockchain address or xpub
  - Examples: Bitcoin bc1q..., Ethereum 0x..., xpub6D4BDPc...
  - Identifier: the address or xpub
  - **Hierarchy**: If xpub, creates a parent account. Derived addresses become child accounts with `parent_account_id` pointing to the xpub account.

- **`exchange-api`**: Exchange account accessed via API
  - Examples: Kraken API, KuCoin API, Coinbase API
  - Identifier: API key (uniquely identifies the account)
  - Credentials: API Key, Secret, Passphrase stored in `credentials` JSON column

- **`exchange-csv`**: Exchange account accessed via CSV files
  - Examples: Kraken CSV export, KuCoin CSV export
  - Identifier: Sorted, comma-separated list of CSV directory paths (stable identifier)

**State Fields:**

- **`last_cursor`**: Resume state for streaming imports
  - Format: `Record<operationType, CursorState>` as JSON
  - Updated after each batch during import
  - Enables crash recovery and resumption

- **`verification_metadata`**: Last balance check results
  - Live balance vs calculated balance
  - Discrepancies and warnings
  - Timestamp of verification

**User Association:**

- `user_id` NOT NULL: Account owned by user
- `user_id` NULL: External account being tracked (investigation/analysis)

### Import Sessions Table

```sql
CREATE TABLE import_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id),

  -- Session lifecycle
  status TEXT NOT NULL DEFAULT 'started',  -- 'started' | 'completed' | 'failed' | 'cancelled'
  started_at TEXT NOT NULL,
  completed_at TEXT,
  duration_ms INTEGER,

  -- Session results
  transactions_imported INTEGER NOT NULL DEFAULT 0,
  transactions_skipped INTEGER NOT NULL DEFAULT 0, -- Deduplicated transactions

  -- Error handling
  error_message TEXT,
  error_details TEXT,  -- JSON

  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);

CREATE INDEX idx_import_sessions_account_id ON import_sessions(account_id);
```

**Purpose**: Track each import execution as a discrete event. For xpub imports, individual sessions are created for each child account import.

**Result Tracking:**

- `transactions_imported`: How many new transactions this session imported
- `transactions_skipped`: How many were found but skipped (duplicates)
- `duration_ms`: How long the import took

### Raw Transactions Table

```sql
CREATE TABLE raw_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id),

  provider_name TEXT NOT NULL,

  -- Transaction identification
  external_id TEXT NOT NULL,           -- Unique ID from source
  blockchain_transaction_hash TEXT,    -- On-chain hash (for blockchain)

  source_address TEXT,                 -- For blockchain (wallet address)
  transaction_type_hint TEXT,          -- For exchange (e.g., 'deposit', 'trade')

  -- Data storage
  provider_data TEXT NOT NULL,         -- JSON: Raw API response
  normalized_data TEXT NOT NULL,       -- JSON: Normalized structure

  -- Processing status
  processing_status TEXT NOT NULL,     -- 'pending' | 'processed' | 'failed' | 'ignored'
  processed_at TEXT,
  processing_error TEXT,

  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

**Purpose**: Store unprocessed transaction data from sources. Scoped by account.

### Data Relationships

```
users (1) ──────< accounts (N) ───────< accounts (N, children)
                      │
                      │ (1)
                      │
                      ├───< import_sessions (N)
                      │
                      │ (1)
                      │
                      └───< raw_transactions (N) ───> processed transactions
```

---

## Import Flow

### Regular Import (API/Single Address)

```typescript
// 1. User runs import command
// import --exchange kraken --api-key KEY ...

// 2. System lookups/creates account
const account = await accountRepo.findOrCreate({
  accountType: 'exchange-api',
  sourceName: 'kraken',
  identifier: 'KEY',
  credentials: { apiKey: 'KEY', apiSecret: '...' },
});

// 3. System creates a single import session (via ImportService)
const session = await importService.importFromSource(account);
// - Creates session (status='started')
// - Fetches and saves raw_transactions
// - Updates account.last_cursor
// - Finalizes session (status='completed')
```

### Xpub Import (Hierarchical)

```typescript
// 1. User runs import command for xpub
// import --blockchain bitcoin --address xpub...

// 2. System creates Parent Account
const parentAccount = await accountRepo.findOrCreate({
  identifier: 'xpub...',
  accountType: 'blockchain',
  ...
});

// 3. System derives addresses & creates Child Accounts
const addresses = await provider.deriveAddresses(xpub...);
const childAccounts = [];
for (const addr of addresses) {
  const child = await accountRepo.findOrCreate({
    parentAccountId: parentAccount.id,
    identifier: addr,
    accountType: 'blockchain',
    ...
  });
  childAccounts.push(child);
}

// 4. System imports each child account individually
const sessions = [];
for (const child of childAccounts) {
  // Delegate to standard import service
  const session = await importService.importFromSource(child);
  sessions.push(session);
}

// Returns array of sessions
```

### Incremental Import

Same flow:

1. Lookup existing account (parent or child).
2. Create NEW session.
3. Use `account.last_cursor` to resume fetching.
4. Save only new transactions to `raw_transactions`.

---

## Use Cases

### Use Case 1: Multiple Accounts on Same Exchange

**Scenario**: User has personal and business Kraken accounts

- Account 1: `identifier`='API_KEY_1', `credentials`={...key1...}
- Account 2: `identifier`='API_KEY_2', `credentials`={...key2...}
- Account 3: `identifier`='path/to/csv', `account_type`='exchange-csv'

All coexist for `user_id=1`.

### Use Case 2: xpub Import with Address Discovery

**Scenario**: User imports Bitcoin xpub.

1. **Parent Account** created for `xpub...`.
2. **Derivation**: Provider finds used addresses `bc1qA...`, `bc1qB...`.
3. **Child Accounts** created for `bc1qA...` and `bc1qB...` with `parent_account_id` mapped to Parent Account.
4. **Import**: Loop runs for `bc1qA...` (Session #101), then `bc1qB...` (Session #102).
5. **Cursors**: `bc1qA...` stores its own cursor; `bc1qB...` stores its own cursor.

This allows granular tracking and distinct cursors per address, which is robust for blockchains like Cardano where addresses are distinct entities.

### Use Case 3: Investigation

**Scenario**: User tracks scammer wallet.

- Account created with `user_id`=NULL.
- Import sessions run normally.
- Data isolated from user's main portfolio views.

---

## Consequences

### Benefits

1. **Granularity**: xpub hierarchy allows tracking status per address.
2. **Robustness**: Parent/Child model handles address gap limits and individual address failures gracefully.
3. **Auditability**: `transactions_skipped` tracks duplicates explicitly.
4. **Consistency**: Same `importService` logic used for single addresses and xpub children.

### Costs

1. **More Account Records**: One record per derived address instead of just one per xpub.
2. **Import Overhead**: Multiple sessions created for a single "logical" xpub import.

### Design Patterns

1. **Composite Pattern**: xpub account acts as a composite of child address accounts.
2. **Event Sourcing Lite**: Sessions and raw transactions provide a history of what happened.
