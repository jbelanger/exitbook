---
status: draft
last_updated: 2026-03-25
depends_on: docs/dev/profiles-and-accounts-plan.md
---

# Profile Read Scope And Overrides Plan

## Summary

The write side is now profile-aware:

- profiles exist as first-class ownership scopes
- accounts belong to profiles
- import syncs saved accounts instead of creating top-level accounts

The read side is still inconsistent:

- many CLI read commands do not resolve an active profile first
- several handlers still read global transactions or global accounts
- account-id lookups still hand-roll ownership checks instead of using a shared guard
- processed transaction identity is still not rooted in profile identity

This plan fixes that by:

1. making profile scope universal across read commands
2. adding one shared ownership guard on the accounts capability
3. adding a stable human-chosen `profileKey`
4. making account and transaction fingerprints profile-aware
5. making transaction queries profile-aware
6. only adding explicit override scope later if asset exclusions truly need it

This document is intentionally implementation-oriented so it can be resumed later without reconstructing the architecture discussion.

## Decisions Already Settled

### Capability Boundaries

- keep `packages/accounts`
- do not rename it to `profiles` or `ownership`
- profiles remain a sub-concern inside the accounts capability
- add one missing ownership guard to the accounts capability instead of inventing a new catalog abstraction

### Stable Profile Identity

Profiles need two distinct identities:

- `name`: mutable display label
- `profileKey`: immutable stable identity string

Rules:

- do not use `profile_id`
- do not use profile name
- do not use email
- `profileKey` should be human-chosen and memorable
- profile rename preserves `profileKey`
- if the user rebuilds state, they can recreate the same profile identity by supplying the same `profileKey`
- `profiles list` and `profiles current` should show both name and key

This keeps identity stable without asking users to remember opaque UUIDs or leaking PII into local state.

### Ownership Guard

Add this method to `AccountLifecycleService`:

```ts
async requireOwned(profileId: number, accountId: number): Promise<Result<Account, Error>>
```

Behavior:

- load account by id
- return `Account <id> not found` if missing
- return `Account <id> does not belong to the selected profile` if `account.profileId !== profileId`
- otherwise return the account

This replaces ad hoc guards in command and query code.

### Fingerprint And Identity Model

Do not add a separate user-facing `accountKey`.

Instead:

- widen top-level account identity with `profileKey`
- let `txFingerprint` and movement fingerprints continue derive from account identity
- treat exchange sync configuration as mutable config, not identity

Target shape:

- exchange top-level fingerprint:
  - `hash(profileKey | exchange | platformKey)`
- blockchain top-level fingerprint:
  - `hash(profileKey | wallet | platformKey | identifier)`
- child account fingerprint:
  - rooted in parent identity plus child-specific identifier or derivation path
- transaction fingerprint:
  - still derived from `accountFingerprint` plus source-specific transaction identity material

Important consequences:

- exchange API-key rotation no longer rewrites processed identity
- exchange CSV-directory changes no longer rewrite processed identity
- switching the same exchange account between CSV and API mode preserves identity
- the same semantic account imported into two profiles becomes two distinct processed-transaction identities
- `transaction-note`, `link`, and `unlink` can stay simple because their subject fingerprints become profile-isolated naturally

### Exchange Identity Invariant

Enforce this product invariant:

- at most one top-level exchange account per platform per profile

Rationale:

- this keeps exchange identity stable without inventing a second user-facing account key
- it matches the current product assumption that a profile does not hold multiple same-platform exchange accounts

Required enforcement:

- `accounts add` must reject a second top-level exchange account with the same `profile + platform`
- switching sync mode updates the existing exchange account instead of creating a sibling

Tripwire for future devs:

> Exchange account identity assumes at most one top-level account per platform within a profile. If this invariant changes, account and transaction fingerprint design must be revisited before allowing multiple same-platform exchange accounts.

### Override Scope

Keep the override store simple unless a type is genuinely profile-local.

