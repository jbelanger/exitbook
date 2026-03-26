---
status: draft
last_updated: 2026-03-25
supersedes: docs/dev/profiles-and-sources-plan.md
---

# Profiles And Accounts Plan

## Summary

This plan makes three structural decisions:

- profiles are the local ownership and scope model
- accounts are the named top-level things users create and sync
- import stops creating top-level accounts and only syncs existing ones

Main user outcomes:

- `exitbook profiles switch son`
- `exitbook accounts add kraken-main --exchange kraken --api-key ... --api-secret ...`
- `exitbook import --account kraken-main`
- `exitbook import --all`

This is also a terminology migration:

- `user` becomes `profile`
- `sourceName` becomes `platformKey`

## Why This Supersedes The Previous Drafts

The earlier drafts were directionally right about named saved refresh targets and profile-like scoping, but they still carried one major boundary mistake:

- account lifecycle and import execution were fused together

That leak shows up in `findOrCreate` style orchestration:

- import has to know how to create accounts
- naming and uniqueness rules leak into ingestion
- the system cannot represent "this account exists but has not been synced yet"
- the hidden default-user model remains baked into command entry points

The correct split is:

1. declare a profile-scoped account
2. sync that account

That means the CLI composes two operations, while the domain keeps them separate.

## Decision

Adopt these product concepts:

- `profile`: the local dataset owner and working scope
- `account`: the named top-level thing a user adds, views, renames, removes, and refreshes
- `account kind`: `wallet` or `exchange`
- `platform`: the chain or exchange family, such as `bitcoin`, `ethereum`, `kraken`, `coinbase`
- `provider`: the technical upstream used to fetch data from a platform, such as `alchemy`, `blockchair`, or `mempool`
- `mode`: how the account syncs, such as `wallet-address`, `wallet-xpub`, `exchange-api`, `exchange-csv`
- `child account`: an internal derived account row created beneath a top-level account

Reject these as the primary top-level UX noun:

- `source`

Reject these as the umbrella object:

- `wallet`
- `exchange`

Those remain account kinds, not the top-level object.

## Core Product Model

### Profile

A profile is the local working context for the CLI.

Properties:

- owns accounts
- is selected explicitly or through stored active-profile state
- is not an authentication boundary
- can be overridden per command with `--profile`

Examples:

- `joel`
- `son`
- `business`

If a user wants to import a family member's data without touching their own, they create a separate profile.

### Profile Key

Each profile should also carry an immutable stable `profileKey`.

Rules:

- `name` is the mutable display label
- `profileKey` is the stable identity used when rebuilding deterministic data
- do not use `profile_id`
- do not use profile name
- do not use email
- `profileKey` should be human-chosen and memorable enough to recreate later

This keeps profile identity stable across rename without forcing users to remember opaque generated identifiers.

### Account

An account is the named top-level thing a user adds once and refreshes later.

Examples:

- `kraken-main`
- `btc-cold`
- `coinbase-tax-csv`

Properties:

- belongs to one profile
- has a human name unique within that profile
- has an account kind: `wallet` or `exchange`
- has a platform
- has a sync mode
- may have a preferred provider
- may produce one or many internal child accounts

This is the primary refreshable object.

### Account Kind

Each top-level account is one of:

- `wallet`
- `exchange`

Examples:

- `btc-cold` is a wallet account
- `kraken-main` is an exchange account

### Platform

The platform identifies what the user connected.

Examples:

- blockchains: `bitcoin`, `ethereum`, `solana`
- exchanges: `kraken`, `coinbase`, `kucoin`

This is the concept the current code calls `sourceName` and this plan renames to `platformKey`.

### Provider

A provider is the technical upstream integration used to talk to a platform.

Examples:

- `alchemy`
- `blockchair`
- `mempool`

Important distinction:

- `kraken` is not a provider in this model; it is a platform
- `api` and `csv` are not providers; they are modes
- providers are mostly relevant for blockchain accounts

