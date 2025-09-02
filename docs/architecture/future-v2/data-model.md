# Data Model Architecture

## Overview

The system implements a **multi-tenant double-entry ledger** model using NestJS and Drizzle ORM to ensure data integrity and accurate balance calculations. This approach treats every financial operation as a transaction composed of multiple balanced entries, with all data scoped by user for complete data isolation.

**Key Architectural Features:**

- Multi-tenant architecture with user-scoped data isolation
- NestJS framework with Drizzle ORM for type-safe database operations
- CQRS pattern with focused command/query handlers
- Provider registry system with circuit breakers for multi-provider resilience
- ETL pipeline: Importers → Processors → Ledger transformation
- Clean separation between raw data import and ledger recording

## Core Principles

1. **Multi-Tenancy**: All data is scoped by `userId` for complete data isolation between users
2. **Double-Entry Accounting**: Every transaction consists of entries that must sum to zero per currency
3. **Precision**: All monetary amounts stored as integers in smallest currency units (satoshis, wei, cents)
4. **Immutability**: Financial records are never updated, only new correcting transactions are created
5. **Auditability**: Complete trail of all financial movements with full traceability
6. **User Context**: Every command, query, and repository operation must include user context

## Database Schema

**Note**: For complete implementation using NestJS and Drizzle ORM, see [v2.md](./v2.md#database-schema). This document focuses on the conceptual data model with SQL examples showing multi-tenant structure.

### Users Table

**Foundation table** for multi-tenant user management.

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255),
  is_active BOOLEAN DEFAULT TRUE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

### Currencies Table

**Global foundation table** containing asset metadata and precision information, **shared across all users**.

```sql
-- Create enum for asset classes
CREATE TYPE asset_class_enum AS ENUM ('CRYPTO', 'FIAT', 'NFT', 'STOCK');

CREATE TABLE currencies (
  id SERIAL PRIMARY KEY,
  ticker VARCHAR(20) UNIQUE NOT NULL,   -- 'BTC', 'ETH', 'USDC' (normalized uppercase)
  name VARCHAR(100) NOT NULL,           -- 'Bitcoin', 'Ethereum', 'USD Coin'
  decimals INTEGER NOT NULL,            -- Precision (8 for BTC, 18 for ETH, 6 for USDC)
  asset_class asset_class_enum NOT NULL, -- Enum for asset classification
  network VARCHAR(50),                  -- 'ethereum', 'bitcoin', 'solana', 'polygon'
  contract_address VARCHAR(100),        -- ERC-20 token address (for tokens)
  is_native BOOLEAN DEFAULT FALSE,      -- TRUE for ETH, BTC, SOL (not tokens)
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_currencies_ticker ON currencies(ticker);
CREATE INDEX idx_currencies_network ON currencies(network);

-- Global default currencies seeded once
INSERT INTO currencies (ticker, name, decimals, asset_class, network, is_native) VALUES
  ('BTC', 'Bitcoin', 8, 'CRYPTO', 'bitcoin', TRUE),
  ('ETH', 'Ethereum', 18, 'CRYPTO', 'ethereum', TRUE),
  ('USDC', 'USD Coin', 6, 'CRYPTO', 'ethereum', FALSE),
  ('SOL', 'Solana', 9, 'CRYPTO', 'solana', TRUE),
  ('USD', 'US Dollar', 2, 'FIAT', NULL, TRUE);
```

### Accounts Table

Represents different "buckets" where value can be held, **scoped by user** with references to global currencies.

