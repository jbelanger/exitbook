# Account Selector Migration Plan

## Purpose

Phase 0 consolidates existing-account targeting onto one rule across the CLI:

- use bare `<selector>` whenever a command targets one existing account
- use `--account <selector>` only when an option-shaped account filter is needed
- resolve `<selector>` the same way everywhere:
  1. account name
  2. unique fingerprint prefix
- remove `--account-name` and `--account-ref` from the CLI surface

This is a temporary implementation tracker for the migration work across command entrypoints, shared helpers, specs, and tests.

## Phase 0 Contract

### In scope

- `exitbook accounts --account <selector>`
- `exitbook accounts view --account <selector>`
- `exitbook accounts remove <selector>`
- `exitbook accounts update <selector> ...`
- `exitbook accounts rename <selector> <next-name>`
- `exitbook import <selector>`
- `exitbook reprocess [selector]`
- `exitbook balance view [selector]`
- `exitbook balance refresh [selector]`
- `exitbook clear [selector]`

### Out of scope

- `exitbook accounts add <name> ...`
  - `add` creates a new account, so its positional remains the new account name
- non-account selectors
  - asset, transaction, provider, and blockchain selectors are separate follow-up work

## Target Command Shapes

| Area                | Current shape                                                   | Phase 0 shape                            |
| ------------------- | --------------------------------------------------------------- | ---------------------------------------- |
| Accounts remove     | `accounts remove <name>`                                        | `accounts remove <selector>`             |
| Accounts update     | `accounts update <name> [flags]`                                | `accounts update <selector> [flags]`     |
| Accounts rename     | `accounts rename <current-name> <next-name>`                    | `accounts rename <selector> <next-name>` |
| Import single       | `import --account-name <name>` / `import --account-ref <ref>`   | `import <selector>`                      |
| Import all          | `import --all`                                                  | `import --all`                           |
| Reprocess one       | `reprocess --account-name <name>` / `--account-ref <ref>`       | `reprocess <selector>`                   |
| Reprocess all       | `reprocess`                                                     | `reprocess`                              |
| Balance view one    | `balance view --account-name <name>` / `--account-ref <ref>`    | `balance view <selector>`                |
| Balance refresh one | `balance refresh --account-name <name>` / `--account-ref <ref>` | `balance refresh <selector>`             |
| Clear scoped        | `clear --account-name <name>` / `--account-ref <ref>`           | `clear <selector>`                       |
| Clear bulk          | `clear`, `clear --platform <name>`                              | unchanged                                |

### Behavioral rules

- bare `<selector>` is the only direct single-account targeting form in Phase 0
- `--account <selector>` is the only option-shaped account filter in Phase 0
- help text should say `selector (account name or fingerprint prefix)` the first time it appears on a command
- not-found copy should prefer `Account selector '<value>' not found` unless the command is explicitly ref-only
- ambiguity behavior stays unchanged: ambiguous fingerprint prefixes fail with invalid args
- commands that already support all-accounts behavior keep that behavior
  - `reprocess` with no selector still means all accounts
  - `balance view` with no selector still means all scopes
  - `balance refresh` with no selector still means all scopes
  - `clear` with no selector still means the current clear scope rules
- `import` keeps `--all` so single-account and batch sync remain explicit

## Why Phase 0 Exists

Browse commands already teach a stable selector model:

- `accounts <selector>`
- `accounts view <selector>`

The rest of the CLI still teaches flag-shaped targeting:

- `--account-name`
- `--account-ref`

That drift has three costs:

1. users must remember two targeting models for the same object
2. command help and specs keep duplicating the same distinction
3. mutation handlers stay name-oriented internally, which makes selector consistency harder than it should be

## Required Implementation Order

The work should happen in this order. Do not start with broad help-text edits first. The command surface depends on a shared selector contract and an account-id-based mutation boundary.

### 1. Shared selector primitive

Primary files:

- `apps/cli/src/features/accounts/account-selector.ts`
- `apps/cli/src/features/accounts/__tests__/account-selector.test.ts`

Required changes:

- add a bare-selector schema for positional account targeting
- expose one helper for `name -> ref fallback` resolution that is safe to use outside browse commands
- keep browse filter helpers separate from bare selector helpers

