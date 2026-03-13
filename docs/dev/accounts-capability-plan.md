# Accounts Package Removal Plan

This document records the decision to remove `packages/accounts`.

It is subordinate to:

- `docs/code-assistants/architecture.md`

## Decision

Do not turn `packages/accounts` into a full account capability.

Instead:

- move the accounts read model into `apps/cli`
- keep account write-side behavior in `packages/ingestion`
- move balance scope traversal out of `core` into the balance feature
- keep `packages/data` as an adapter package
- remove `packages/accounts` entirely

## Why

`packages/accounts` was a query package for one host-facing read model, not a
capability owner.

The real issues were:

- `core` owned feature-specific balance-scope traversal
- the CLI was trying to stay thin without a clear local read-model home
- the package name `accounts` encouraged broader ownership than the code
  justified

The fix is not to centralize all account behavior behind a package boundary.

The fix is to place each concern with its real owner:

- CLI read model in `apps/cli`
- balance scope semantics in `packages/ingestion/src/features/balance`
- persistence adapters in `packages/data`

## Target Shape

```text
apps/cli/src/features/accounts/
  command/
  query/
    account-query.ts
    account-query-utils.ts
    account-query-ports.ts
    build-account-query-ports.ts
  view/

packages/ingestion/src/features/balance/
  balance-scope.ts
  balance-workflow.ts

packages/data/src/adapters/
  balance-scope-utils.ts
```

## Migration Summary

1. Copy the account query slice from `packages/accounts` into
   `apps/cli/src/features/accounts/query`.
2. Replace `@exitbook/data` account-query adapter usage with a CLI-local
   builder over `DataContext`.
3. Move `balance-scope.ts` from `packages/core/src/account` to
   `packages/ingestion/src/features/balance`.
4. Update CLI and data callers to import the balance scope helper from
   `@exitbook/ingestion` or data-local wrappers.
5. Remove `packages/accounts` and all workspace/package references.

## Exit Criteria

- no source imports from `@exitbook/accounts`
- no `packages/accounts` workspace package
- `core` no longer exports balance-scope traversal
- accounts view still works through a CLI-local query module
- balance workflow, balance CLI, and projection invalidation still share one
  balance-scope implementation
