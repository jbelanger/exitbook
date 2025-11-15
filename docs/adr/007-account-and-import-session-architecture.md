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

Design a three-table architecture that separates user identity, account identity, and import execution:

1. **`users`**: Who is using the system
2. **`accounts`**: What accounts are being tracked (persistent identity and state)
3. **`import_sessions`**: Import execution history (temporal events)

### Core Principles

1. **Separation of identity and execution**:
   - Accounts = persistent entities ("I have a Kraken account")
   - Import sessions = temporal events ("I ran an import on Jan 15 at 3pm")

2. **One session per import run**:
   - Every import creates a new session record
   - Full audit trail of all attempts (success and failure)

3. **Account-level state**:
   - Resume cursors stored on account (survive crashes)
   - Balance verification stored on account (current state)
   - Derived addresses stored on account (xpub discovery)

4. **Explicit account types**:
   - Distinguish blockchain vs exchange
   - Distinguish exchange API vs CSV (different identifier semantics)

5. **Tracking vs ownership**:
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
  account_type TEXT NOT NULL,  -- 'blockchain' | 'exchange-api' | 'exchange-csv'
  source_name TEXT NOT NULL,   -- 'kraken', 'bitcoin', 'ethereum', etc.
  identifier TEXT NULLABLE,    -- address/xpub for blockchain, apiKey for api, NULL for csv
  provider_name TEXT,          -- preferred provider for blockchain imports
  derived_addresses TEXT,      -- JSON array for xpub wallets, NULL otherwise
  last_cursor TEXT,            -- JSON: Record<operationType, CursorState>
  last_balance_check_at TEXT,
  verification_metadata TEXT,  -- JSON
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT,

  -- One account per (type, source, identifier, user) combination
  CONSTRAINT idx_accounts_unique UNIQUE (
    account_type,
    source_name,
    COALESCE(identifier, ''),
    COALESCE(user_id, 0)
  )
);
```

**Purpose**: Represent a persistent account that can be imported multiple times

**Account Types:**

- **`blockchain`**: Cryptocurrency blockchain address or xpub
  - Examples: Bitcoin bc1q..., Ethereum 0x..., xpub6D4BDPc...
  - Identifier: the address or xpub
  - One account per address/xpub

- **`exchange-api`**: Exchange account accessed via API
  - Examples: Kraken API, KuCoin API, Coinbase API
  - Identifier: API key (uniquely identifies the account)
  - Multiple accounts per exchange (different API keys = different accounts)

- **`exchange-csv`**: Exchange account accessed via CSV files
  - Examples: Kraken CSV export, KuCoin CSV export
  - Identifier: NULL (no unique identifier available)
  - One CSV account per (exchange, user) pair

**Identifier Semantics:**

| Account Type | Identifier      | Example              | Uniqueness            |
| ------------ | --------------- | -------------------- | --------------------- |
| blockchain   | address or xpub | "bc1q...", "xpub..." | One per address/xpub  |
| exchange-api | API key         | "apiKey123..."       | One per API key       |
| exchange-csv | NULL            | NULL                 | One per exchange+user |

**State Fields:**

- **`derived_addresses`**: For xpub imports, stores discovered addresses as JSON array
  - Example: `["bc1q1...", "bc1q2...", "bc1q3..."]`
  - Updated when gap check discovers new addresses
  - NULL for regular (non-xpub) addresses

- **`last_cursor`**: Resume state for streaming imports
  - Format: `Record<operationType, CursorState>` as JSON
  - Example: `{"normal": {"page": 5, "totalFetched": 500}, "internal": {"page": 2, "totalFetched": 150}}`
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
  transactions_failed INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  error_details TEXT,  -- JSON
  import_result_metadata TEXT NOT NULL DEFAULT '{}',  -- JSON

  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);

CREATE INDEX idx_import_sessions_account_id ON import_sessions(account_id);
```

**Purpose**: Track each import execution as a discrete event

**One Session Per Import:**

- User runs `import --exchange kraken` → creates new session
- System runs scheduled import → creates new session
- Resume failed import → creates new session (cursor from account)

**Session States:**

- `started`: Import in progress
- `completed`: Import finished successfully
- `failed`: Import encountered an error
- `cancelled`: User cancelled import

**Result Tracking:**

- `transactions_imported`: How many transactions this session imported
- `transactions_failed`: How many failed validation
- `duration_ms`: How long the import took

**Metadata:**