```sql
-- Create enum for account types
CREATE TYPE account_type_enum AS ENUM (
  'ASSET_WALLET',
  'ASSET_EXCHANGE',
  'ASSET_DEFI_LP',
  'LIABILITY_LOAN',
  'EQUITY_OPENING_BALANCE',
  'EQUITY_MANUAL_ADJUSTMENT',
  'INCOME_STAKING',
  'INCOME_TRADING',
  'INCOME_AIRDROP',
  'INCOME_MINING',
  'EXPENSE_FEES_GAS',
  'EXPENSE_FEES_TRADE'
);

CREATE TABLE accounts (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL,               -- Multi-tenant: scoped by user
  name VARCHAR(255) NOT NULL,          -- Human-readable name
  currency_id INTEGER NOT NULL,        -- Foreign key to currencies table
  account_type account_type_enum NOT NULL, -- Enum for granular account types
  network VARCHAR(50),                 -- 'mainnet', 'testnet', 'polygon', 'arbitrum'
  external_address VARCHAR(255),       -- Wallet address or exchange account ID
  source VARCHAR(50),                  -- Data source (e.g., 'kraken', 'bitcoin', 'manual')
  parent_account_id INTEGER,           -- For sub-accounts, LP positions
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (currency_id) REFERENCES currencies(id) ON DELETE RESTRICT,
  FOREIGN KEY (parent_account_id) REFERENCES accounts(id)
);

CREATE INDEX idx_accounts_user_id ON accounts(user_id);
CREATE INDEX idx_accounts_user_currency ON accounts(user_id, currency_id);

-- Account type categorization:
--   Assets: 'ASSET_WALLET', 'ASSET_EXCHANGE', 'ASSET_DEFI_LP'
--   Liabilities: 'LIABILITY_LOAN'
--   Equity: 'EQUITY_OPENING_BALANCE', 'EQUITY_MANUAL_ADJUSTMENT'
--   Income: 'INCOME_STAKING', 'INCOME_TRADING', 'INCOME_AIRDROP', 'INCOME_MINING'
--   Expenses: 'EXPENSE_FEES_GAS', 'EXPENSE_FEES_TRADE'
```

### Ledger Transactions Table

Container for financial events, **scoped by user**. Acts as a grouping mechanism for related entries.

```sql
CREATE TABLE ledger_transactions (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL,              -- Multi-tenant: scoped by user
  external_id VARCHAR(255) NOT NULL,  -- Original hash/ID from source
  source VARCHAR(50) NOT NULL,        -- 'kraken', 'bitcoin', 'uniswap', etc.
  description TEXT NOT NULL,           -- Human-readable description
  transaction_date TIMESTAMP WITH TIME ZONE NOT NULL,  -- Event timestamp (timezone-aware)
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  -- User-scoped unique constraint for idempotency
  UNIQUE(user_id, external_id, source)
);

CREATE INDEX idx_ledger_tx_user_date ON ledger_transactions(user_id, transaction_date);
CREATE INDEX idx_ledger_tx_user_source ON ledger_transactions(user_id, source);
```

### Entries Table (Core Ledger)

Records actual movement of funds, **scoped by user**. **Sum of amounts for all entries in a transaction must equal zero PER CURRENCY.**

```sql
-- Create enums for entries table
CREATE TYPE direction_enum AS ENUM ('CREDIT', 'DEBIT');
CREATE TYPE entry_type_enum AS ENUM (
  'TRADE', 'DEPOSIT', 'WITHDRAWAL', 'FEE', 'REWARD', 'STAKING',
  'AIRDROP', 'MINING', 'LOAN', 'REPAYMENT', 'TRANSFER', 'GAS'
);

CREATE TABLE entries (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL,              -- Multi-tenant: scoped by user
  transaction_id INTEGER NOT NULL,
  account_id INTEGER NOT NULL,
  currency_id INTEGER NOT NULL,        -- Explicit currency reference for multi-currency validation
  amount BIGINT NOT NULL,              -- Amount in currency's smallest unit (using BIGINT for precision)
  direction direction_enum NOT NULL,   -- Enum for 'CREDIT' (+) or 'DEBIT' (-) - explicit for clarity
  entry_type entry_type_enum NOT NULL, -- Enum for enhanced entry types (required for financial reporting)
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (transaction_id) REFERENCES ledger_transactions(id) ON DELETE CASCADE,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE RESTRICT,
  FOREIGN KEY (currency_id) REFERENCES currencies(id) ON DELETE RESTRICT
);

-- Critical indexes for multi-tenant performance
CREATE INDEX idx_entries_user_id ON entries(user_id);
CREATE INDEX idx_entries_user_account_currency ON entries(user_id, account_id, currency_id);
CREATE INDEX idx_entries_transaction ON entries(transaction_id);
CREATE INDEX idx_entries_currency ON entries(currency_id);
```

