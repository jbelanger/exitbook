# Profile-Scoped Processed Transactions Plan

## Problem

`reprocess` is supposed to honor the active CLI profile, but bare `exitbook reprocess` currently resolves raw-data accounts globally and can rebuild every profile in the workspace.

This is not only a `reprocess` command bug.

The same global behavior currently leaks through:

- processed-transactions freshness checks
- auto reprocess when a command sees stale derived data
- processed-transactions projection state writes (`building`, `fresh`, `failed`, `stale`)

Operationally, that means one profile can make another profile look stale or trigger rebuild work outside the active workspace boundary.

## Current Surfaces

### Command and runtime entrypoints

- `/Users/joel/Dev/exitbook/apps/cli/src/features/reprocess/command/reprocess.ts`
  - bare `reprocess` only resolves the active profile when a selector is present
  - otherwise it passes `accountId: undefined`
- `/Users/joel/Dev/exitbook/apps/cli/src/features/reprocess/command/run-reprocess.ts`
  - forwards params into `ProcessingWorkflow.prepareReprocess(...)`
- `/Users/joel/Dev/exitbook/apps/cli/src/runtime/projection-readiness.ts`
  - `ensureProcessedTransactionsReady(...)` currently calls `prepareReprocess({})`
  - this is the auto-rebuild path used by profile-scoped commands like `transactions`, `issues`, `accounts refresh`

### Processing workflow boundary

- `/Users/joel/Dev/exitbook/packages/ingestion/src/features/process/process-workflow.ts`
  - `prepareReprocess(...)` falls back to `ports.batchSource.findAccountsWithRawData()`
  - `processImportedSessions(accountIds)` marks processed-transactions `building`, `fresh`, and `failed` without profile scope

### Data adapter boundary

- `/Users/joel/Dev/exitbook/packages/data/src/ingestion/processing-ports.ts`
  - `findAccountsWithRawData()` is backed by `db.rawTransactions.findDistinctAccountIds({})`
  - processed-transactions projection state is written to the default global scope
- `/Users/joel/Dev/exitbook/packages/data/src/ingestion/import-ports.ts`
  - import invalidation marks processed-transactions stale globally
- `/Users/joel/Dev/exitbook/packages/data/src/projections/processed-transactions-reset.ts`
  - reset marks processed-transactions stale globally
- `/Users/joel/Dev/exitbook/packages/data/src/projections/processed-transactions-freshness.ts`
  - reads raw accounts globally
  - reads projection state globally
  - computes account hash globally
  - checks latest completed import globally

### Repository helpers involved in scope resolution

- `/Users/joel/Dev/exitbook/packages/data/src/repositories/raw-transaction-repository.ts`
  - `findDistinctAccountIds(...)` has no `profileId` filter
- `/Users/joel/Dev/exitbook/packages/data/src/repositories/import-session-repository.ts`
  - `findLatestCompletedAt()` has no `profileId` filter
- `/Users/joel/Dev/exitbook/packages/data/src/utils/account-hash.ts`
  - `computeAccountHash(...)` hashes every account in the workspace
- `/Users/joel/Dev/exitbook/packages/data/src/projections/profile-scope-key.ts`
  - already provides `buildProfileProjectionScopeKey(profileId)`
- `/Users/joel/Dev/exitbook/packages/data/src/repositories/projection-state-repository.ts`
  - already supports scoped rows; this is the seam we should use instead of inventing new state storage

## What Is Already True

- The CLI already treats the active profile as the workspace boundary in user-facing behavior and top-level docs.
- Many downstream projections are already profile-scoped:
  - `links`
  - `asset-review`
  - balances through `balance:<scopeAccountId>`
- Projection state storage already supports arbitrary scope keys.
- `markDownstreamProjectionsStale(...)` already resolves affected profile IDs from account IDs and scopes downstream invalidation correctly.

## What Is Missing

- A profile-scoped model for the processed-transactions projection itself.
- Profile-scoped raw-data discovery for reprocess planning.
- Profile-scoped freshness inputs:
  - raw data existence
  - account graph hash
  - latest completed import
- Command/runtime wiring that always resolves the active profile before bare reprocess or auto reprocess.

## Options Considered

### Option A: Patch `reprocess` command only

Shape:

- resolve active profile inside `apps/cli/src/features/reprocess/command/reprocess.ts`
- filter account IDs before calling the workflow

Value:

- smallest code diff
- fixes the explicit `reprocess` command symptom

Why not chosen:

- leaves `ensureProcessedTransactionsReady(...)` wrong
- leaves processed-transactions freshness globally shared
- keeps two conflicting truths alive:
  - commands are profile-scoped
  - processed-transactions state is global

### Option B: Add profile filtering to raw-data discovery only