- `import_result_metadata`: Arbitrary per-run data (provider failovers, warnings, etc.)
- `error_details`: Stack traces, API responses, debugging context

### Data Relationships

```
users (1) ──────< accounts (N)
                      │
                      │ (1)
                      │
                      ├───< import_sessions (N)
                      │           │
                      │           │ (1)
                      │           │
                      │           └───< external_transaction_data (N)
                      │                       │
                      │                       │ (1)
                      │                       │
                      └───────────────────────└───< transactions (N)
```

**Query patterns:**

- "Show all my accounts": `SELECT * FROM accounts WHERE user_id = 1`
- "Show import history for account": `SELECT * FROM import_sessions WHERE account_id = 5`
- "Which session created this transaction": `JOIN transactions → import_sessions → accounts`

---

## Import Flow

### Initial Import

```typescript
// 1. User runs import command
pnpm run dev import --exchange kraken --api-key KEY --api-secret SECRET

// 2. System lookups/creates account
const account = await accountRepo.findOrCreate({
  accountType: 'exchange-api',
  sourceName: 'kraken',
  identifier: hashApiKey(KEY), // or store API key directly
  userId: 1 // default CLI user
});
// Result: account.id = 5

// 3. System creates import session
const session = await sessionRepo.create({
  accountId: account.id,
  status: 'started'
});
// Result: session.id = 10

// 4. System imports data
const importer = createKrakenImporter(KEY, SECRET);
for await (const batch of importer.stream()) {
  // Save transactions to external_transaction_data (session.id = 10)
  await rawDataRepo.saveBatch(session.id, batch.transactions);

  // Update cursor on account (for crash recovery)
  await accountRepo.updateCursor(account.id, batch.operationType, batch.cursor);
}

// 5. System finalizes session
await sessionRepo.finalize(session.id, {
  status: 'completed',
  transactionsImported: 1000,
  durationMs: 45000
});
```

**Result:**

- Account #5 created: exchange-api, kraken, apiKey=KEY
- Session #10 created: account_id=5, imported=1000, status=completed
- 1000 external_transaction_data records: data_source_id=10

### Incremental Import (Same Account)

```typescript
// 1. User runs same import command next week
pnpm run dev import --exchange kraken --api-key KEY --api-secret SECRET

// 2. System finds existing account
const account = await accountRepo.findByIdentifier({
  accountType: 'exchange-api',
  sourceName: 'kraken',
  identifier: hashApiKey(KEY)
});
// Result: account.id = 5 (same account!)

// 3. System creates NEW session
const session = await sessionRepo.create({
  accountId: account.id,  // Same account
  status: 'started'
});
// Result: session.id = 11 (new session!)

// 4. System imports data (using cursor from account.last_cursor)
const resumeCursor = account.lastCursor;
const importer = createKrakenImporter(KEY, SECRET);
for await (const batch of importer.stream({ cursor: resumeCursor })) {
  // ... import new data
}

// 5. System finalizes session
await sessionRepo.finalize(session.id, {
  status: 'completed',
  transactionsImported: 50,  // Only 50 new transactions
  durationMs: 10000
});
```

**Result:**

- Account #5 (unchanged): existing account reused
- Session #11 created: account_id=5, imported=50, status=completed
- 50 new external_transaction_data records: data_source_id=11

**History:**

```sql
SELECT * FROM import_sessions WHERE account_id = 5 ORDER BY started_at;
-- Session #10: Jan 1, imported=1000, completed
-- Session #11: Jan 8, imported=50, completed
```

### Failed Import with Retry

**Principle**: One session = one user action. Auto-retries and crash recovery reuse the same session.

```typescript
// 1. User runs import
pnpm run dev import --exchange kraken --api-key KEY

// 2. Check for incomplete session (crash recovery)
let session = await sessionRepo.findIncomplete(accountId: 5);

if (!session) {
  // No incomplete session, create new
  session = await sessionRepo.create({ accountId: 5 });
  // Session #12 created
}

// 3. Import with automatic retries
const MAX_RETRIES = 3;
let retries = 0;

while (retries < MAX_RETRIES) {
  try {
    // Import 500 transactions...
    await importBatch();

    // Update cursor on account after each batch (crash recovery)
    await accountRepo.updateCursor(5, 'trade', { page: 5, totalFetched: 500 });

    // Success! Continue to next batch...

  } catch (err) {
    retries++;

    // Track retry in session metadata (not new session)
    await sessionRepo.updateMetadata(session.id, {
      retryAttempts: [
        ...(session.metadata.retryAttempts || []),
        {
          attempt: retries,
          error: err.message,
          timestamp: new Date().toISOString(),
          txsImported: 500
        }
      ]
    });

    if (retries >= MAX_RETRIES) {
      // Max retries exceeded, mark session as failed
      await sessionRepo.finalize(session.id, {
        status: 'failed',
        transactionsImported: 500,
        errorMessage: `Failed after ${retries} retries: ${err.message}`
      });
      throw err;
    }

    // Wait and retry (same session)
    await sleep(exponentialBackoff(retries));
  }
}

// 4. All batches complete
await sessionRepo.finalize(session.id, {
  status: 'completed',
  transactionsImported: 1000,
  durationMs: 45000
});
```