### Mode

Mode captures how Exitbook syncs the account.

Examples:

- `wallet-address`
- `wallet-xpub`
- `exchange-api`
- `exchange-csv`

This is primarily a storage and orchestration concern, not a primary UX noun.

Important identity rule:

- exchange mode is config, not account identity
- switching an exchange account between CSV and API should preserve downstream fingerprints
- blockchain identifier remains semantic identity and should not be treated like rotatable config

### Child Account

Internal child accounts remain implementation detail.

Rules:

- a user-created account is always a top-level account
- child accounts are created by sync logic, not by the user directly
- xpub imports create one top-level parent account plus many child accounts
- child accounts are not listed as separate user-created accounts

That means one user-facing account can map to multiple stored rows while still using a single `accounts` table.

## Ownership Boundary

Profiles and accounts belong to one capability.

That capability owns:

- profile CRUD
- active profile resolution inputs
- account lifecycle
- account name resolution within a profile
- validation of naming, uniqueness, and lifecycle rules

Ingestion is a separate capability.

That capability owns:

- sync execution
- importer selection
- import sessions
- cursor persistence
- raw transaction persistence
- xpub child derivation and child account materialization

The key boundary rule is:

- ingestion never creates top-level accounts

The intended flow is:

1. `accounts.add(profile, draft)` returns a top-level account id
2. `ingestion.sync(accountId)` refreshes that account

The app layer composes those two steps. The domain does not expose a top-level `findOrCreate` import path.

## Identity Constraints

This plan also relies on two explicit identity constraints.

### Fingerprint Root

Processed identity should root in profile-scoped account identity, not in mutable sync config.

Intended shape:

- exchange top-level identity is based on `profileKey + exchange-kind + platformKey`
- blockchain top-level identity is based on `profileKey + wallet-kind + platformKey + identifier`
- transaction identity continues deriving from account identity plus source-specific transaction material

This is what allows API-key rotation and CSV-path changes without rewriting transaction identity.

### Exchange Account Invariant

Enforce this product invariant:

- at most one top-level exchange account per platform per profile

Consequences:

- `accounts add` must reject a second same-platform exchange account in the same profile
- if this invariant ever changes, fingerprint design must be revisited before allowing multiple same-platform exchange accounts

## One-Table Model

This plan does not require a separate top-level accounts-adjacent table.

The current `accounts` table is already close to the right model if we make the top-level versus child distinction explicit.

Rules:

- top-level accounts are user-facing accounts
- child accounts are internal derived accounts
- `parent_account_id IS NULL` means top-level
- `parent_account_id IS NOT NULL` means child

Recommended shape:

- top-level accounts have a non-null human `name`
- child accounts have `name = NULL`
- top-level accounts carry the user-facing metadata
- child accounts carry the runtime identity needed for sync and processing

This is simpler than introducing a separate top-level table before we need it.

Important nuance:

- removing top-level `findOrCreate` does not mean ingestion can never insert an account row
- ingestion may still create internal child rows for xpub-derived addresses inside the one-table model
- if that ever feels architecturally wrong, that is the signal for a second table, not for restoring top-level `findOrCreate`

## Example Model

### Example 1: Separate profile

- profile: `son`
- account: `btc-cold`
- kind: `wallet`
- platform: `bitcoin`
- provider: `mempool`
- mode: `wallet-xpub`
- stored rows:
  - one top-level parent account row for the xpub
  - many child account rows for derived addresses

### Example 2: Exchange API

- profile: `joel`
- account: `kraken-main`
- kind: `exchange`
- platform: `kraken`
- provider: not a primary UX concept
- mode: `exchange-api`
- stored rows:
  - one top-level exchange account row

### Example 3: Exchange CSV

- profile: `joel`
- account: `coinbase-tax-csv`
- kind: `exchange`
- platform: `coinbase`
- provider: not applicable
- mode: `exchange-csv`
- stored rows:
  - one top-level exchange CSV account row