### Blockchain Transaction Details Table

Structured storage for blockchain-specific transaction data with optimized query performance.

```sql
-- Create enum for blockchain transaction status
CREATE TYPE blockchain_status_enum AS ENUM ('pending', 'confirmed', 'failed');

CREATE TABLE blockchain_transaction_details (
  transaction_id INTEGER PRIMARY KEY,     -- One-to-one relationship with ledger_transactions
  tx_hash VARCHAR(100) UNIQUE NOT NULL,  -- Blockchain transaction hash
  block_height INTEGER,                  -- Block number (NULL for pending transactions)
  status blockchain_status_enum NOT NULL, -- Enum for transaction status
  gas_used INTEGER,                      -- Gas consumed (for EVM chains)
  gas_price BIGINT,                      -- Gas price in smallest unit (gwei for ETH) - BIGINT to prevent overflow
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (transaction_id) REFERENCES ledger_transactions(id) ON DELETE CASCADE
);

-- Indexes for common query patterns
CREATE INDEX idx_blockchain_tx_hash ON blockchain_transaction_details(tx_hash);
CREATE INDEX idx_blockchain_status ON blockchain_transaction_details(status);
CREATE INDEX idx_blockchain_block_height ON blockchain_transaction_details(block_height);
```

### Exchange Transaction Details Table

Structured storage for exchange-specific transaction data.

```sql
-- Create enum for trade sides
CREATE TYPE trade_side_enum AS ENUM ('buy', 'sell');

CREATE TABLE exchange_transaction_details (
  transaction_id INTEGER PRIMARY KEY,     -- One-to-one relationship with ledger_transactions
  order_id VARCHAR(100),                 -- Exchange order ID
  trade_id VARCHAR(100),                 -- Specific trade ID (for partial fills)
  symbol VARCHAR(20),                    -- Trading pair (BTC/USD)
  side trade_side_enum,                  -- Enum for 'buy' or 'sell'
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (transaction_id) REFERENCES ledger_transactions(id) ON DELETE CASCADE
);
```

### Transaction Metadata Table

Flexible storage for additional transaction data and edge cases not covered by structured tables.

```sql
-- Create enum for metadata data types
CREATE TYPE metadata_type_enum AS ENUM ('string', 'number', 'json', 'boolean');

CREATE TABLE transaction_metadata (
  id SERIAL PRIMARY KEY,
  transaction_id INTEGER NOT NULL,
  key VARCHAR(100) NOT NULL,
  value TEXT NOT NULL,
  data_type metadata_type_enum NOT NULL, -- Enum for data type validation
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (transaction_id) REFERENCES ledger_transactions(id) ON DELETE CASCADE,
  UNIQUE(transaction_id, key)
);

-- Use for less common or source-specific metadata:
-- ('contract_address', '0x1234...', 'string')
-- ('slippage', '0.5', 'number')
-- ('dex_protocol', 'uniswap_v3', 'string')
```

## Example: Multi-Tenant Cryptocurrency Trade

**Scenario**: User buys 0.5 ETH for 1000 USDC with 5 USDC fee on Coinbase

### Key Multi-Tenant Considerations:

1. **User Context**: All operations include `userId = 'user-123'`
2. **User-Scoped Accounts**: Accounts belong to specific user
3. **User-Scoped Currencies**: User has their own currency definitions
4. **User-Scoped Idempotency**: Transaction uniqueness per user

