---
last_verified: 2026-03-29
status: draft
---

# Profiles CLI Specification

## Overview

`exitbook profiles` manages isolated working contexts inside a single data directory.

A profile represents an independent dataset and reporting context. Accounts, imports, derived projections, and reports all operate against the resolved active profile unless a command explicitly documents otherwise.

Profiles are intentionally lightweight:

- create a new profile when you want a clean dataset
- switch profiles when you want a different default workspace
- inspect the current profile when command results seem surprising

There is no TUI for this family. Profiles are text-first and JSON-friendly administrative commands.

## Shared Model

### Profile Identity

Each profile has two user-visible fields:

- `profileKey`: stable key used by CLI state and command resolution
- `displayName`: human-facing label

On creation, the display label defaults to the normalized key. Renaming changes the display label only.

### Active Profile Resolution

The active profile is resolved in this order:

1. `EXITBOOK_PROFILE`
2. saved CLI state in the current data directory
3. `default`

`profiles switch` only updates the saved CLI state. An `EXITBOOK_PROFILE` override still wins for the current process.

### Default Profile

The `default` profile is lazy. It is created automatically when first needed.

## Command Surface

| Command                     | Intent | Output | User question answered                               |
| --------------------------- | ------ | ------ | ---------------------------------------------------- |
| `exitbook profiles list`    | export | text   | "Which profiles exist, and which one is active?"     |
| `exitbook profiles current` | export | text   | "Which profile is this command using right now?"     |
| `exitbook profiles add`     | mutate | text   | "Create a new isolated workspace"                    |
| `exitbook profiles rename`  | mutate | text   | "Improve the label without changing identity"        |
| `exitbook profiles switch`  | mutate | text   | "Make a different profile the default going forward" |

All commands accept `--json`.

## `exitbook profiles list`

Shows every profile in deterministic order and marks the active one in text output.

### Text Output

```text
* default [key: default]
  business [key: business]
```

- `*` marks the active profile
- non-active profiles use a leading space
- output stays line-oriented for easy terminal scanning

### JSON Output

Returns:

- `activeProfileKey`
- `profiles[]`
- each profile item includes `profileKey`, `displayName`, `isActive`, `createdAt`, and `id`

## `exitbook profiles current`

Shows the profile resolved for the current command context.

### Text Output

```text
business [key: business] (state)
```

The source suffix is shown when the active profile comes from saved state or environment override. When resolution falls back to the default profile, the suffix is omitted.

### JSON Output

Returns:

- `profile`
- `source`: `default`, `state`, or `env`

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

## `exitbook profiles rename <profile> <display-name>`

Changes the display label only.

### Rules

- the profile key remains unchanged
- the command must fail if the requested profile does not exist
- the new display name is normalized and validated before writing

### Text Output

```text
Renamed profile business to Business Holdings
```

## `exitbook profiles switch <profile>`

Changes the default profile for future commands in the current data directory.

### Rules

- the target profile must resolve successfully first
- the command writes the selected key into CLI state
- `EXITBOOK_PROFILE` may still override the saved default for a given process

### Text Output

```text
Default profile set to business [key: business]
```

## Error Handling

- invalid keys and display names fail at the boundary
- switching or renaming a missing profile fails with a direct not-found error
- state-file write failures are surfaced directly; they are never ignored

## Non-Goals

- no nested profile hierarchy
- no per-command `--profile` duplication as the default user path
- no TUI or interactive prompt flow for profile management
