---
status: draft
last_updated: 2026-03-17
---

# Profiles And Named Sources Plan

## Summary

This plan changes the CLI import UX from:

- a hidden default user
- parameter-driven imports
- account rows as mostly internal implementation detail

to:

- an explicit active profile
- named saved sources as first-class import targets
- refresh flows that operate on saved sources, not on remembered addresses or API keys

The main user outcome is simple:

- first run: connect or import a source once
- later runs: refresh by source name or refresh all sources for the active profile

## Why This Plan Exists

The current import UX is good for bootstrapping, but weak for ongoing use.

Current pain points:

- users must remember an address, xpub, CSV directory, or API key context to re-run imports
- the CLI cannot cleanly support `import --all` for a user’s saved data sources
- the product already has a `users` table and per-user account ownership, but the UX still hides that behind a hardcoded default user
- `account` is overloaded and confusing in user-facing language
- `wallet` is too narrow because exchange API and CSV imports are not wallets

The desired UX is operational, not just conceptual:

- `exitbook import --source kraken-main`
- `exitbook import --all`
- `exitbook profiles switch alice`

## Decision

Adopt three user-facing concepts:

- `profile`: the active local user context
- `source`: a named saved import target owned by a profile
- `provider`: the underlying exchange or blockchain name, for example `kraken`, `bitcoin`, `ethereum`

Reject these terms for the primary UX object:

- `account`: too overloaded with internal data-model meaning
- `wallet`: too narrow
- `login`: misleading for a local CLI without real authentication

## Core Product Model

### Profile

A profile is the current local working context for the CLI.

Properties:

- owns sources
- is selected explicitly or via a stored active-profile setting
- is not an authentication boundary
- can be overridden per command with `--profile`

In local CLI terms, this is profile switching, not login.

### Source

A source is a saved import target with a human name.

Examples:

- `kraken-main`
- `bitcoin-cold`
- `coinbase-tax-csv`

A source should capture the information currently hidden inside the account record:

- profile owner
- import kind: blockchain, exchange-api, exchange-csv
- provider: `kraken`, `bitcoin`, `ethereum`, etc.
- identifier: address, xpub, API-key identity, or CSV directory
- optional provider preference
- credentials when applicable

### Account

`Account` can remain the internal storage/runtime term for now.

User-facing rule:

- talk about sources in commands and help text
- reserve account IDs for diagnostics, advanced filtering, and internal references

Important distinction:

- a normal saved source usually maps to one top-level account row
- an xpub source maps to one parent account plus internal child accounts

That means `source` is the correct UX object even if `account` remains the storage object.

## Naming Decision

Every source needs a human name.

Rules:

- source names are unique within a profile
- interactive creation should prompt for a name
- the prompt should offer a generated suggestion such as `kraken-1`
- non-interactive creation should auto-generate a name when none is provided
- numeric IDs remain supported internally, but source name becomes the primary handle

Why:

- users remember `kraken-main`, not `account #12`
- names make `import --all`, status screens, and error messages readable
- names are required before multi-profile UX feels coherent

## CLI Direction

### Profiles

Add a first-class `profiles` command group.

Proposed surface:

```bash
exitbook profiles add alice
exitbook profiles list
exitbook profiles switch alice
exitbook profiles current
```

Behavior:

- one active profile at a time by default
- all profile-scoped commands use the active profile unless `--profile` is passed
- existing installations migrate to a default profile, for example `default`

### Sources

Add a first-class `sources` command group.

Proposed surface:

```bash
exitbook sources add --exchange kraken
exitbook sources add --exchange kraken --name kraken-main --api-key ... --api-secret ...
exitbook sources add --blockchain bitcoin --address xpub...
exitbook sources list
exitbook sources view kraken-main
exitbook sources rename kraken-main kraken-tax
exitbook sources remove kraken-main
```

Creation behavior:

- interactive mode prompts for missing fields and source name
- non-interactive mode accepts flags and generates a default name when omitted
- source creation validates enough to avoid obviously broken saved state