### Conceptual Ledger Entries:

```
Transaction: Buy 0.5 ETH with USDC (user-123)
├── Entry 1: +0.5 ETH        → User's ETH Exchange Account       (CREDIT/TRADE)
├── Entry 2: -1000 USDC      → User's USDC Exchange Account     (DEBIT/TRADE)
├── Entry 3: -5 USDC         → User's USDC Exchange Account     (DEBIT/FEE)
└── Entry 4: +5 USDC         → User's USDC Fee Expense Account  (CREDIT/FEE)

Balance Verification (per currency):
✓ ETH: +0.5 ETH = +0.5 ETH (balances)
✓ USDC: -1000 USDC + -5 USDC + 5 USDC = -1000 USDC (balances)
```

**Notes**:

- All amounts stored as integers in smallest currency units (wei for ETH, micro-USDC for USDC)
- The "Fee Expense Account" is of type `EXPENSE_FEES_TRADE`, following proper accounting principles where fees are recorded as expenses

## Complex Transaction Examples

### DeFi Uniswap Trade with Multiple Tokens

**Scenario**: Swap 1 ETH → 2000 USDC + 10 governance tokens, pay 0.02 ETH gas

```sql
-- Ledger entries
INSERT INTO entries (user_id, transaction_id, account_id, amount, direction, entry_type) VALUES
  ('user-123', 2, eth_account, -1000000000000000000, 'DEBIT', 'TRADE'),     -- -1 ETH
  ('user-123', 2, usdc_account, 2000000000, 'CREDIT', 'TRADE'),             -- +2000 USDC
  ('user-123', 2, gov_token_account, 10000000000000000000, 'CREDIT', 'REWARD'), -- +10 tokens
  ('user-123', 2, eth_account, -20000000000000000, 'DEBIT', 'GAS'),         -- -0.02 ETH gas
  ('user-123', 2, gas_expense_account, 20000000000000000, 'CREDIT', 'GAS');    -- +gas to expense account (EXPENSE_FEES_GAS)

-- Blockchain details
INSERT INTO blockchain_transaction_details (transaction_id, tx_hash, block_height, status, gas_used, gas_price) VALUES
  (2, '0xabc123...', 18450000, 'confirmed', 150000, 20000000000);
```

### Cross-Chain Bridge

**Scenario**: Bridge 100 USDC from Ethereum to Polygon

```sql
-- Transaction 1: Lock on Ethereum
INSERT INTO entries (user_id, transaction_id, account_id, amount, direction, entry_type) VALUES
  ('user-123', 3, eth_usdc_account, -100000000, 'DEBIT', 'TRANSFER'),       -- -100 USDC
  ('user-123', 3, bridge_escrow_account, 100000000, 'CREDIT', 'TRANSFER');  -- +100 to escrow

-- Transaction 2: Mint on Polygon (separate transaction)
INSERT INTO entries (user_id, transaction_id, account_id, amount, direction, entry_type) VALUES
  ('user-123', 4, bridge_escrow_account, -100000000, 'DEBIT', 'TRANSFER'),  -- -100 from escrow
  ('user-123', 4, polygon_usdc_account, 100000000, 'CREDIT', 'TRANSFER');   -- +100 USDC on Polygon
```

## Balance Calculations (Multi-Tenant)

All balance queries must include user context for data isolation.

### Current Balance with Currency Metadata

```sql
SELECT
  a.name,
  c.ticker,
  c.decimals,
  COALESCE(SUM(e.amount), 0) as balance_raw,
  -- Convert to human-readable format
  CAST(COALESCE(SUM(e.amount), 0) AS DECIMAL) / POW(10, c.decimals) as balance_formatted
FROM accounts a
LEFT JOIN entries e ON a.id = e.account_id AND e.user_id = $1  -- User-scoped join
INNER JOIN currencies c ON a.currency_id = c.id
WHERE a.user_id = $1          -- Critical: Filter by user
  AND c.ticker = 'BTC'
GROUP BY a.id, a.name, c.ticker, c.decimals
HAVING COALESCE(SUM(e.amount), 0) != 0;  -- Only non-zero balances
```