Current taxonomy:

- contextless / global:
  - `price`
  - `fx`
  - `transaction-note`
  - `link`
  - `unlink`
  - `asset-review-confirm`
  - `asset-review-clear`
- still unresolved:
  - `asset-exclude`
  - `asset-include`

Notes:

- `transaction-note` is no longer a reason to add profile context to the override store
- `link` and `unlink` also become effectively profile-isolated once fingerprints root in `profileKey`
- do not add generic override-context storage now just because it might be useful later
- if `asset-exclude/include` become explicitly profile-scoped later, use `profileKey`, tolerate orphans, and ignore unknown profile keys during replay

## Important Architecture Decision

Processed transaction identity was previously global because `accountFingerprint` ignored profile identity.

We are explicitly choosing to fix that now instead of layering more override-store scope around it.

Primary files:

- `packages/core/src/identity/fingerprints.ts`
- `packages/core/src/identity/__tests__/fingerprints.test.ts`
- `packages/core/src/__tests__/test-utils.ts`
- `packages/data/src/utils/transaction-id-utils.ts`
- `packages/data/src/utils/__tests__/transaction-id-utils.test.ts`
- `packages/data/src/repositories/transaction-repository.ts`
- `packages/data/src/repositories/__tests__/transaction-repository.test.ts`

Reason to do it now:

- there are no migration constraints in development
- dev databases can be rebuilt
- doing this later would make override, link, and note behavior much harder to untangle

## Current Violations To Fix

### Commands Without Universal Profile Resolution

These command surfaces still need `--profile` and `resolveCommandProfile(...)`:

- `apps/cli/src/features/balance/command/balance-view.ts`
- `apps/cli/src/features/balance/command/balance-refresh.ts`
- `apps/cli/src/features/transactions/command/transactions-view.ts`
- `apps/cli/src/features/prices/command/prices-view.ts`
- `apps/cli/src/features/assets/command/assets-view.ts`
- `apps/cli/src/features/transactions/command/transactions-edit-note.ts`
- `apps/cli/src/features/assets/command/assets-exclude.ts`
- `apps/cli/src/features/assets/command/assets-include.ts`
- `apps/cli/src/features/assets/command/assets-confirm.ts`
- `apps/cli/src/features/assets/command/assets-clear-review.ts`

### Hand-Rolled Ownership Checks

These should move to `requireOwned(...)`:

- `apps/cli/src/features/import/command/import.ts`
- `apps/cli/src/features/accounts/query/account-query.ts`
- balance account-id flows
- transaction note edit account/profile-sensitive flows

### Global Transaction Identity

These seams still assume account and processed-transaction identity without `profileKey`:

- `packages/core/src/identity/fingerprints.ts`
- `packages/core/src/__tests__/test-utils.ts`
- `packages/data/src/utils/transaction-id-utils.ts`
- `packages/data/src/repositories/transaction-repository.ts`
- test helpers and fixtures that still encode old `txFingerprint` assumptions

### Global Transaction Reads

These still read global processed transactions:

- `apps/cli/src/features/transactions/command/transactions-read-support.ts`
- `apps/cli/src/features/prices/command/prices-view-handler.ts`
- `apps/cli/src/features/assets/command/assets-handler.ts`
- `apps/cli/src/features/links/command/transfer-proposal-review-service.ts`
- `packages/data/src/accounting/cost-basis-ports.ts`
- `packages/data/src/accounting/pricing-ports.ts`
- `packages/data/src/accounting/linking-ports.ts`
- `packages/data/src/accounting/price-coverage-data.ts`

### Global Account Reads In Balance

These still enumerate or fetch accounts globally:

- `apps/cli/src/features/balance/command/balance-verification-runner.ts`
- `apps/cli/src/features/balance/command/balance-stored-snapshot-reader.ts`

## Phase Plan

## Phase 1: Add Stable Profile Identity

