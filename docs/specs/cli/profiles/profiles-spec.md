---
last_verified: 2026-04-01
status: draft
---

# Profiles CLI Specification

## Overview

`exitbook profiles` manages isolated working contexts inside a single data directory.

A profile represents an independent dataset and reporting context. Accounts, imports, derived projections, and reports all operate against the resolved active profile unless a command explicitly documents otherwise.

Profiles are intentionally lightweight:

- create a new profile when you want a clean dataset
- switch profiles when you want a different default workspace
- inspect the current profile context through the bare profiles list when command results seem surprising

There is no TUI for this family. Profiles are text-first and JSON-friendly administrative commands.

## Shared Model

### Profile Identity

Each profile has two user-visible fields:

- `profileKey`: stable key used by CLI state and command resolution
- `displayName`: human-facing label

On creation, the display label defaults to the normalized key. Updating changes the display label only.

### Active Profile Resolution

The active profile is resolved in this order:

1. `EXITBOOK_PROFILE`
2. saved CLI state in the current data directory
3. `default`

`profiles switch` only updates the saved CLI state. An `EXITBOOK_PROFILE` override still wins for the current process.

### Default Profile

The `default` profile is lazy. It is created automatically when first needed.

## Command Surface

| Command                    | Intent | Output | User question answered                                                           |
| -------------------------- | ------ | ------ | -------------------------------------------------------------------------------- |
| `exitbook profiles`        | export | text   | "Which profiles exist, which one is active, and how many accounts do they hold?" |
| `exitbook profiles add`    | mutate | text   | "Create a new isolated workspace"                                                |
| `exitbook profiles remove` | mutate | text   | "Delete a profile and all of the data it owns"                                   |
| `exitbook profiles update` | mutate | text   | "Improve the label without changing identity"                                    |
| `exitbook profiles switch` | mutate | text   | "Make a different profile the default going forward"                             |

All commands accept `--json`.

## `exitbook profiles`

Shows every profile in deterministic order and prints the resolved current profile context above a compact summary table.

### Text Output

```text
Profiles 2 total

Current: Business Holdings [key: business] (state)

KEY       LABEL              ACCOUNTS
business  Business Holdings         3
default   default                   1
```

- the first line is a compact list header with the total profile count
- the `Current:` line reflects the active profile key and source
- the source suffix is shown only for `state` and `env`; default fallback omits it
- rows are rendered as a static table with `KEY`, `LABEL`, and `ACCOUNTS`
- `ACCOUNTS` counts named top-level accounts only; child accounts and unnamed internal rows are excluded
- if the active key does not match a stored profile, the `Current:` line falls back to that key and no row is marked active
- the active row does not use a separate marker because the current profile is already stated explicitly above the table
- output stays line-oriented for easy terminal scanning and scrollback review

### JSON Output

Returns:

- `activeProfileKey`
- `activeProfileSource`
- `profiles[]`
- each profile item includes `profileKey`, `displayName`, `accountCount`, `isActive`, `createdAt`, and `id`

## `exitbook profiles add <profile>`

Creates a new profile from a normalized profile key.

### Rules

- profile keys are normalized before persistence
- duplicate keys fail with an error
- the created profile does not become active automatically

### Text Output

```text
Added profile business [key: business]
```

## `exitbook profiles update <profile-key> --label <display-label>`

Changes the display label only.

### Rules

- the profile key remains unchanged
- the command must fail if the requested profile does not exist
- at least one property flag is required
- the new display label is normalized and validated before writing
- no-op updates fail instead of silently succeeding

### Text Output

```text
Updated profile business label to Business Holdings
```

## `exitbook profiles remove <profile-key>`

Deletes the profile row and all accounts, imported data, and derived projections owned by that profile.

### Rules

- the command must fail if the requested profile does not exist
- the current profile for the running process cannot be removed
- text mode shows a destructive preview and confirmation prompt unless `--confirm` is passed
- `--confirm` is required with `--json`
- if the removed profile was only the saved default behind an `EXITBOOK_PROFILE` override, the saved state is cleared

### Text Output

```text
Deleting profile business (label: Business Holdings) will remove:
  - 1 profile
  - 3 accounts

Imported data:
  - 2 import sessions
  - 14 raw import data items

Derived data:
  - 8 transactions
  - 3 transaction links
  - 1 review item
  - 6 balances
  - 6 cost basis snapshots
```

## `exitbook profiles switch <profile-key>`

Changes the default profile for future commands in the current data directory.

### Rules

- the target profile must resolve successfully first
- the command writes the selected key into CLI state
- `EXITBOOK_PROFILE` may still override the saved default for a given process

### Text Output

```text
Default profile set to business (label: Business Holdings)
```

## Error Handling

- invalid keys and display labels fail at the boundary
- if a selector matches a unique profile label but not a key, the CLI should point the user to the stable key
- removing the current profile fails with a direct usage error
- switching or updating a missing profile fails with a direct not-found error
- state-file write failures are surfaced directly; they are never ignored

## Non-Goals

- no nested profile hierarchy
- no per-command `--profile` duplication as the default user path
- no TUI or interactive prompt flow for profile management