**Scenarios:**

**Scenario A: Transient network error (auto-retry succeeds)**

```javascript
// Session #12 metadata:
{
  retryAttempts: [
    { attempt: 1, error: 'timeout', timestamp: '2025-01-15T10:30:00Z', txsImported: 500 },
    { attempt: 2, success: true, timestamp: '2025-01-15T10:30:05Z' },
  ];
}
// Session #12 status: completed, imported=1000
```

Result: One session, retry details in metadata

**Scenario B: Crash mid-import (user restarts)**

```typescript
// First run: System crashes after 500 transactions
// Session #12: status='started', imported=500, cursor saved to account

// User restarts import command
const session = await sessionRepo.findIncomplete(accountId: 5);
// Found session #12 (incomplete)

// Resume from cursor
const cursor = await accountRepo.getCursor(5);
// cursor = { trade: { page: 5, totalFetched: 500 } }

// Continue importing from page 6...
// Finalize session #12 when done
```

Result: Same session #12 resumed, no orphaned sessions

**Scenario C: Persistent failure (max retries exceeded)**

```javascript
// Session #12 metadata:
{
  retryAttempts: [
    { attempt: 1, error: 'API rate limit', timestamp: '...', txsImported: 500 },
    { attempt: 2, error: 'API rate limit', timestamp: '...', txsImported: 500 },
    { attempt: 3, error: 'API rate limit', timestamp: '...', txsImported: 500 },
  ];
}
// Session #12 status: failed, error="Failed after 3 retries: API rate limit"

// User manually retries later (new user action = new session)
const newSession = await sessionRepo.create({ accountId: 5 });
// Session #13 created
```

Result: Session #12 failed with retry history, session #13 created for new attempt

---

## Use Cases

### Use Case 1: Multiple Accounts on Same Exchange

**Scenario**: User has personal and business Kraken accounts

```sql
-- Personal account (API)
INSERT INTO accounts (user_id, account_type, source_name, identifier)
VALUES (1, 'exchange-api', 'kraken', 'apiKey_personal');
-- account.id = 1

-- Business account (API, different key)
INSERT INTO accounts (user_id, account_type, source_name, identifier)
VALUES (1, 'exchange-api', 'kraken', 'apiKey_business');
-- account.id = 2

-- Business account (CSV, same exchange)
INSERT INTO accounts (user_id, account_type, source_name, identifier)
VALUES (1, 'exchange-csv', 'kraken', NULL);
-- account.id = 3

-- Query: Show all Kraken accounts
SELECT * FROM accounts WHERE source_name = 'kraken' AND user_id = 1;
-- Returns: 3 accounts (2 API, 1 CSV)

-- Query: Show balances for business API account only
SELECT t.* FROM transactions t
JOIN import_sessions s ON t.data_source_id = s.id
WHERE s.account_id = 2;
```

### Use Case 2: xpub Import with Address Discovery

**Scenario**: User imports Bitcoin xpub, gap check discovers more addresses

```sql
-- First import
INSERT INTO accounts (account_type, source_name, identifier, derived_addresses)
VALUES ('blockchain', 'bitcoin', 'xpub6D4BDPc...',
        '["bc1q1...", "bc1q2...", ..., "bc1q20..."]');
-- account.id = 10

-- Session created
INSERT INTO import_sessions (account_id, transactions_imported, status)
VALUES (10, 50, 'completed');
-- session.id = 20

-- Second import: gap check discovers 5 more addresses
UPDATE accounts SET
  derived_addresses = '["bc1q1...", ..., "bc1q25..."]'
WHERE id = 10;

-- New session created
INSERT INTO import_sessions (account_id, transactions_imported, status)
VALUES (10, 10, 'completed');
-- session.id = 21

-- Query: Which addresses are being tracked for this xpub?
SELECT derived_addresses FROM accounts WHERE id = 10;
-- Returns: ["bc1q1...", "bc1q2...", ..., "bc1q25..."]
```