Implementation target:

```ts
const OptionalBareAccountSelectorSchema = z.object({
  selector: z.string().trim().min(1).optional(),
});

async function resolveOwnedCommandAccountSelector(
  accountService,
  profileId,
  selector: string | undefined
): Promise<Result<ResolvedAccountSelector | undefined, Error>> {
  if (!selector) return ok(undefined);
  return resolveOwnedOptionalAccountSelector(accountService, profileId, selector);
}
```

Notes:

- use the existing browse resolution order instead of rebuilding it in each command
- preserve the current normalized error messages for ambiguous and missing refs

### 2. Move account mutations onto account-id targeting

Primary files:

- `packages/accounts/src/accounts/account-lifecycle-service.ts`
- `apps/cli/src/features/accounts/account-service.ts`

Current problem:

- `rename(profileId, currentName, nextName)` is name-based
- `update(profileId, name, input)` is name-based

That forces every mutation caller to look up by name even when the CLI has already resolved a selector to an owned account.

Required changes:

- add account-id-based mutation entrypoints
- keep profile ownership enforcement inside the lifecycle service
- update callers to resolve once in the CLI, then mutate by `account.id`

Implementation target:

```ts
async renameOwned(profileId: number, accountId: number, nextName: string)
async updateOwned(profileId: number, accountId: number, input: UpdateAccountInput)
```

Pseudo-code:

```ts
const account = yield * (await this.requireOwned(profileId, accountId));
const nextNameResult = this.normalizeAccountName(nextName);
const availability = yield * (await this.ensureAccountNameAvailable(profileId, nextNameResult.value, account.id));
yield * (await this.store.update(account.id, { name: nextNameResult.value }));
return this.reloadAccount(account.id);
```

This is Phase 0 critical path work. Do not defer it.

TODO: long-term, decide whether `rename` remains a separate verb or collapses into `accounts update <selector> --name <next-name>`.

### 3. Convert account mutation commands

#### `apps/cli/src/features/accounts/command/accounts-update.ts`

Required changes:

- change `.argument('<name>', 'Account name')` to `.argument('<selector>', 'Account selector (name or fingerprint prefix)')`
- resolve the selector before building the update draft
- call the new id-based lifecycle method
- update help examples to show both name and ref selector usage
- change description from `Update sync config for an account` to `Update account properties`

Pseudo-code:

```ts
const selection = yield* toCliResult(
  await resolveOwnedAccountSelector(accountService, profile.id, selector),
  getAccountSelectorErrorExitCode(...)
);
const draft = yield* toCliResult(buildUpdateAccountInput(selection.account, options, registry), ExitCodes.INVALID_ARGS);
const updated = yield* toCliResult(
  await accountService.updateOwned(profile.id, selection.account.id, draft),
  ExitCodes.GENERAL_ERROR
);
```

#### `apps/cli/src/features/accounts/command/accounts-remove.ts`

Required changes:

- rename positional argument from `<name>` to `<selector>`
- pass selector semantics through the whole removal flow
- update prompt wording and errors to use `account` / `account selector`, not `name`

Related files:

- `apps/cli/src/features/accounts/command/run-accounts-remove.ts`
- `apps/cli/src/features/accounts/command/accounts-remove-command-scope.ts`
- `apps/cli/src/features/accounts/command/__tests__/accounts-lifecycle-commands.test.ts`

#### `apps/cli/src/features/accounts/command/accounts-rename.ts`

Required changes:

- change `.argument('<current-name>')` to `.argument('<selector>')`
- resolve selector first
- call the new id-based rename method
- keep `<next-name>` positional as-is

TODO: if `rename` stays in Phase 0, keep it selector-consistent. Do not leave it as the one command that still requires a name.

### 4. Convert workflow commands

#### Import

Primary files:

- `apps/cli/src/features/import/command/import.ts`
- `apps/cli/src/features/import/command/import-option-schemas.ts`
- `apps/cli/src/features/import/command/__tests__/import-command.test.ts`

Target shape:

- `exitbook import <selector>`
- `exitbook import --all`

Required changes:

- add optional positional `[selector]`
- remove `--account-name` and `--account-ref`
- validate `exactly one of [selector, --all]`
- update warning and hint copy that still prints `import --account-name ...`