Goal:

- every profile has an immutable human-chosen `profileKey`

Files:

- `packages/core/src/profile/profile.ts`
- `packages/data/src/database-schema.ts`
- `packages/data/src/migrations/001_initial_schema.ts`
- `packages/data/src/repositories/profile-repository.ts`
- `apps/cli/src/features/profiles/command/profiles-add.ts`
- `apps/cli/src/features/profiles/command/profiles-list.ts`
- `apps/cli/src/features/profiles/command/profiles-current.ts`
- profile repository tests
- profile command tests

Changes:

- extend `ProfileSchema` with `profileKey: string`
- add `profile_key` column to `profiles`
- create it from user input rather than random UUIDs
- treat it as immutable after creation
- return it from `findById`, `findByName`, `list`, and `findOrCreateDefault`
- expose it in profile CLI output so users can reuse it after rebuilds

Pseudo-code:

```ts
export const ProfileSchema = z.object({
  id: z.number(),
  profileKey: z.string().min(1),
  name: z.string().min(1),
  createdAt: z.date(),
});
```

Tests:

- new profile has a non-empty `profileKey`
- profile rename preserves `profileKey`
- `profiles list/current` show both name and key
- recreating the same logical profile with the same key yields the same stable identity material

## Phase 2: Make Account And Transaction Identity Profile-Aware

Goal:

- processed identity becomes profile-isolated without introducing explicit override scope for notes or links

Files:

- `packages/core/src/identity/fingerprints.ts`
- `packages/core/src/identity/__tests__/fingerprints.test.ts`
- `packages/core/src/__tests__/test-utils.ts`
- `packages/data/src/utils/transaction-id-utils.ts`
- `packages/data/src/utils/__tests__/transaction-id-utils.test.ts`
- `packages/data/src/repositories/transaction-repository.ts`
- `packages/data/src/repositories/__tests__/transaction-repository.test.ts`

Changes:

- extend `computeAccountFingerprint(...)` input to include `profileKey`
- stop deriving exchange identity from mutable exchange identifiers
- keep blockchain top-level identity tied to `identifier`
- derive child identities from parent identity plus child-specific identity material
- keep `computeTxFingerprint(...)` rooted in `accountFingerprint`
- update transaction insert/update tests and seed helpers to use the new fingerprint contract

Pseudo-code:

```ts
computeAccountFingerprint({
  profileKey,
  accountKind: 'exchange',
  platformKey: 'kraken',
});
```

```ts
computeAccountFingerprint({
  profileKey,
  accountKind: 'wallet',
  platformKey: 'bitcoin',
  identifier: xpubOrAddress,
});
```

Tests:

- same exchange input in two profiles yields different account and transaction fingerprints
- switching one exchange account between CSV and API mode preserves identity
- changing exchange API keys or CSV directory preserves identity
- blockchain identifier changes yield a different fingerprint
- transaction notes remain isolated across profiles because `txFingerprint` differs

## Phase 3: Enforce Exchange Identity Invariant

Goal:

- the lifecycle model enforces the assumptions baked into exchange fingerprints

Files:

- `packages/accounts/src/accounts/account-lifecycle-service.ts`
- `packages/accounts/src/accounts/account-lifecycle-service.test.ts`
- `packages/data/src/repositories/account-repository.ts`
- `packages/data/src/repositories/__tests__/account-repository.test.ts`
- account add/update command tests

Changes:

- reject a second top-level exchange account with the same `profile + platform`
- treat exchange mode changes as config updates on the same identity
- keep blockchain identifier changes disallowed as ordinary updates, or treat them as replacement-account semantics if already supported

Tests:

- duplicate exchange platform in one profile is rejected
- same exchange platform in different profiles is allowed
- exchange config updates preserve downstream fingerprints

## Phase 4: Add `requireOwned(...)` To Accounts Capability

Goal:

- remove duplicated ownership guards

Files:

- `packages/accounts/src/ports/index.ts`
- `packages/accounts/src/accounts/account-lifecycle-service.ts`
- `packages/data/src/accounts.ts`
- account lifecycle tests

Changes:

- add store method if needed, or implement via existing `findById`
- add `requireOwned(profileId, accountId)`

Pseudo-code:

```ts
async requireOwned(profileId: number, accountId: number): Promise<Result<Account, Error>> {
  const account = await this.store.findById(accountId);
  if (!account) return err(new Error(`Account ${accountId} not found`));
  if (account.profileId !== profileId) {
    return err(new Error(`Account ${accountId} does not belong to the selected profile`));
  }
  return ok(account);
}
```

Adopt it in:

- `apps/cli/src/features/import/command/import.ts`
- `apps/cli/src/features/accounts/query/account-query.ts`

## Phase 5: Make CLI Profile Resolution Universal

Goal:

- all relevant read and scoped mutation commands resolve the active profile first

Files:

- `apps/cli/src/features/balance/command/balance-view.ts`
- `apps/cli/src/features/balance/command/balance-refresh.ts`
- `apps/cli/src/features/transactions/command/transactions-view.ts`
- `apps/cli/src/features/prices/command/prices-view.ts`
- `apps/cli/src/features/assets/command/assets-view.ts`
- `apps/cli/src/features/transactions/command/transactions-edit-note.ts`
- `apps/cli/src/features/assets/command/assets-exclude.ts`
- `apps/cli/src/features/assets/command/assets-include.ts`
- `apps/cli/src/features/assets/command/assets-confirm.ts`
- `apps/cli/src/features/assets/command/assets-clear-review.ts`

Changes:

- add `--profile <name>` option
- call `resolveCommandProfile(ctx, db, options.profile)` before building handlers
- pass `profileId` and `profileKey` to downstream handlers where identity or override decisions need them

Command policy:

- `--profile` wins over active profile
- read commands must never silently fall back to workspace-global data

## Phase 6: Make Transaction Repository Profile-Aware

Goal:

- transaction reads become safely profile-scoped at the repository level

Files:

- `packages/data/src/repositories/transaction-repository.ts`
- transaction repository tests

Changes:

- extend query params:

```ts
interface TransactionQueryParams {
  profileId?: number | undefined;
  platformKey?: string | undefined;
  since?: number | undefined;
  accountId?: number | undefined;
  accountIds?: number[] | undefined;
  includeExcluded?: boolean | undefined;
}
```

- if `profileId` is provided, join `accounts` and filter by `accounts.profile_id`
- apply the same support to `count(...)`

Important:

- do not require callers to pre-resolve all owned account ids just to filter transactions
- repository-level enforcement is the correct seam here

Tests:

- same transaction query returns only transactions from the selected profile
- `profileId + accountId` rejects rows from other profiles
- `count` respects `profileId`

## Phase 7: Refactor Balance To Use Profile Scope

Goal:

- balance no longer enumerates accounts globally

Files:

- `apps/cli/src/features/balance/command/balance-handler.ts`
- `apps/cli/src/features/balance/command/balance-verification-runner.ts`
- `apps/cli/src/features/balance/command/balance-stored-snapshot-reader.ts`
- balance tests

Changes:

- thread `profileId` through public handler methods
- replace raw `db.accounts.findAll()` with `accountService.listTopLevel(profileId)`
- replace raw `getById` ownership checks with `accountService.requireOwned(profileId, accountId)`

Suggested signatures:

```ts
viewStoredSnapshots(params: {
  profileId: number;
  accountId?: number | undefined;
})
```

```ts
refreshSingleScope(params: {
  profileId: number;
  accountId: number;
  credentials?: ExchangeCredentials | undefined;
})
```

```ts
refreshAllScopes(profileId: number)
```

```ts
loadAccountsForVerification(profileId: number)
```