### Use Case 3: Investigation (Tracking External Wallet)

**Scenario**: User tracks scammer wallet for analysis

```sql
-- Create account with user_id=NULL (not owned)
INSERT INTO accounts (user_id, account_type, source_name, identifier)
VALUES (NULL, 'blockchain', 'bitcoin', 'bc1qscammer...');
-- account.id = 15

-- Import session
INSERT INTO import_sessions (account_id, transactions_imported, status)
VALUES (15, 200, 'completed');

-- Query: Show only my accounts
SELECT * FROM accounts WHERE user_id = 1;
-- Does NOT include account #15

-- Query: Show all tracked accounts (mine + external)
SELECT * FROM accounts;
-- Includes account #15
```

### Use Case 4: Import History and Debugging

**Scenario**: Troubleshoot balance discrepancy

```sql
-- View all imports for account
SELECT
  s.id,
  s.started_at,
  s.status,
  s.transactions_imported,
  s.error_message
FROM import_sessions s
WHERE s.account_id = 5
ORDER BY s.started_at DESC;

-- Results:
-- Session 30: Jan 16, completed, 30 txs
-- Session 29: Jan 16, failed, 0 txs, "API timeout"
-- Session 28: Jan 15, completed, 0 txs
-- Session 27: Jan 8, completed, 50 txs
-- Session 26: Jan 1, completed, 1000 txs

-- Find which session created problematic transaction
SELECT s.* FROM import_sessions s
JOIN external_transaction_data e ON e.data_source_id = s.id
JOIN transactions t ON t.external_id = e.external_id
WHERE t.id = 12345;

-- Result: Session 27 on Jan 8
```

---

## Consequences

### Benefits

1. **Full audit trail**: Every import recorded, can debug issues retroactively
2. **Multi-account support**: Same exchange/blockchain, multiple accounts
3. **Investigation use case**: Track external wallets (user_id=NULL)
4. **Incremental tracking**: See exactly how data grew over time
5. **Crash recovery**: Cursors on account survive failures
6. **Future-proof**: Ready for multi-user web app

### Costs

1. **More records**: N sessions per account vs 1 record per account
2. **Slightly complex queries**: Need JOINs for account+session queries
3. **Migration needed**: If refactoring existing system

### Design Patterns

1. **Event sourcing lite**: Sessions are immutable events
2. **Entity-state separation**: Account (entity) vs session (event)
3. **Resume tokens**: Cursor state persisted on entity, not event
4. **One session per user action**: Auto-retries reuse session, manual retries create new session

### Session Lifecycle Management

**Normal flow:**

1. `started` → import in progress
2. `completed` or `failed` → import finished

**Incomplete session handling:**

- On import start: check for incomplete session (status='started')
- If found: resume it (don't create new)
- If not found: create new

**Stale session cleanup (optional):**

```typescript
// On app startup or scheduled job
const STALE_THRESHOLD = 24 * 60 * 60 * 1000; // 24 hours

// Find sessions stuck in 'started' state for >24 hours
const staleSessions = await sessionRepo.findStale({
  status: 'started',
  updatedBefore: Date.now() - STALE_THRESHOLD,
});

// Mark as failed (these were likely abandoned)
for (const session of staleSessions) {
  await sessionRepo.finalize(session.id, {
    status: 'failed',
    errorMessage: 'Session abandoned (stale)',
  });
}
```

**Why this works:**

- Normal crash/restart: resume within 24 hours
- Abandoned sessions: cleaned up after 24 hours
- No orphaned 'started' sessions polluting the table

---

## Implementation Notes

- Auto-create default user (id=1) on first CLI run
- Account lookup: exact match on (type, source, identifier, user_id)
- Session creation: always create new record (never update existing)
- Cursor updates: update account.last_cursor after each batch
- Foreign keys: external_transaction_data.data_source_id → import_sessions.id

---

## Future Extensions

- Account nicknames: `accounts.nickname` ("Personal Kraken", "Cold Storage")
- Account tags: Many-to-many table for categorization
- Session metadata: Provider failover details, rate limit info
- Balance caching: Materialized view of current balance per account
- Multi-user: Add users.email, authentication, account sharing