## UX Copy Rules

Use these terms in user-facing copy:

- `profile`
- `account`
- `wallet`
- `exchange`
- `platform`
- `provider`

Meaning rules:

- `account` is the umbrella object in list, refresh, and lifecycle commands
- `wallet` and `exchange` are used for account kind
- `platform` identifies the chain or exchange family
- `provider` identifies the upstream fetch implementation

Avoid these in primary UX copy:

- `source`
- `default user`
- `account #<id>` as the main reference

Good:

- `Refreshing 5 accounts for profile son`
- `Added wallet account btc-cold`
- `Added exchange account kraken-main`
- `Account kraken-main uses platform kraken`
- `Wallet account btc-cold prefers provider mempool`

Bad:

- `Refreshing 5 sources`
- `Provider kraken`
- `Created account #12`

## CLI Direction

### Profiles

Add a first-class `profiles` command group.

Proposed surface:

```bash
exitbook profiles add son
exitbook profiles list
exitbook profiles switch son
exitbook profiles current
```

Behavior:

- one active profile at a time by default
- all profile-scoped commands use the active profile unless `--profile` is passed
- existing installations migrate to a default profile such as `default`

### Accounts

Add a first-class `accounts` lifecycle command group around the named top-level object.

Proposed surface:

```bash
exitbook accounts add kraken-main --exchange kraken --api-key ... --api-secret ...
exitbook accounts add btc-cold --blockchain bitcoin --address xpub...
exitbook accounts list
exitbook accounts view kraken-main
exitbook accounts rename kraken-main kraken-tax
exitbook accounts remove kraken-main
```

Creation flows should use kind-specific copy:

- `Add wallet account`
- `Add exchange account`

The CLI does not need separate `wallets` and `exchanges` command groups in the first slice.

### Import

Make account-based import the only top-level refresh path.

Proposed surface:

```bash
exitbook import --account kraken-main
exitbook import --all
exitbook import --profile son --all
```

Rules:

- `import --account` resolves a saved top-level account within the active or overridden profile
- `import --all` refreshes all saved top-level accounts within the active or overridden profile
- raw parameter import is removed as a top-level command path
- users create accounts explicitly before import

This is intentional.

The system should not preserve convenience paths that reintroduce lifecycle creation into import.

## `import --all` Semantics

`import --all` means:

- refresh all top-level named accounts for the active profile
- do not require the user to remember identifiers or credentials
- do not treat child accounts as top-level refresh targets

For xpub accounts:

- refresh the top-level parent account
- let the existing xpub workflow derive and sync child accounts internally
- never list each child account as a separate user-created account

## Data Model Direction

This plan assumes one `profiles` table and one `accounts` table, not a new top-level table.

Practical direction:

- rename `users` to `profiles`
- rename `user_id` to `profile_id`
- keep one `accounts` table
- add explicit top-level account metadata to that table
- continue using `parent_account_id` for child account hierarchy

Recommended top-level account fields:

- `profile_id`
- `name`
- `account_kind`
- `platform_key`
- `mode`
- `preferred_provider_name`

Existing fields that still make sense:

- `identifier`
- `parent_account_id`
- `credentials`
- `last_cursor`
- `metadata`
- `created_at`
- `updated_at`

Recommended rules:

- top-level named accounts are unique by `(profile_id, lower(name))`
- child accounts do not have their own user-facing names
- runtime identity remains account-row based
- import sessions, raw transactions, transactions, and balances continue to hang off `accounts.id`

This preserves the current FK shape and avoids a new abstraction layer.

## Naming Direction For Existing Fields

This plan makes these internal renames explicit:

- `User` -> `Profile`
- `users` -> `profiles`
- `userId` -> `profileId`
- `sourceName` -> `platformKey`
- `source_name` -> `platform_key`

Meaning rules:

- user-facing umbrella object: `account`
- user-facing kind labels: `wallet`, `exchange`
- user-facing platform label: `platform`
- user-facing technical upstream label: `provider`
- internal `platformKey` stores the normalized platform identity

Do not rename unrelated concepts just because they contain `user` or `source`.

Examples:

- remove hidden default-user APIs instead of renaming them
- keep transaction provenance fields like `source_address` as they are
- avoid broad package and folder renames that do not improve the domain model

## Query And Filter Migration

Today several commands use `--source` to mean platform-like values.

Direction:

- `--platform` should become the long-term flag for filtering by `bitcoin`, `ethereum`, `kraken`, and similar values
- `--account` should identify named top-level accounts such as `kraken-main`
- `--source` should be phased out of primary UX copy

Transitional rule:

- keep `--source` as a temporary compatibility alias for `--platform` where needed
- do not overload one flag with both meanings

## Safe Rollout Constraints

This feature should be rolled out in a way that avoids mixed terminology and hidden behavioral changes.

Rules:

- do not ship `profiles switch` until command entry points resolve profile scope consistently
- do not ship `import --all` across profile boundaries
- do not keep hidden default-profile creation semantics inside import
- do not reinterpret the current identity fields as the user-facing account name
- keep account IDs available for diagnostics and advanced workflows
- treat mass renames as a controlled terminology migration, not a blind search-replace

## Migration Direction

Existing installs should migrate without keeping the old hidden-default model alive.

Initial migration rules:

- current implicit user `id=1` becomes a default named profile such as `default`
- existing top-level account rows receive generated user-facing names such as `kraken-1` or `bitcoin-1`
- xpub parent rows become named top-level accounts
- child rows remain unnamed and internal
- existing imports remain attached to the same account rows after schema renames

## Edge Cases To Resolve During Implementation

- case sensitivity for profile and account names
- whether one profile can have multiple CSV exchange accounts for the same platform
- how API key rotation updates or rebinds an existing account
- how CSV directory changes update or replace an account
- whether removing an account keeps historical data by default
- how `import --all` reports partial failure when one account fails and others succeed
- how provider preference is stored for wallet accounts versus exchange accounts
- how filters like transactions, prices, and clear should distinguish `account` from `platform`
- where active-profile state is persisted in CLI/runtime terms

## Recommended Implementation Order

### 1. Rename The Domain Language

- rename `user` to `profile`
- rename `sourceName` to `platformKey`
- update schema names, core types, repository APIs, ports, and docs
- remove hidden default-user naming instead of translating it directly

### 2. Add Explicit Profile Resolution

- add visible profile names
- add active-profile resolution in the CLI runtime
- replace hidden default-profile assumptions in command entry points

### 3. Make Top-Level Accounts Explicit

- add top-level account fields to `accounts`
- define root versus child account rules
- ensure top-level names are unique per profile

### 4. Add Account Lifecycle Commands

- `accounts add/list/view/rename/remove`
- kind-specific creation copy for wallets and exchanges
- explicit account creation before sync

### 5. Refactor Import To Sync Existing Accounts

- `import --account <name>`
- `import --all`
- `--profile <name>` override
- remove top-level raw-parameter import paths
- remove top-level `findOrCreate` orchestration from ingestion

### 6. Scope Command Reads Consistently

Update the commands that already assume account ownership first:

- import
- accounts
- clear

Then update the commands that currently read more broadly:

- balance
- portfolio
- assets
- transactions
- prices
- links

### 7. Clean Up Remaining Terminology

- move `--source` filters toward `--platform`
- phase out `source` from primary UX copy
- align logs, errors, and TUI copy with `profile`, `account`, and `platform`

## Non-Goals

Out of scope for this slice:

- real authentication boundaries between profiles
- credential encryption redesign
- separate `wallets` and `exchanges` command groups in the first slice
- exposing child xpub rows as first-class user-created accounts
- adding a separate top-level table unless the one-table model proves insufficient
