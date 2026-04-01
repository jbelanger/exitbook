# Account Selector Migration

Temporary tracker for migrating CLI account targeting away from `--account` / `--account-id` and toward explicit account selectors:

- `--account-name <name>` for human-facing account names
- `--account-ref <ref>` for persisted account fingerprint prefixes

Internal numeric `accountId` remains valid after selector resolution. This tracker is only about user-facing CLI surfaces, help text, JSON filter metadata, and user-facing error/hint copy.

| Area        | Command / Surface                      | Current user-facing selector               | Target selector                                              | Key code sites                                                                                                                                                                                | Status  | Notes                                                                                                |
| ----------- | -------------------------------------- | ------------------------------------------ | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------- |
| Accounts    | `accounts`, `accounts view`            | `--account-id`, bare selector by name only | `--account-ref`, bare selector by name or fingerprint prefix | `apps/cli/src/features/accounts/command/accounts.ts`<br>`apps/cli/src/features/accounts/command/accounts-view.ts`<br>`apps/cli/src/features/accounts/command/accounts-browse-support.ts`      | Done    | Already migrated. Static list now displays fingerprint refs.                                         |
| Import      | `import`                               | `--account`, `--account-id`, `--all`       | `--account-name`, `--account-ref`, `--all`                   | `apps/cli/src/features/import/command/import.ts`<br>`apps/cli/src/features/import/command/import-option-schemas.ts`<br>`apps/cli/src/features/import/command/run-import.ts`                   | Done    | Selector resolution now happens before import workflow receives internal `accountId`.                |
| Balance     | `balance view`                         | `--account-id`                             | `--account-ref` and `--account-name`                         | `apps/cli/src/features/balance/command/balance-view.ts`<br>`apps/cli/src/features/balance/command/balance-option-schemas.ts`<br>`apps/cli/src/features/balance/command/run-balance.ts`        | Done    | JSON `filters` metadata now carries `accountName` / `accountRef`.                                    |
| Balance     | `balance refresh`                      | `--account-id`                             | `--account-ref` and `--account-name`                         | `apps/cli/src/features/balance/command/balance-refresh.ts`<br>`apps/cli/src/features/balance/command/balance-option-schemas.ts`<br>`apps/cli/src/features/balance/command/run-balance.ts`     | Done    | Credential override validation now requires an explicit name/ref selector instead of `--account-id`. |
| Balance     | Freshness hints / assets guidance      | `balance refresh --account-id ...`         | `balance refresh --account-ref ...`                          | `apps/cli/src/features/shared/balance-snapshot-freshness-message.ts`<br>`apps/cli/src/features/assets/command/__tests__/asset-command-services.test.ts`                                       | Done    | Remediation copy now points to `--account-ref`, matching selector UX.                                |
| Clear       | `clear`                                | `--account-id`                             | `--account-ref` and `--account-name`                         | `apps/cli/src/features/clear/command/clear.ts`<br>`apps/cli/src/features/clear/command/clear-option-schemas.ts`<br>`apps/cli/src/features/clear/command/clear-service.ts`                     | Done    | CLI resolves selectors before building internal `accountId[]` scope params.                          |
| Reprocess   | `reprocess`                            | `--account-id`                             | `--account-ref` and `--account-name`                         | `apps/cli/src/features/reprocess/command/reprocess.ts`<br>`apps/cli/src/features/reprocess/command/reprocess-option-schemas.ts`<br>`apps/cli/src/features/reprocess/command/run-reprocess.ts` | Done    | Internal `prepareReprocess({ accountId })` stays unchanged after selector resolution.                |
| Shared help | root CLI examples and feature examples | mixed `--account` / `--account-id`         | `--account-name` / `--account-ref`                           | `apps/cli/src/cli.ts`<br>`apps/cli/src/features/blockchains/view/blockchains-view-components.tsx`<br>`apps/cli/src/features/balance/view/balance-view-components.tsx`                         | Done    | Updated user-facing examples in CLI/TUI surfaces that pointed to the old flags.                      |
| Specs       | CLI docs that describe selectors       | mixed `--account`, `--account-id`          | `--account-name` / `--account-ref`                           | `docs/specs/cli/**/*.md`                                                                                                                                                                      | Pending | Update after code lands so docs reflect final behavior.                                              |

## Execution order

1. Introduce a shared CLI account selector resolver that accepts name or fingerprint prefix and returns the owned account.
2. Migrate `import` first because it already distinguishes name-vs-id semantics in the surface.
3. Migrate `balance view` and `balance refresh` together so balance hints and refresh guidance stay consistent.
4. Migrate `clear` and `reprocess`.
5. Sweep remaining user-facing examples, tests, and specs.

## Cleanup phase

Status: In progress

| Cleanup item                                                     | Scope                                                  | Status | Notes                                                                                                         |
| ---------------------------------------------------------------- | ------------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------- |
| Replace string-matched ambiguous-ref handling with a typed error | `packages/core`, `packages/data`, CLI selector helpers | Done   | `AmbiguousAccountFingerprintRefError` is now the contract between repo and CLI.                               |
| Centralize optional/required selector resolution                 | `apps/cli/src/features/accounts/account-selector.ts`   | Done   | Added shared `hasAccountSelector`, `resolveRequiredOwnedAccountSelector`, and JSON filter helpers.            |
| Remove command-local selector wrappers                           | `import`, `clear`, `balance refresh`, `reprocess`      | Done   | `resolveImportAccount`, `resolveClearAccountSelection`, and `hasSingleAccountSelector` are gone.              |
| Keep browse-selector handling coherent                           | `accounts-browse-support.ts`, shared selector helpers  | Done   | Bare selector resolution now goes through the shared selector module instead of bespoke browse code.          |
| Remove asset freshness presentation lookup                       | `asset-snapshot-reader.ts`                             | Done   | Assets freshness messaging now uses already-loaded top-level account data instead of querying accounts again. |
