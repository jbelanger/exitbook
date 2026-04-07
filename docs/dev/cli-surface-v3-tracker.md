# CLI Surface V3 Tracker

Tracks migration status against the normative surface contract in [CLI Surface V3 Specification](/Users/joel/Dev/exitbook/docs/specs/cli/cli-surface-v3-spec.md).

Current reset: V3 is now standardizing on `noun`, `noun list`, `noun view <selector>`, `noun explore`, and `noun explore <selector>`. Families previously marked done against the older bare-selector ladder are back in a phase-0 normalization pass until they match this contract.

## Status Key

- `done`: family matches the intended V3 surface for its current scope
- `in_progress`: actively being migrated
- `pending`: not yet aligned
- `n/a`: intentionally outside the browse-ladder contract

## Families

| Family         | Current Shape                                                                           | V3 Target                                                                                                                         | Selector Status | Status    | Notes                                                                                            |
| -------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------- | --------- | ------------------------------------------------------------------------------------------------ |
| `profiles`     | `profiles`, `list`, `view <selector>`, `add/remove/update/switch`                       | `profiles`, `profiles list`, `profiles view <selector>`, plus add/remove/update/switch                                            | stable          | `done`    | Static-only browse family; no explorer surface by design.                                        |
| `accounts`     | `accounts`, `list`, `view <selector>`, `explore [selector]`, `refresh`                  | `accounts`, `accounts list`, `accounts view <selector>`, `accounts explore [selector]`, plus `refresh` as the workflow entrypoint | stable          | `done`    | Phase-0 normalization landed; root no longer accepts bare selectors.                             |
| `transactions` | `transactions`, `list`, `view <selector>`, `explore [selector]`, `export`, `edit note`  | `transactions`, `transactions list`, `transactions view <selector>`, `transactions explore [selector]`, plus existing actions     | stable          | `done`    | Phase-0 normalization landed; root no longer accepts bare selectors.                             |
| `blockchains`  | `blockchains`, `list`, `view <selector>`, `explore [selector]`                          | `blockchains`, `blockchains list`, `blockchains view <selector>`, `blockchains explore [selector]`                                | stable          | `done`    | Phase-0 normalization landed; root no longer accepts bare selectors.                             |
| `providers`    | `providers`, `list`, `view <selector>`, `explore [selector]`, `benchmark`               | `providers`, `providers list`, `providers view <selector>`, `providers explore [selector]`, plus `providers benchmark`            | stable          | `done`    | Phase-0 normalization landed; root no longer accepts bare selectors.                             |
| `assets`       | `assets`, `list`, `view <selector>`, `explore [selector]`, review/exclusion subcommands | `assets`, `assets list`, `assets view <selector>`, `assets explore [selector]`, plus review/exclusion subcommands                 | stable          | `done`    | Phase-0 normalization landed; root no longer accepts bare selectors.                             |
| `links`        | `links run`, `links view`, `links gaps`, `confirm`, `reject`                            | likely `links`, `links list`, `links view <fingerprint>`, `links explore [fingerprint]`, plus review/workflow commands            | stable          | `pending` | Phase-0 normalization comes after already-migrated families.                                     |
| `prices`       | `prices view`, `enrich`, `set`, `set-fx`                                                | likely `prices`, `prices list`, `prices view <selector>`, `prices explore [selector]`, plus existing action/workflow commands     | partial         | `pending` | Browse family exists, but selector/detail shape is still less settled than the phase-0 families. |
| `clear`        | `clear`                                                                                 | workflow only                                                                                                                     | n/a             | `n/a`     | Prompt-first/workflow command, not a browse ladder family.                                       |
| `import`       | `import`, `import --all`                                                                | workflow only                                                                                                                     | n/a             | `n/a`     | Workflow command.                                                                                |
| `reprocess`    | `reprocess`                                                                             | workflow only                                                                                                                     | n/a             | `n/a`     | Workflow command.                                                                                |
| `cost-basis`   | `cost-basis`, `cost-basis export`                                                       | browse/report split still unclear under V3                                                                                        | partial         | `pending` | Likely needs a dedicated surface decision before migration.                                      |
| `portfolio`    | `portfolio`                                                                             | may already be a browse-style TUI family, but no bare static ladder today                                                         | partial         | `pending` | Needs a separate V3 decision because the noun itself is the explorer today.                      |