The `BalanceAssetDetailsBuilder` can continue using `accountIds` for descendant transactions after the root account has already been ownership-validated.

## Phase 8: Refactor Transactions And Prices

Goal:

- transaction-backed read surfaces consume the new scoped primitives first

Files:

- `apps/cli/src/features/transactions/command/transactions-read-support.ts`
- `apps/cli/src/features/prices/command/prices-view-handler.ts`
- command tests for both features

Changes:

- add `profileId` to handler inputs
- call `db.transactions.findAll({ profileId, ... })`
- keep transaction-note replay simple because `txFingerprint` is now profile-isolated by design

## Phase 9: Decide Asset Exclusion Scope, Then Refactor Assets And Links

Goal:

- finish the remaining read surfaces without overcomplicating the override store

Files:

- `apps/cli/src/features/assets/command/assets-handler.ts`
- `apps/cli/src/features/links/command/transfer-proposal-review-service.ts`
- `packages/data/src/overrides/asset-exclusion-replay.ts`
- override-store files only if asset exclusions truly need explicit profile context
- command tests for both features

Changes:

- `asset-review-*` stays global
- decide whether `asset-exclude/include` are global or explicitly profile-scoped
- if profile-scoped, use `profileKey`, ignore unknown keys during replay, and accept orphan cleanup as later maintenance work
- keep `link` and `unlink` contextless unless implementation proves otherwise

## Phase 10: Refactor Accounting Consumers

Goal:

- `cost-basis`, `portfolio`, and shared accounting inputs stop reading global transactions/accounts by default

Files:

- `packages/data/src/accounting/cost-basis-ports.ts`
- `packages/data/src/accounting/pricing-ports.ts`
- `packages/data/src/accounting/linking-ports.ts`
- `packages/data/src/accounting/price-coverage-data.ts`
- CLI handlers that compose these ports

Changes:

- add profile-aware variants of the read ports
- pass selected profile scope from CLI entrypoints

This is intentionally after the repository and command changes so the underlying transaction read seam is already correct.

## Testing Strategy

For each phase, prefer adding cross-profile tests rather than only unit-shape tests.

Minimum coverage:

- profile rename preserves `profileKey`
- exchange mode/config updates preserve processed identity
- same semantic exchange import in two profiles produces different `txFingerprint` values
- duplicate same-platform exchange account in one profile is rejected
- balance view/refresh only sees owned accounts
- transactions view only sees owned transactions
- prices view only sees owned transactions
- assets view only sees owned transactions and whichever exclusion model is chosen
- repository count/list methods respect `profileId`

## Explicit Non-Goals For This Slice

Do not do these in the same refactor unless forced:

- rename `packages/accounts`
- introduce a user-facing `accountKey`
- use email as profile identity
- add generic override-context storage up front
- scope `price` or `fx` overrides by profile
- scope `asset-review-confirm` or `asset-review-clear` by profile
- add orphan cleanup command now

## Follow-Up Work After This Slice

After the main refactor lands, consider:

- maintenance CLI for orphaned profile-scoped overrides if asset exclusions become profile-scoped
- durable profile registry outside `transactions.db` if rebuild recovery becomes a stronger requirement
- explicit product documentation for the one-exchange-account-per-platform-per-profile invariant

## Decisions And Smells

- Decision: the missing abstraction is a shared ownership guard, not a new account catalog service.
- Decision: `packages/accounts` remains the correct package name.
- Decision: `profileKey` is a human-chosen stable identity, separate from mutable profile name.
- Decision: processed identity should root in `profileKey` instead of pushing more profile context into overrides.
- Decision: no user-facing `accountKey`; exchange identity relies on a stricter lifecycle invariant instead.
- Decision: one top-level exchange account per platform per profile must be enforced in code and documented.
- Smell: read-side profile scope is currently fragmented across commands, handlers, repositories, and accounting ports.
- Smell: `asset-exclude/include` remain the only override area with unresolved scope semantics.