Shape:

- teach `findAccountsWithRawData(...)` about `profileId`
- thread `profileId` into `prepareReprocess(...)`

Value:

- fixes explicit reprocess and auto reprocess account discovery

Why not chosen:

- still leaves processed-transactions `building/fresh/failed/stale` global
- one profile import can still make another profile appear stale or fresh incorrectly

### Option C: Make processed-transactions behave as a profile-scoped projection wherever CLI profile boundaries matter

Shape:

- scope processed-transactions projection state by `profile:<id>`
- scope its freshness inputs by profile
- scope `prepareReprocess(...)` by profile for CLI/readiness callers

Value:

- one consistent model
- matches the existing CLI/operator boundary
- reuses existing scoped projection-state infrastructure

Chosen because:

- it is the smallest model that is still honest
- it fixes the command symptom and the readiness symptom together
- it removes the global-vs-profile contradiction instead of hiding it

## Intended Model

For CLI-facing workflows, processed-transactions should be treated as a profile-scoped projection.

Concretely:

- processed-transactions freshness is evaluated per profile scope
- reprocess planning without an explicit account selector operates on the active profile only
- processed-transactions projection state writes use `buildProfileProjectionScopeKey(profileId)`
- import/reset invalidation marks processed-transactions stale for affected profiles, not globally

Non-goal for this slice:

- redesign every ingestion workflow around profiles
- broad rewrite of unrelated global helpers
- speculative changes to `processAllPending()` unless a real caller needs profile scoping now

## Phase Plan

### Phase 1: Add profile-scoped discovery primitives

#### Files

- `/Users/joel/Dev/exitbook/packages/data/src/repositories/raw-transaction-repository.ts`
- `/Users/joel/Dev/exitbook/packages/data/src/repositories/import-session-repository.ts`
- `/Users/joel/Dev/exitbook/packages/data/src/utils/account-hash.ts`
- related repository/helper tests

#### Changes

1. Extend `RawTransactionRepository.findDistinctAccountIds(...)`
   - add optional `profileId?: number`
   - when present, join `accounts` and filter `accounts.profile_id = profileId`
   - preserve existing behavior when `profileId` is omitted

2. Extend `ImportSessionRepository.findLatestCompletedAt(...)`
   - add optional `profileId?: number`
   - when present, join `accounts` and filter by profile
   - keep current global behavior when omitted

3. Replace the global-only account hash helper with a scoped helper
   - preferred shape:
     - keep `computeAccountHash(db)` as a thin wrapper if needed for existing callers
     - add `computeAccountHash(db, profileId?: number)` or `computeProfileAccountHash(db, profileId)`
   - the scoped form must hash only accounts inside the target profile

#### Acceptance criteria

- repository tests prove profile filtering returns only accounts/imports for the selected profile
- account hash tests prove a change in profile B does not change the hash for profile A

### Phase 2: Scope processed-transactions projection state

#### Files

- `/Users/joel/Dev/exitbook/packages/data/src/projections/processed-transactions-freshness.ts`
- `/Users/joel/Dev/exitbook/packages/data/src/ingestion/import-ports.ts`
- `/Users/joel/Dev/exitbook/packages/data/src/ingestion/processing-ports.ts`
- `/Users/joel/Dev/exitbook/packages/data/src/projections/processed-transactions-reset.ts`
- `/Users/joel/Dev/exitbook/packages/data/src/projections/__tests__/processed-transactions-freshness.test.ts`
- `/Users/joel/Dev/exitbook/packages/data/src/projections/__tests__/processed-transactions-reset.test.ts`
- `/Users/joel/Dev/exitbook/packages/data/src/ingestion/__tests__/import-ports.test.ts`

#### Changes

1. `buildProcessedTransactionsFreshnessPorts(...)`
   - change signature to require `profileId: number`
   - pseudocode:
     - `scopeKey = buildProfileProjectionScopeKey(profileId)`
     - `rawAccountIds = db.rawTransactions.findDistinctAccountIds({ profileId })`
     - if none, fresh
     - `state = db.projectionState.find('processed-transactions', scopeKey)`
     - compare `computeAccountHash(db, profileId)`
     - compare `db.importSessions.findLatestCompletedAt({ profileId })`

2. `buildImportPorts(...).invalidateProjections(...)`
   - resolve affected profile IDs from `accountIds`
   - mark processed-transactions stale once per affected profile scope
   - keep downstream invalidation behavior as-is

3. `buildProcessedTransactionsResetPorts(...).reset(...)`
   - after reset, mark processed-transactions stale once per affected profile scope instead of the global row