## Current Priority

1. `links`
2. `prices`
3. `cost-basis`
4. `portfolio`

## Notes

- `profiles` is treated as complete as a static-only browse family: root list, explicit `list`, and `view <selector>`, with no explorer.
- `accounts` is back to `done`.
- `transactions` has now been normalized to the phase-0 contract.
- `balance` is no longer a user-facing CLI family; stored balance inspection moved into `accounts`, and live rebuild/verification lives under `accounts refresh`.
- `blockchains` and `providers` have been normalized to the phase-0 contract.
- `accounts` has now been normalized to the phase-0 contract.
- `assets` has now been normalized to the phase-0 contract.
- `providers benchmark` remains a separate workflow command by design.
- `links` and `prices` are paused behind the phase-0 normalization pass so we do not mix two browse contracts in the shipped CLI.
- This tracker is about user-facing shape, not internal helper refactors.

## Deferred Smells

Use this section for non-blocking smells found during V3 work that are worth revisiting later.

Classification:

- `family-local`: cleanup is specific to one family and should usually be handled there.
- `cross-cutting`: likely worth a broader pass because the same pattern may exist in multiple families.

| Scope           | Area           | Smell                                                                                                                                                                                                                                                                                                 | Better handled where                                                               |
| --------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `family-local`  | `blockchains`  | [blockchains-catalog-utils.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/blockchains/command/blockchains-catalog-utils.ts) still mixes category/layer heuristics, catalog assembly, filtering, and sort order.                                                                                   | Revisit inside the `blockchains` family only if the catalog grows.                 |
| `cross-cutting` | CLI browse     | [blockchain-view-projection.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/blockchains/blockchain-view-projection.ts) reads `process.env` directly to compute API-key readiness. If this pattern repeats, projection modules are doing host/config work.                                          | Reassess across browse families after more V3 migrations land.                     |
| `family-local`  | `blockchains`  | [blockchains-option-schemas.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/blockchains/command/blockchains-option-schemas.ts) is still a generic filename even though it now exports only `BlockchainsBrowseCommandOptionsSchema`.                                                                | Low-priority naming cleanup in the `blockchains` command folder.                   |
| `cross-cutting` | CLI workflows  | [spinner.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/shared/spinner.ts) is a thin Ora wrapper and does not encode when animated spinners are acceptable under V3. Workflow commands currently decide TTY vs durable-progress behavior individually.                                            | Reassess after more workflow migrations, not inside one family.                    |
| `family-local`  | `assets`       | [asset-snapshot-reader.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/assets/command/asset-snapshot-reader.ts) now owns freshness checks, snapshot assembly, selector resolution, and browse-item projection. It is still coherent, but it is the first file to split if the family grows.        | Revisit inside the `assets` family only if more browse behavior lands.             |
| `family-local`  | `transactions` | [transactions-explore.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/transactions/command/transactions-explore.ts) now owns selector resolution, static fallback, TUI bootstrap, and inline export orchestration. It is still coherent, but it is the first place to split if the explorer grows. | Revisit inside the `transactions` family only if the explorer gains more behavior. |
| `cross-cutting` | CLI docs       | Browse-family specs are still named `*-view-spec.md` even when they now define the full family contract (`noun`, `list`, `view`, `explore`, workflow notes). The content is correct, but the file naming is drifting from the actual surface model.                                                   | Revisit across specs after the phase-0 normalization pass is complete.             |