Pseudo-code:

```ts
if (options.all) return runImportAll(...);
const selection = yield* await resolveRequiredOwnedCommandAccountSelector(..., options.selector, 'Import requires an account selector or --all');
return runImport(..., { accountId: selection.account.id });
```

TODO: the `--all` split is still a little asymmetrical next to commands where no selector means all. Keep it for now because import is a materially different workflow when it runs across every account.

#### Reprocess

Primary files:

- `apps/cli/src/features/reprocess/command/reprocess.ts`
- `apps/cli/src/features/reprocess/command/reprocess-option-schemas.ts`
- `apps/cli/src/features/reprocess/command/__tests__/reprocess-command.test.ts`

Target shape:

- `exitbook reprocess`
- `exitbook reprocess <selector>`

Required changes:

- add optional positional `[selector]`
- remove `--account-name` and `--account-ref`
- treat missing selector as full-scope reprocess

#### Balance

Primary files:

- `apps/cli/src/features/balance/command/balance-view.ts`
- `apps/cli/src/features/balance/command/balance-refresh.ts`
- `apps/cli/src/features/balance/command/balance-option-schemas.ts`
- `apps/cli/src/features/balance/command/__tests__/balance-command-json.test.ts`
- `apps/cli/src/features/balance/command/__tests__/balance-command-services.test.ts`
- `apps/cli/src/features/shared/balance-snapshot-freshness-message.ts`

Target shapes:

- `exitbook balance view`
- `exitbook balance view <selector>`
- `exitbook balance refresh`
- `exitbook balance refresh <selector>`

Required changes:

- replace account target flags with optional positional selector
- keep credential override validation, but make it require a selector instead of flag presence
- update stale snapshot guidance to print `exitbook balance refresh <selector>` rather than `--account-ref <ref>`

Pseudo-code:

```ts
const selection = await resolveOwnedCommandAccountSelector(scope.accountService, scope.profile.id, options.selector);
const accountId = selection.value?.account.id;
```

TODO: decide whether refresh guidance should prefer the originally typed selector or the resolved ref. Phase 0 can safely print the canonical fingerprint ref if carrying the original input through every layer adds too much churn.

#### Clear

Primary files:

- `apps/cli/src/features/clear/command/clear.ts`
- `apps/cli/src/features/clear/command/clear-option-schemas.ts`
- `apps/cli/src/features/clear/command/clear-terminal.ts`
- `apps/cli/src/features/clear/command/clear-tui.ts`
- `apps/cli/src/features/clear/command/__tests__/clear-command.test.ts`

Target shapes:

- `exitbook clear`
- `exitbook clear <selector>`
- `exitbook clear --platform <name>`

Required changes:

- add optional positional `[selector]`
- remove account target flags
- keep selector and `--platform` mutually exclusive
- route both terminal and TUI flows through the same positional selector resolution

TODO: clear already mixes scope selection and destructive toggles in one command. If the help text still feels dense after the selector cleanup, revisit the command surface separately instead of expanding Phase 0.

### 5. Sweep specs, help text, and downstream examples

Primary spec files to update in Phase 0:

- `docs/specs/cli/cli-surface-v3-spec.md`
- `docs/specs/cli/cli-design-language-spec.md`
- `docs/specs/cli/accounts/accounts-view-spec.md`
- `docs/specs/cli/reprocess/reprocess-spec.md`
- `docs/specs/cli/balance/balance-view-spec.md`
- `docs/specs/cli/clear/clear-view-spec.md`

Secondary example-only sites that will drift if we skip them:

- `docs/specs/cli/transactions/transactions-view-spec.md`
- `docs/specs/cli/blockchains/blockchains-view-spec.md`
- `docs/specs/cli/assets/assets-view-spec.md`
- `docs/specs/cli/portfolio/portfolio-view-spec.md`
- `docs/specs/cli/cost-basis/cost-basis-view-spec.md`
- `docs/specs/cli/providers/providers-view-spec.md`
- `docs/specs/cli/prices/prices-view-spec.md`

Required changes:

- remove explicit account target flags from user-facing examples when the command now accepts `<selector>`
- update identifier guidance so account selectors are described as positional command selectors where applicable
- replace browse-only `accounts --account-ref` documentation with `--account <selector>`

