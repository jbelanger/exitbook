## Based on my analysis of the data package, here are the naming findings:

Dimension 1: Domain Concepts & Types
1.1 Filter Type Naming Confusion
What exists:

- TransactionFilters, FullTransactionFilters, SummaryTransactionFilters (transaction-queries.ts:29-49)
- LoadRawDataFilters (raw-data-queries.ts:15-22)
  Why it hurts:
  The word "Filter" is used inconsistently across the codebase. TransactionFilters is a query parameter type, but LoadRawDataFilters uses "Load" in the name. This creates cognitive overhead when deciding which type to use.
  Proposed rename:

* TransactionFilters → TransactionQueryParams (clarifies it's query params, not DB filters)
* LoadRawDataFilters → RawDataQueryParams (removes "load", consistent with other query params)
  Surface: ~5 files affected (query files, tests)

---

1.2 TransactionSummary Misleading Name
What exists:
TransactionSummary interface (transaction-queries.ts:54-69)
Why it hurts:
The name implies it's a computed aggregate (like "total transactions"), but it's actually a lightweight projection that omits movements/fees. Callers may expect aggregated data.
Proposed rename:

- TransactionSummary → TransactionProjection or TransactionListItem
  Evidence:

* getTransactions(filters: SummaryTransactionFilters) returns TransactionSummary[]
* Used when user wants a "summary view" without full transaction data
  Surface: ~8 files

---

Dimension 2: Functions & Methods
2.1 Inconsistent Verb Choice: load vs get
What exists:

- raw-data-queries.ts: load(), loadPendingByHashBatch(), load(filters?)
- transaction-queries.ts: getTransactions(), findById(), findTransactionsNeedingPrices()
  Why it hurts:
  The same conceptual operation (reading from DB) uses different verbs across modules. load implies fetching from external source, while get implies retrieving. Both should be consistent.
  Proposed rename:

* load → get in raw-data-queries.ts for consistency
* Keep loadPendingByHashBatch or rename to getPendingByHashBatch
  Evidence:

- raw-data-queries.ts:27 - async function load(filters?: LoadRawDataFilters)
- transaction-queries.ts:425 - async function getTransactions(...)
  Surface: ~15 call-sites across ingestion, CLI, and tests

---

2.2 Verbose findByUniqueConstraint
What exists:
findByUniqueConstraint method (account-queries.ts:94-126)
Why it hurts:
The name is technically accurate but verbose. At call-sites, it's not immediately clear what constraint it's finding by without reading the implementation.
Proposed rename:

- findByUniqueConstraint → findByKey or findByAccountKey
  Evidence:

* Called with (accountType, sourceName, identifier, userId) - these form the unique key
  Surface: ~3 files (account-queries.ts, tests)

---

2.3 Ambiguous mapRawTransactionRow
What exists:
mapRawTransactionRow function (query-utils.ts:118-148)
Why it hurts:
"map" is overloaded - could mean transform or could mean Map collection. The function actually transforms a DB row to a domain object.
Proposed rename:

- mapRawTransactionRow → toRawTransaction (consistent with toAccount, toUser patterns in this package)
  Evidence:

* account-queries.ts:43 uses toAccount
* user-queries.ts:13 uses toUser
* This transform function should follow the same pattern
  Surface: ~6 files

---

2.4 Inconsistent count Method Names
What exists:

- transaction-queries.ts:624 - countTransactions(filters?)
- raw-data-queries.ts:203 - count(filters?)
- raw-data-queries.ts:221 - countPending(accountId)
- raw-data-queries.ts:235 - countByStreamType(accountId)
  Why it hurts:
  The count method in raw-data-queries takes optional filters, but there's no prefix to clarify what's being counted. countPending and countByStreamType are clearer but the base count is ambiguous.
  Proposed rename:

* rawDataQueries.count(filters?) → rawDataQueries.countAll(filters?)
  Surface: ~4 files

---

2.5 Unusual ensureDefaultUser
What exists:
ensureDefaultUser (user-queries.ts:55-81)
Why it hurts:
"ensure" suggests idempotency (create if not exists), which is correct. But the name doesn't convey that it's specifically for CLI/default user bootstrapping.
Proposed rename:

- ensureDefaultUser → getOrCreateDefaultUser (more explicit about the operation)
  Surface: ~3 files

---

Dimension 3: Variables & Parameters
3.1 Generic items in Batch Operations
What exists:
Local variable items in raw-data-queries.ts:101-168
Why it hurts:
Inside saveBatch, the parameter is items: RawTransactionInput[]. "items" is low-signal - could be anything.
Proposed rename:

- items → transactions or rawTransactions
  Evidence:

* Method is saveBatch(accountId, items) but saves raw transactions
* Context is clear from method signature but transactions would be more explicit
  Surface: 1 file, internal only

---

3.2 Local Shadowing in Raw Data Queries
What exists:
raw-data-queries.ts:60 - variable named transactions shadows potential import
Why it hurts:
The function load returns RawTransaction[] but internally uses variable named transactions. While not technically shadowing an import, it conflates "raw transactions" with generic transactions.
Proposed rename:

- Internal loop variable in load() → rawTransactions
  Surface: 1 file

---

Dimension 5: Files & Modules
5.1 Generic sqlite-utils.ts
What exists:
sqlite-utils.ts (queries/sqlite-utils.ts)
Why it hurts:
The file contains formatDateForSqlite and createSqliteDateString. These are SQLite-specific utilities that could be more appropriately named.
Proposed rename:

- sqlite-utils.ts → date-utils.ts (or move these to query-utils if only used in queries)
  Evidence:

* Only 2 functions, both date-related
* May belong in query-utils.ts instead
  Surface: ~3 files importing from this path

---

5.2 Token Metadata Split Persistence
What exists:
Two separate persistence directories:

- persistence/token-metadata/ (separate DB for token metadata)
- Main storage in storage/
  Why it hurts:
  The package has two different "persistence" concepts - main DB queries and separate token metadata persistence. This is architecturally fine but the naming could clarify the distinction.
  Proposed rename:

* Consider renaming persistence/token-metadata/ → caching/token-metadata/ to clarify it's a cache, not core data
  Note: This may be intentional design (caching layer), so verify before renaming.

---

Rename Decision Summary
| Rank | Rename | Dimension | Leverage | Risk | One-line Rationale |
|------|--------|-----------|----------|------|-------------------|
| 1 | load → get in raw-data-queries | Functions | High | Low | Consistency with transaction-queries |
| 2 | mapRawTransactionRow → toRawTransaction | Functions | High | Low | Matches existing toAccount, toUser pattern |
| 3 | TransactionSummary → TransactionListItem | Types | Medium | Low | Clarifies it's a projection, not aggregation |
| 4 | findByUniqueConstraint → findByKey | Functions | Medium | Low | Reduces verbosity, still clear |
| 5 | LoadRawDataFilters → RawDataQueryParams | Types | Medium | Low | Consistent with other query params |
| 6 | TransactionFilters → TransactionQueryParams | Types | Medium | Low | Clarifies purpose |
| 7 | sqlite-utils.ts → date-utils.ts | Files | Low | Medium | Verify all usages first |

---

Names That Should Stay

- createTransactionQueries, createAccountQueries - Clear factory pattern
- createRawDataQueries, createUserQueries - Consistent factory pattern
- withControlledTransaction - Accurately describes behavior
- serializeToJson, parseWithSchema - Clear utility purposes
- FindOrCreateAccountParams, UpdateAccountParams - Clear parameter object names
- toAccount (in account-queries.ts) - Consistent transformation naming
- save / saveBatch - Clear operation names
- findById, findAll - Standard query method names
- OverrideStore - Clear domain concept
