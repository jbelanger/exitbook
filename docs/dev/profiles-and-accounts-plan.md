---
status: draft
last_updated: 2026-03-19
supersedes: docs/dev/profiles-and-sources-plan.md
---

# Profiles And Accounts Plan

## Summary

This plan replaces the previous source-based draft with a simpler product model:

- profiles isolate datasets
- accounts are the named top-level things users add and refresh
- each account is either a wallet or an exchange
- each account belongs to a platform such as `bitcoin` or `kraken`
- accounts may create internal child accounts
- providers remain technical upstream details

Main user outcomes:

- `exitbook profiles switch son`
- `exitbook accounts list`
- `exitbook import --account kraken-main`
- `exitbook import --all`

## Why This Supersedes The Previous Drafts

The earlier draft was trying to solve two different problems at once:

- how to isolate datasets by person or purpose
- what to call the saved thing a user refreshes later

The `source` draft was directionally correct about profiles and named refresh targets, but `source` never felt like product language.

Greenfield, the most natural term is `account`.

Users already say:

- `my Kraken account`
- `my Coinbase account`
- `my Bitcoin wallet account`

That is the right top-level noun unless the data model forces us away from it. Right now it does not.

## Decision

Adopt these product concepts:

- `profile`: the local dataset owner and active working context
- `account`: the named top-level thing a user adds, views, and refreshes
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
- is selected explicitly or through a stored active-profile setting
- is not an authentication boundary
- can be overridden per command with `--profile`

Examples:

- `joel`
- `son`
- `business`

If a user wants to import a family member's data without touching their own, they create a separate profile.

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

These are the right user-facing labels in creation flows and detail views.

Examples:

- `btc-cold` is a wallet account
- `kraken-main` is an exchange account

### Platform

The platform identifies what the user connected.

Examples:

- blockchains: `bitcoin`, `ethereum`, `solana`
- exchanges: `kraken`, `coinbase`, `kucoin`

This is the concept the current code often calls `sourceName`.

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

### Child Account

Internal child accounts remain implementation detail.

Rules:

- a user-created account is always a top-level account
- child accounts are created by sync logic, not by the user directly
- xpub imports create one top-level parent account plus many child accounts
- child accounts are not listed as separate user-created accounts

That means one user-facing account can map to multiple stored rows, while still using a single `accounts` table.

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
- child accounts carry the runtime identity needed for import and processing

This is simpler than introducing a separate top-level table before we need it.

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
  - one top-level exchange account row today

### Example 3: Exchange CSV

- profile: `joel`
- account: `coinbase-tax-csv`
- kind: `exchange`
- platform: `coinbase`
- provider: not applicable
- mode: `exchange-csv`
- stored rows:
  - one top-level exchange CSV account row today

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
exitbook accounts add --exchange kraken
exitbook accounts add --blockchain bitcoin --address xpub...
exitbook accounts list
exitbook accounts view kraken-main
exitbook accounts rename kraken-main kraken-tax
exitbook accounts remove kraken-main
```

Creation flows should use kind-specific copy:

- `Add wallet account`
- `Add exchange account`

The CLI does not need separate `wallets` and `exchanges` command groups in the first slice. Those can be added later as convenience aliases if they add real value.

### Import

Make account-based import the primary refresh path.

Proposed surface:

```bash
exitbook import --account kraken-main
exitbook import --all
exitbook import --profile son --all
```

Bootstrap paths remain valid:

```bash
exitbook import --exchange kraken --api-key ... --api-secret ...
exitbook import --blockchain bitcoin --address bc1...
```

Bootstrap behavior:

- raw-parameter imports still work
- the CLI resolves the active profile first
- if a matching saved account already exists for that profile, reuse it
- otherwise create a saved top-level account automatically using a prompted or generated name

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

This plan assumes one `accounts` table, not a new top-level table.

Practical direction:

- add profile identity and active-profile state
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

The current internal `sourceName` concept is really the platform key.

Direction:

- user-facing umbrella object: `account`
- user-facing kind labels: `wallet`, `exchange`
- user-facing platform label: `platform`
- user-facing technical upstream label: `provider`
- internal current `sourceName`: eventually rename to `platformKey` or `platformName`

Until the internal rename happens:

- do not expose internal `sourceName` directly as the account name
- do not reclaim `provider` for `kraken` or `bitcoin`

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

This feature should be rolled out in a way that avoids mixed tenancy and mixed terminology.

Rules:

- do not ship `profiles switch` until command entry points resolve profile scope consistently
- do not ship `import --all` across profile boundaries
- do not rename internal `sourceName` and add profiles in the same first slice
- do not reinterpret the current `source_name` field as the user-facing account name
- keep raw parameter imports working during the transition
- keep account IDs available for diagnostics and advanced workflows

## Migration Direction

Existing installs should migrate without breaking the fast path.

Initial migration rules:

- current implicit user `id=1` becomes a default named profile such as `default`
- existing top-level account rows receive generated user-facing names such as `kraken-1` or `bitcoin-1`
- xpub parent rows become named top-level accounts
- child rows remain unnamed and internal
- existing raw imports continue to work after migration

## Edge Cases To Resolve During Implementation

- case sensitivity for profile and account names
- whether one profile can have multiple CSV exchange accounts for the same platform
- how API key rotation updates or rebinds an existing account
- how CSV directory changes update or replace an account
- whether removing an account keeps historical data by default
- how `import --all` reports partial failure when one account fails and others succeed
- how provider preference is stored for wallet accounts versus exchange accounts
- how filters like transactions, prices, and clear should distinguish `account` from `platform`

## Recommended Implementation Order

### 1. Add profile identity

- add visible profile names
- add active-profile resolution in the CLI runtime
- replace hidden default-user assumptions in command entry points

### 2. Make top-level accounts explicit

- add top-level account fields to `accounts`
- define root versus child account rules
- ensure top-level names are unique per profile

### 3. Scope command reads consistently

Update the commands that already assume user scoping first:

- import
- accounts
- clear

Then update the commands that currently read globally:

- balance
- portfolio
- assets
- transactions
- prices
- links

### 4. Add account lifecycle commands

- `accounts add/list/view/rename/remove`
- kind-specific creation copy for wallets and exchanges

### 5. Add account-based import

- `import --account <name>`
- `import --all`
- `--profile <name>` override

### 6. Clean up terminology

- move `--source` filters toward `--platform`
- phase out `source` from primary UX copy
- rename internal `sourceName` to `platformKey` when practical

## Non-Goals

Out of scope for this slice:

- real authentication boundaries between profiles
- credential encryption redesign
- separate `wallets` and `exchanges` command groups in the first slice
- exposing child xpub rows as first-class user-created accounts
- adding a separate top-level table unless the one-table model proves insufficient