4. `buildProcessingPorts(...)`
   - change processed-transactions state writers to derive affected profile IDs from the `accountIds` already passed to the workflow
   - use scoped projection-state writes:
     - `markProcessedTransactionsBuilding(accountIds)`
     - `markProcessedTransactionsFresh(accountIds)`
     - `markProcessedTransactionsFailed(accountIds)`
   - compute account hash per affected profile before marking fresh

#### Acceptance criteria

- processed-transactions freshness tests now assert `profile:<id>` scope rows
- import/reset tests prove profile A import/reset does not write a processed-transactions row for profile B

### Phase 3: Thread profile scope through workflow and CLI

#### Files

- `/Users/joel/Dev/exitbook/packages/ingestion/src/features/process/process-workflow.ts`
- `/Users/joel/Dev/exitbook/packages/ingestion/src/ports/processing-ports.ts`
- `/Users/joel/Dev/exitbook/apps/cli/src/features/reprocess/command/reprocess.ts`
- `/Users/joel/Dev/exitbook/apps/cli/src/features/reprocess/command/run-reprocess.ts`
- `/Users/joel/Dev/exitbook/apps/cli/src/runtime/projection-readiness.ts`
- `/Users/joel/Dev/exitbook/apps/cli/src/features/reprocess/command/__tests__/reprocess-command.test.ts`
- `/Users/joel/Dev/exitbook/packages/ingestion/src/features/process/__tests__/process-workflow.test.ts`
- any affected readiness/consumer tests

#### Changes

1. Update `ProcessingWorkflow.prepareReprocess(...)`
   - new params shape:
     - `accountId?: number`
     - `profileId?: number`
   - behavior:
     - explicit `accountId` still wins
     - otherwise discover raw-data accounts for the provided `profileId`
     - if no `profileId`, preserve existing global fallback only where a caller explicitly opts into it

2. Update the processing port interface only as far as needed
   - keep the change narrow
   - do not broaden unrelated ingestion APIs unless a current caller needs it

3. Update `reprocess` CLI wiring
   - always resolve the active profile for bare `reprocess`
   - pass `{ profileId, accountId? }` into `runReprocess(...)`
   - selector resolution remains profile-scoped as today

4. Update auto-rebuild path in `ensureProcessedTransactionsReady(...)`
   - resolve the command profile first
   - call `buildProcessedTransactionsFreshnessPorts(db, profile.id)`
   - call `prepareReprocess({ profileId: profile.id })`
   - read processed-transactions projection state from `profile:<id>`

#### Acceptance criteria

- bare `reprocess` test proves `runReprocess(...)` receives the active `profileId`
- workflow tests prove `prepareReprocess({ profileId })` only asks for raw-data accounts in that profile
- readiness tests prove stale auto-rebuild uses the command profile scope instead of global scope

### Phase 4: Verification and operator checks

#### Focused automated validation

- `pnpm vitest run packages/data/src/projections/__tests__/processed-transactions-freshness.test.ts`
- `pnpm vitest run packages/data/src/projections/__tests__/processed-transactions-reset.test.ts`
- `pnpm vitest run packages/data/src/ingestion/__tests__/import-ports.test.ts`
- `pnpm vitest run packages/ingestion/src/features/process/__tests__/process-workflow.test.ts`
- `pnpm vitest run apps/cli/src/features/reprocess/command/__tests__/reprocess-command.test.ts`
- `pnpm vitest run apps/cli/src/features/shared/__tests__/consumer-input-prereqs.test.ts`

#### Live validation if safe

Use a workspace with at least two profiles and raw data in both:

1. switch active profile to A
2. run bare `pnpm run dev reprocess --json`
3. confirm only profile A accounts are planned/processed
4. trigger a stale derived-data command in profile A and confirm the auto reprocess also stays in profile A

If live validation is blocked by local data shape or setup cost, say so explicitly in the implementation summary.

## Sequencing Notes

- Do not start with the command patch.
- Start at the data/projection boundary so the command/runtime layer can stay simple.
- Land profile-scoped processed-transactions state before relying on it from readiness.
- Keep the old global processed-transactions state unused rather than partially reusing it.

## Risks / Blast Radius

- processed-transactions freshness is used transitively by several commands through readiness gates
- import invalidation and reset behavior will change from one global row to multiple scoped rows
- test fixtures that currently assume a global processed-transactions row will need coordinated updates

## Questions To Re-check During Implementation

- Is there any real caller of `processAllPending()` that should also become profile-scoped now, or can it remain global until a concrete operator workflow needs it?
- Do any non-CLI consumers rely on the global processed-transactions projection row today, or is the CLI already the effective owner of this surface?

## Initial Deliverable Order

1. repository/helper filters
2. processed-transactions scoped freshness + state writers
3. workflow and CLI wiring
4. focused tests
5. optional live multi-profile validation