### Balance at Specific Date

```sql
SELECT
  a.name,
  c.ticker,
  c.decimals,
  COALESCE(SUM(e.amount), 0) as balance_at_date,
  CAST(COALESCE(SUM(e.amount), 0) AS DECIMAL) / POW(10, c.decimals) as formatted_balance
FROM accounts a
LEFT JOIN entries e ON a.id = e.account_id AND e.user_id = $1  -- User-scoped join
LEFT JOIN ledger_transactions t ON e.transaction_id = t.id AND t.user_id = $1  -- User-scoped join
INNER JOIN currencies c ON a.currency_id = c.id
WHERE a.user_id = $1          -- Critical: Filter by user
  AND c.ticker = 'ETH'
  AND t.transaction_date <= '2024-01-01 23:59:59+00'
GROUP BY a.id, a.name, c.ticker, c.decimals;
```

### Portfolio Summary by Currency

```sql
SELECT
  c.ticker,
  c.name as currency_name,
  c.decimals,
  COUNT(DISTINCT a.id) as account_count,
  COALESCE(SUM(e.amount), 0) as total_balance_raw,
  CAST(COALESCE(SUM(e.amount), 0) AS DECIMAL) / POW(10, c.decimals) as total_balance_formatted
FROM currencies c
LEFT JOIN accounts a ON c.id = a.currency_id AND a.user_id = $1  -- User-scoped join
LEFT JOIN entries e ON a.id = e.account_id AND e.user_id = $1    -- User-scoped join
GROUP BY c.id, c.ticker, c.name, c.decimals
HAVING COALESCE(SUM(e.amount), 0) != 0
ORDER BY c.ticker;
```

### Account Transaction History with Currency Context

```sql
SELECT
  t.transaction_date,
  t.description,
  c.ticker,
  c.decimals,
  e.amount,
  e.direction,
  e.entry_type,
  CAST(e.amount AS DECIMAL) / POW(10, c.decimals) as formatted_amount,
  btd.tx_hash,
  btd.block_height,
  btd.status,
  SUM(e.amount) OVER (ORDER BY t.transaction_date) as running_balance_raw,
  CAST(SUM(e.amount) OVER (ORDER BY t.transaction_date) AS DECIMAL) / POW(10, c.decimals) as running_balance_formatted
FROM entries e
JOIN ledger_transactions t ON e.transaction_id = t.id AND t.user_id = $1  -- User-scoped join
JOIN accounts a ON e.account_id = a.id AND a.user_id = $1                -- User-scoped join
JOIN currencies c ON a.currency_id = c.id                              -- Global currency join
LEFT JOIN blockchain_transaction_details btd ON t.id = btd.transaction_id
WHERE e.user_id = $1          -- Critical: Filter by user
  AND a.id = $2               -- Account parameter
ORDER BY t.transaction_date;
```

### Find Transaction by Hash (High Performance)

```sql
SELECT
  t.*,
  btd.block_height,
  btd.status
FROM ledger_transactions t
JOIN blockchain_transaction_details btd ON t.id = btd.transaction_id
WHERE t.user_id = $1          -- Critical: Filter by user
  AND btd.tx_hash = $2;       -- Transaction hash parameter
```

## Data Integrity Constraints

### Application-Level Validation (V2 Architecture)

**Critical Architecture Decision**: Transaction balance validation occurs in the **application layer** using NestJS Command Handlers, not database triggers.

**Why Application-Level?**

- Database triggers fire after each individual entry insert, causing validation failures
- Multi-entry transactions require atomic validation of the complete entry set
- Application-level validation provides better error handling and user feedback

### Repository-Level Validation