### Import

Make saved-source import the primary refresh path.

Proposed surface:

```bash
exitbook import --source kraken-main
exitbook import --all
exitbook import --profile alice --all
```

Bootstrap path remains valid:

```bash
exitbook import --exchange kraken --api-key ... --api-secret ...
exitbook import --blockchain bitcoin --address bc1...
```

Bootstrap behavior:

- raw-parameter imports still work
- if the matching saved source already exists for the active profile, reuse it
- otherwise create a saved source automatically, using a generated or prompted name

This keeps first-run UX short while still converging toward named saved sources.

## `import --all` Semantics

`import --all` should mean:

- refresh all top-level saved sources for the active profile
- do not require the user to remember identifiers
- skip internal child accounts as independent top-level targets

For xpub sources:

- refresh the saved parent source
- let the existing xpub workflow manage derivation and child-account imports
- never show each child account as if it were a separate user-created source

## Active Profile Semantics

The CLI needs explicit profile context because the current hidden default-user model does not scale.

Rules:

- every saved source belongs to one profile
- commands default to the active profile
- commands that target all sources operate only within the active profile unless an explicit cross-profile mode is added later
- cross-profile bulk operations should not be implicit

This keeps `import --all` safe and unsurprising.

## UX Copy Rules

Use these terms in user-facing copy:

- `profile`
- `source`
- `provider`

Avoid these terms in primary UX copy:

- `login`
- `default user`
- `account #<id>` as the main reference

Good:

- `Imported source kraken-main`
- `Refreshing 5 sources for profile alice`
- `Source bitcoin-cold uses provider bitcoin`

Bad:

- `Logged in as alice`
- `Importing account #12`
- `Created wallet for Kraken`

## Data Model Direction

This plan does not require the storage layer to rename `accounts` immediately.

Practical direction:

- keep `accounts` as the storage object for now
- add a first-class profile identity instead of a bare numeric user ID
- add a human source-name field on the top-level tracked account object, or add a thin source read/write layer above accounts
- keep xpub child accounts internal and derived from the named parent source

Important naming smell:

- `accounts.source_name` currently means provider name, not human source name

That field name becomes more confusing once `source` is a primary UX term. The code and schema should eventually distinguish:

- provider name
- human source name

## Migration Direction

Existing installs should migrate without breaking the fast path.

Initial migration rules:

- create a default named profile from the current implicit default user
- generate source names for existing top-level accounts, for example `kraken-1`, `bitcoin-1`
- continue supporting raw parameter imports
- prefer showing source names in CLI output after migration

## Non-Goals

Out of scope for this slice:

- real authentication or security boundaries between profiles
- credential encryption redesign
- replacing every internal use of the word `account` immediately
- exposing child xpub accounts as first-class saved sources

## Recommended Implementation Order

### 1. Add profile identity

- give users a visible profile name
- add active-profile resolution in the CLI runtime
- replace hidden default-user assumptions in command entry points

### 2. Add source naming

- add a human name for each top-level saved import target
- enforce uniqueness per profile
- keep IDs as internal/fallback identifiers

### 3. Add profile and source commands

- `profiles add/list/switch/current`
- `sources add/list/view/rename/remove`

### 4. Add import-by-source and import-all

- `import --source <name>`
- `import --all`
- `--profile <name>` override

### 5. Keep bootstrap import

- preserve `import --exchange ...` and `import --blockchain ...`
- auto-create or reuse named sources behind the scenes

## Open Constraint To Resolve During Implementation

The biggest terminology collision is that `source` already appears in the codebase and CLI to mean provider-like values.

Implementation should make one of these moves consistently:

- reserve `source` for the saved import target and use `provider` for `kraken` / `bitcoin`
- or keep `source` internal-only and choose another UX term such as `connection`

This document recommends the first option:

- user-facing `source`
- user-facing `provider`

because it best matches the desired refresh flows.
