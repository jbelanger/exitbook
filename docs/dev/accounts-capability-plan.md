# Accounts Capability Plan

This document defines the next architectural cleanup for account ownership.

It is subordinate to:

- `docs/code-assistants/architecture.md`

The goal is not to redesign every package in one pass.

The goal is:

- make `packages/accounts` the real owner of account behavior
- stop using `core` as the fallback home for account-domain policy
- remove the accidental split where account writes live in `ingestion` while
  account reads live in `accounts`
- keep `core` as a small shared kernel

## Goals

- Make `packages/accounts` own account-domain behavior and port vocabulary.
- Keep `packages/accounts` as the package that owns account queries and account
  hierarchy policy.
- Stop defining account CRUD and account hierarchy semantics inside
  `packages/ingestion`.
- Keep `packages/data` as an adapter package that implements accounts-owned
  ports.
- Move account-scope traversal out of `core` once `accounts` owns the relevant
  ports.

## Non-Goals

- Moving the `Account` type and `AccountSchema` out of `@exitbook/core` in this
  phase.
- Redesigning the database schema for accounts.
- Rewriting `accounts view` UI behavior beyond what is needed to consume the
  new package boundary.
- Creating a second package just for account queries.

## Current State

### 1. `packages/accounts` is a query package, not an account capability

Current files:

- `packages/accounts/src/account-query.ts`
- `packages/accounts/src/account-query-utils.ts`
- `packages/accounts/src/ports/account-query-ports.ts`

Current behavior:

- `packages/accounts` owns account summaries, account-view shaping, and account
  query ports.
- It does not own account lifecycle operations such as find-or-create, update,
  cursor updates, or hierarchy policy for other capabilities.

### 2. `ingestion` still owns write-side account vocabulary

Current files:

- `packages/ingestion/src/ports/import-ports.ts`
- `packages/data/src/adapters/import-ports-adapter.ts`

Current behavior:

- the import workflow defines its own account store interface
- import owns account creation, account lookup, metadata updates, and cursor
  updates
- this makes `ingestion` the write-side owner of accounts even though accounts
  are broader than ingestion

### 3. `core` currently absorbs shared account policy

Current files:

- `packages/core/src/account/account.ts`
- `packages/core/src/account/balance-scope.ts`

Current behavior:

- `core` correctly owns the base `Account` type and schema
- `core` now also owns balance-scope traversal because there is no capability
  package that clearly owns account hierarchy behavior

### 4. `data` owns raw persistence, as expected

Current files:

- `packages/data/src/repositories/account-repository.ts`
- `packages/data/src/adapters/account-query-ports-adapter.ts`
- `packages/data/src/adapters/balance-ports-adapter.ts`

Current behavior:

- `data` persists accounts and adapts repository behavior into capability-owned
  ports
- this part is architecturally correct

## Higher-Level Smell

This repo currently has an accidental CQRS split for accounts:

- write-side account behavior lives in `ingestion`
- read-side account behavior lives in `accounts`
- shared account policy leaks into `core`

That is not an intentional architecture decision. It is a missing ownership
decision.

The package name `packages/accounts` implies a capability owner, but the
package currently behaves like `account-query`.

## Decision

### 1. Keep `core` small

`core` remains the shared kernel:

- shared domain types
- schemas
- result types
- pure kernel utilities

Do not grow `core` into the default home for account behavior just because
multiple packages need it.

### 2. Make `packages/accounts` the account capability

`packages/accounts` should own:

- account hierarchy policy
- account scope resolution
- account lookup and registry port vocabulary
- account queries and account read models

This makes the package name truthful.

### 3. Keep `data` as the persistence adapter

`packages/data` should continue to implement accounts-owned ports and should not
be promoted into a domain owner.

### 4. Leave `Account` type/schema in `core` for now

This plan does not require a low-level model move.

The ownership problem is behavioral, not structural-schema-first.

## Target Package Shape

```text
packages/accounts/src/
  account-query.ts
  account-query-utils.ts
  account-scope.ts
  ports/
    account-query-ports.ts
    account-store-ports.ts
    account-hierarchy-ports.ts
    index.ts
  index.ts
```

Notes:

- `account-query.ts` remains the read-model entrypoint
- `account-scope.ts` owns shared hierarchy and scope rules
- `ports/` expands to include both query-side and write-side account contracts

## Migration Plan

### Phase 1: Create accounts-owned port vocabulary