**Application-Level Implementation**: Transaction validation occurs in NestJS Command Handlers before database operations.

**Key Validation Rules**:

1. **Balance Validation**: All entries must sum to zero per currency per user
2. **User Ownership**: User must own all referenced accounts and currencies
3. **Atomic Operations**: All validation occurs within database transactions
4. **Multi-Currency Support**: Each currency balances independently

```

### Multi-Tenant Considerations

**User Context Requirements**:
- All operations must include `user_id` parameter
- All repository methods are user-scoped
- Unique constraints are per-user (e.g., external transaction IDs)
- Indexes optimize for user-scoped queries

**Idempotency**: Transaction uniqueness is enforced per-user using `(user_id, external_id, source)` constraints.

**Entry Types**: Support granular categorization for financial reporting:
- `TRADE`: Buy/sell operations
- `DEPOSIT`/`WITHDRAWAL`: Funds movement
- `FEE`/`GAS`: Transaction costs
- `REWARD`/`STAKING`/`AIRDROP`/`MINING`: Income sources
- `LOAN`/`REPAYMENT`: Lending operations
- `TRANSFER`: Internal movements

**Critical Rule**: Sum of amounts for all entries in a transaction must equal zero **per currency per user**.
```

## Benefits of This Multi-Tenant Ledger Model

1. **Complete Data Isolation**: Multi-tenant architecture ensures users cannot access each other's data
2. **Scalable Architecture**: User-scoped queries and indexes optimize for multi-tenant performance
3. **Multi-Currency Precision**: Proper decimal handling per asset type with no precision loss
4. **Data Normalization**: Currency metadata centralized globally, preventing inconsistencies
5. **Accurate Balance Calculations**: Simple SUM() operations with currency and user context
6. **Natural CSV Import Mapping**: Each CSV row maps to user-scoped ledger entries with proper currency resolution
7. **Enhanced Audit Trail**: Complete history with currency metadata, user context, and timezone awareness
8. **Flexibility**: Handles complex multi-currency operations (DEX swaps, bridges, etc.) per user
9. **Multi-Currency Integrity**: Application-level validation ensures mathematical correctness per currency per user
10. **Granular Account Types**: Enables detailed financial reporting and categorization per user
11. **Performance**: User-optimized indexes for common query patterns (user+account+currency, user+currency aggregations)
12. **Immutability**: Financial records are never modified, only added to with user context
13. **Query Performance**: Structured tables for blockchain/exchange data with efficient global currency joins
14. **Type Safety**: Strongly typed currency references with global foreign key constraints
15. **Separation of Concerns**: Core ledger remains source-agnostic while global currency table handles asset specifics
16. **Future-Proof**: Easy to add new assets, networks, and account types per user
17. **Reporting Ready**: Account type granularity enables per-user P&L statements and tax reporting
18. **User Context Security**: Every operation requires user context, preventing cross-tenant data access
19. **Scalable Multi-Tenancy**: Efficient user-scoped indexes support thousands of concurrent users
20. **CQRS Integration**: Clean separation of read/write operations with user context built-in

## Migration from Single-Entry Model

The current `UniversalTransaction` model can be transformed to this enhanced multi-currency ledger model:

```typescript
async function transformToLedger(tx: UniversalTransaction): Promise<LedgerTransaction> {
  const entries: LedgerEntry[] = [];

  // Resolve currencies first
  const mainCurrency = await getCurrency(tx.symbol);
  if (!mainCurrency) {
    throw new Error(`Currency ${tx.symbol} not found`);
  }

  // Main transaction amount
  const mainAccount = await getOrCreateAccount(tx.symbol, tx.source, 'ASSET_EXCHANGE');
  const rawAmount = convertToRawAmount(tx.amount, mainCurrency.decimals);

  entries.push({
    accountId: mainAccount.id,
    currencyId: mainCurrency.id,
    amount: tx.side === 'buy' ? rawAmount : -rawAmount,
    direction: tx.side === 'buy' ? 'CREDIT' : 'DEBIT',
    entryType: 'TRADE',
  });

  // Counterparty amount (if trade)
  if (tx.price && tx.side && tx.quoteCurrency) {
    const quoteCurrency = await getCurrency(tx.quoteCurrency);
    if (!quoteCurrency) {
      throw new Error(`Quote currency ${tx.quoteCurrency} not found`);
    }

    const counterAmount = tx.amount * tx.price;
    const rawCounterAmount = convertToRawAmount(counterAmount, quoteCurrency.decimals);
    const counterAccount = await getOrCreateAccount(tx.quoteCurrency, tx.source, 'ASSET_EXCHANGE');

    entries.push({
      accountId: counterAccount.id,
      currencyId: quoteCurrency.id,
      amount: tx.side === 'buy' ? -rawCounterAmount : rawCounterAmount,
      direction: tx.side === 'buy' ? 'DEBIT' : 'CREDIT',
      entryType: 'TRADE',
    });
  }

  // Fee entry
  if (tx.fee) {
    const feeCurrency = await getCurrency(tx.fee.currency);
    if (!feeCurrency) {
      throw new Error(`Fee currency ${tx.fee.currency} not found`);
    }

    const rawFeeAmount = convertToRawAmount(tx.fee.amount, feeCurrency.decimals);
    const feeAccount = await getOrCreateAccount(tx.fee.currency, tx.source, 'EXPENSE_FEES_TRADE');
    const sourceAccount =
      tx.symbol === tx.fee.currency
        ? mainAccount
        : await getOrCreateAccount(tx.fee.currency, tx.source, 'ASSET_EXCHANGE');

    // Debit from source account
    entries.push({
      accountId: sourceAccount.id,
      currencyId: feeCurrency.id,
      amount: -rawFeeAmount,
      direction: 'DEBIT',
      entryType: 'FEE',
    });

    // Credit to fee expense account
    entries.push({
      accountId: feeAccount.id,
      currencyId: feeCurrency.id,
      amount: rawFeeAmount,
      direction: 'CREDIT',
      entryType: 'FEE',
    });
  }

  return {
    externalId: tx.id,
    source: tx.source,
    description: generateDescription(tx),
    transactionDate: new Date(tx.timestamp),
    entries,
  };
}

// Helper function to convert human amounts to raw amounts
function convertToRawAmount(amount: number, decimals: number): bigint {
  const multiplier = BigInt(10) ** BigInt(decimals);
  // Handle floating point precision by converting to string first
  const amountStr = amount.toFixed(decimals);
  const [whole, fraction = ''] = amountStr.split('.');
  const paddedFraction = fraction.padEnd(decimals, '0');
  return BigInt(whole + paddedFraction);
}
```

## Critical Architecture Decisions

### 1. Transaction Balance Validation Approach

**Decision**: Application-level validation within database transactions

**Rationale**: Database triggers for balance validation are logically flawed because they execute after each individual entry insert. In a multi-entry transaction, all entries except the last would fail validation, making the system unusable.

**Implementation**: Use application-level validation (see `LedgerRepository.createTransaction()` in greenfield strategy) that validates the complete set of entries before inserting any data.

### 2. Entry Type Field Nullability

**Decision**: `entry_type` column is `NOT NULL`

**Rationale**: This field is essential for financial reporting, categorization, and tax preparation. Making it optional would degrade the system's analytical capabilities.

### 3. Amount vs Direction Design

**Decision**: Retain both signed `amount` column AND `direction` enum

**Rationale**:

- Signed amounts enable efficient mathematical operations
- Direction enum provides semantic clarity in SQL queries and reporting
- Database trigger ensures consistency between the two fields
- Provides redundancy that catches data corruption issues

This hybrid approach balances computational efficiency with semantic clarity, despite the apparent redundancy.

```

```
