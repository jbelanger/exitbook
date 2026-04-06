---
last_verified: 2026-04-06
status: draft
---

# Profiles CLI Specification

## Overview

`exitbook profiles` manages isolated working contexts inside a single data directory.

A profile represents an independent dataset and reporting context. Accounts, imports, derived projections, and reports all operate against the resolved active profile unless a command explicitly documents otherwise.

Profiles use a static-only browse shape:

- `profiles`
- `profiles list`
- `profiles view <profile-key>`

There is no explorer for this family.

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

| Command                                | Intent | Output | User question answered                                                           |
| -------------------------------------- | ------ | ------ | -------------------------------------------------------------------------------- |
| `exitbook profiles`                    | browse | text   | "Which profiles exist, which one is active, and how many accounts do they hold?" |
| `exitbook profiles list`               | browse | text   | explicit alias of the same static list                                           |
| `exitbook profiles view <profile-key>` | browse | text   | "What are the details of one profile?"                                           |
| `exitbook profiles add`                | mutate | text   | "Create a new isolated workspace"                                                |
| `exitbook profiles remove`             | mutate | text   | "Delete a profile and all of the data it owns"                                   |
| `exitbook profiles update`             | mutate | text   | "Improve the label without changing identity"                                    |
| `exitbook profiles switch`             | mutate | text   | "Make a different profile the default going forward"                             |

All commands accept `--json`.

## `exitbook profiles` / `exitbook profiles list`

Shows every profile in deterministic order and prints the resolved current profile context above a compact summary table.

### Text Output

```text
Profiles 2 total

Current: Business Holdings [key: business] (state)

KEY       LABEL              ACCOUNTS
default   default                   1
business  Business Holdings         3
```

Rules:

- `profiles` and `profiles list` are equivalent
- the first line is a compact list header with the total profile count
- the `Current:` line reflects the active profile key and source
- the source suffix is shown only for `state` and `env`; default fallback omits it
- rows are rendered as a static table with `KEY`, `LABEL`, and `ACCOUNTS`
- `ACCOUNTS` counts named top-level accounts only; child accounts and unnamed internal rows are excluded

### JSON Output

Returns:

- `activeProfileKey`
- `activeProfileSource`
- `profiles[]`
- each profile item includes `profileKey`, `displayName`, `accountCount`, `isActive`, `createdAt`, and `id`

## `exitbook profiles view <profile-key>`

Shows a static detail card for one profile.

### Selector Rules

- the selector is always the stable `profileKey`
- display labels are not valid selectors
- if a selector matches a unique display label but not a key, the CLI points the user to the stable key instead

### Text Output

```text
Business Holdings business

Key: business
Label: Business Holdings
Accounts: 3
Current: yes (state)
Created: 2026-03-27T00:00:00.000Z
```

Rules:

- detail is static, never interactive
- `Current` shows `yes`, plus the active-source suffix when the viewed profile is active
- non-active profiles show `Current: no`

### JSON Output

Returns:

- `activeProfileKey`
- `activeProfileSource`
- `profile`
- the profile object includes `profileKey`, `displayName`, `accountCount`, `isActive`, `activeProfileSource`, `createdAt`, and `id`

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

## `exitbook profiles switch <profile-key>`

Changes the default profile for future commands in the current data directory.

### Rules

- the target profile must resolve successfully first
- the command writes the selected key into CLI state
- `EXITBOOK_PROFILE` may still override the saved default for a given process

## Error Handling

- invalid keys and display labels fail at the boundary
- if a selector matches a unique profile label but not a key, the CLI points the user to the stable key
- switching, viewing, updating, or removing a missing profile fails with a direct not-found error
- removing the current profile fails with a direct usage error
- state-file write failures are surfaced directly; they are never ignored

## Non-Goals

- no nested profile hierarchy
- no explorer or TUI mode for profiles
- no per-command `--profile` duplication as the default user path