Goal:

- stop defining account lifecycle contracts inside `ingestion`

Create:

- `packages/accounts/src/ports/account-store-ports.ts`
- `packages/accounts/src/ports/account-hierarchy-ports.ts`

Add ports for:

- `findById`
- `findAll`
- `findChildAccounts`
- `findOrCreate`
- `update`
- `updateCursor`

Guidelines:

- keep ports coarse and use-case-shaped
- do not create repository-shaped interfaces for every table concern
- keep query-only read-model ports separate from lifecycle/store ports when that
  separation helps call sites stay explicit

### Phase 2: Move shared account hierarchy behavior into `packages/accounts`

Goal:

- remove account-domain policy from `core`

Move:

- `packages/core/src/account/balance-scope.ts`

To:

- `packages/accounts/src/account-scope.ts`

Update callers:

- `packages/ingestion/src/features/balance/balance-workflow.ts`
- `packages/accounts/src/account-query.ts`
- `packages/data/src/adapters/balance-scope-utils.ts`
- `apps/cli/src/features/balance/command/balance-handler.ts`

Implementation notes:

- `account-scope.ts` should depend only on accounts-owned hierarchy ports and
  core account types
- after the move, remove the re-export from `packages/core/src/index.ts`

### Phase 3: Make ingestion reuse accounts-owned ports

Goal:

- remove account ownership from ingestion ports

Update:

- `packages/ingestion/src/ports/import-ports.ts`
- `packages/ingestion/src/ports/balance-ports.ts`

Rules:

- do not redefine account lookup/store interfaces inside ingestion
- import the account contracts from `@exitbook/accounts/ports`
- if ingestion needs a narrower subset, compose that subset from
  accounts-owned ports instead of inventing a second vocabulary

Update adapters:

- `packages/data/src/adapters/import-ports-adapter.ts`
- `packages/data/src/adapters/balance-ports-adapter.ts`
- `packages/data/src/adapters/account-query-ports-adapter.ts`

### Phase 4: Make `packages/accounts` internally honest

Goal:

- align the package internals with the broader capability role

Update:

- `packages/accounts/src/index.ts`
- `packages/accounts/src/ports/index.ts`

Keep:

- `AccountQuery` as the query/read-model slice

Add:

- exports for account-scope helpers
- exports for account lifecycle and hierarchy ports

Optional cleanup in this phase:

- rename internal files if needed to make query-specific code look explicitly
  query-specific rather than package-global

### Phase 5: Remove temporary compatibility imports

Goal:

- end with one clear account owner

After callers are migrated:

- remove `packages/core/src/account/balance-scope.ts`
- remove any transitional re-exports that keep account-scope helpers visible
  from both `core` and `accounts`
- remove duplicated account interface definitions from `ingestion`

## File-by-File Implementation Order

1. Add accounts-owned store and hierarchy ports.
2. Export them through `packages/accounts/src/ports/index.ts`.
3. Move `balance-scope.ts` from `core` to `accounts`.
4. Update the current balance/account callers to import from `@exitbook/accounts`.
5. Update ingestion ports to reuse accounts-owned types.
6. Update `packages/data` adapters to implement the new accounts-owned ports.
7. Remove the old `core` export and ingestion-local account interfaces.
8. Run lint, targeted tests, and full build.

## Verification

At minimum, rerun:

- `pnpm exec eslint packages/accounts/src packages/ingestion/src/ports packages/data/src/adapters apps/cli/src/features/balance/command`
- `pnpm vitest run packages/accounts/src/__tests__/account-query.test.ts packages/ingestion/src/features/balance/__tests__/balance-workflow.test.ts apps/cli/src/features/balance/command/__tests__/balance-handler.test.ts`
- `pnpm build`

## Exit Criteria

- `packages/accounts` owns account lifecycle and hierarchy port vocabulary.
- `ingestion` no longer defines its own account store contracts.
- balance-scope traversal no longer lives in `core`.
- `data` remains an adapter-only package.
- the package name `accounts` truthfully matches what the package owns.

## Rejected Alternative

### Keep `packages/accounts` as query-only and move more shared account logic into `core`

Do not choose this unless we intentionally rename `packages/accounts` to
something like `account-query`.

Why this is rejected:

- it leaves account ownership split
- it makes `core` the pressure valve for package-graph inconvenience
- it does not fix the semantic mismatch between package name and package role