TODO: `docs/specs/cli/accounts/accounts-view-spec.md` now documents the browse family, not just `view`. Renaming the file to `accounts-browse-spec.md` is cleaner, but it is not required for Phase 0.

## Site Inventory

### Shared code

- `apps/cli/src/features/accounts/account-selector.ts`
- `apps/cli/src/features/accounts/__tests__/account-selector.test.ts`
- `packages/accounts/src/accounts/account-lifecycle-service.ts`
- `apps/cli/src/features/accounts/account-service.ts`

### Account commands

- `apps/cli/src/features/accounts/command/accounts-update.ts`
- `apps/cli/src/features/accounts/command/accounts-remove.ts`
- `apps/cli/src/features/accounts/command/run-accounts-remove.ts`
- `apps/cli/src/features/accounts/command/accounts-rename.ts`
- `apps/cli/src/features/accounts/command/__tests__/accounts-lifecycle-commands.test.ts`

### Workflow commands

- `apps/cli/src/features/import/command/import.ts`
- `apps/cli/src/features/import/command/import-option-schemas.ts`
- `apps/cli/src/features/import/command/__tests__/import-command.test.ts`
- `apps/cli/src/features/reprocess/command/reprocess.ts`
- `apps/cli/src/features/reprocess/command/reprocess-option-schemas.ts`
- `apps/cli/src/features/reprocess/command/__tests__/reprocess-command.test.ts`
- `apps/cli/src/features/balance/command/balance-view.ts`
- `apps/cli/src/features/balance/command/balance-refresh.ts`
- `apps/cli/src/features/balance/command/balance-option-schemas.ts`
- `apps/cli/src/features/balance/command/__tests__/balance-command-json.test.ts`
- `apps/cli/src/features/balance/command/__tests__/balance-command-services.test.ts`
- `apps/cli/src/features/shared/balance-snapshot-freshness-message.ts`
- `apps/cli/src/features/clear/command/clear.ts`
- `apps/cli/src/features/clear/command/clear-option-schemas.ts`
- `apps/cli/src/features/clear/command/clear-terminal.ts`
- `apps/cli/src/features/clear/command/clear-tui.ts`
- `apps/cli/src/features/clear/command/__tests__/clear-command.test.ts`

### Specs and docs

- `docs/specs/cli/cli-surface-v3-spec.md`
- `docs/specs/cli/cli-design-language-spec.md`
- `docs/specs/cli/accounts/accounts-view-spec.md`
- `docs/specs/cli/reprocess/reprocess-spec.md`
- `docs/specs/cli/balance/balance-view-spec.md`
- `docs/specs/cli/clear/clear-view-spec.md`
- secondary example sites listed above

## Acceptance Checklist

Phase 0 is complete when all of the following are true:

- no account-targeting workflow command still documents `--account-name` or `--account-ref`
- the command surface for single-account targeting is positional everywhere in scope
- browse selector resolution and workflow/mutation selector resolution share the same logic
- account mutations resolve the selector once, then mutate by account id
- stale guidance, hints, and examples no longer teach removed flag syntax
- targeted tests cover:
  - name selector success
  - ref selector success
  - ambiguous ref failure
  - missing selector failure where the command requires one
  - selector + incompatible scope option conflict

## Suggested Execution Order

1. `account-selector.ts` shared primitive cleanup
2. `account-lifecycle-service.ts` id-based mutation methods
3. `accounts update`, `accounts remove`, `accounts rename`
4. `import`
5. `reprocess`
6. `balance view` and `balance refresh`
7. `clear`
8. specs and example sweeps
9. final test/help snapshot pass

## TODOs To Revisit After Phase 0

TODO: Decide whether `accounts rename` should survive as a permanent verb or become `accounts update <selector> --name <next-name>`.

TODO: Standardize copy around `selector`, `fingerprint prefix`, `fingerprint ref`, and `account ref`. Right now the product language is still mixed.

TODO: Revisit whether `import --all` should remain explicit or whether future workflow families should use a more uniform all-scopes convention.

TODO: Audit other command families for the same drift once account selectors are stable. This pattern will likely repeat for assets, prices, and other domain selectors.
