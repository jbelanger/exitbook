# CLI Surface V3 Tracker

Tracks migration status against the normative surface contract in [CLI Surface V3 Specification](/Users/joel/Dev/exitbook/docs/specs/cli/cli-surface-v3-spec.md).

## Status Key

- `done`: family matches the intended V3 surface for its current scope
- `in_progress`: actively being migrated
- `pending`: not yet aligned
- `n/a`: intentionally outside the browse-ladder contract

## Families

| Family         | Current Shape                                                   | V3 Target                                                                                                                                 | Selector Status  | Status        | Notes                                                                                  |
| -------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ------------- | -------------------------------------------------------------------------------------- |
| `profiles`     | `profiles`, `profiles add/remove/update/switch`                 | text-first admin surface                                                                                                                  | n/a              | `done`        | Explicitly text-first; no TUI family needed.                                           |
| `accounts`     | bare static list/detail, `view`, `refresh`, `add/update/remove` | same plus `refresh` as the workflow entrypoint                                                                                            | stable           | `done`        | Canonical read surface and refresh workflow now both live under `accounts`.            |
| `transactions` | bare static list/detail, `view`, `export`, `edit note`          | same                                                                                                                                      | stable           | `done`        | Root browse + TUI split aligned; export/mutation remain text/json.                     |
| `blockchains`  | bare static list/detail, `view`                                 | `blockchains`, `blockchains <selector>`, `blockchains view`, `blockchains view <selector>`                                                | stable           | `in_progress` | Root list/detail and selector semantics are landed; explorer/detail alignment remains. |
| `providers`    | `providers view`, `providers benchmark`                         | likely `providers`, `providers <selector>`, `providers view`, `providers view <selector>`, `providers benchmark` once selector is settled | not yet explicit | `pending`     | Browse family is close, but selector contract is not defined yet.                      |
| `assets`       | `assets view`, review/exclusion subcommands                     | likely bare static browse + `view`, plus existing action commands when selector semantics are settled                                     | partial          | `pending`     | Review/exclusion semantics complicate the ladder.                                      |
| `links`        | `links run`, `links view`, `links gaps`, `confirm`, `reject`    | needs family-specific decision under V3                                                                                                   | partial          | `pending`     | Has browse/review/workflow mix; likely needs a deliberate contract pass.               |
| `prices`       | `prices view`, `enrich`, `set`, `set-fx`                        | likely bare static browse + `view`, plus existing action/workflow commands when selector semantics are settled                            | partial          | `pending`     | Browse family exists, but selector/detail shape is not finalized.                      |
| `clear`        | `clear`                                                         | workflow only                                                                                                                             | n/a              | `n/a`         | Prompt-first/workflow command, not a browse ladder family.                             |
| `import`       | `import`, `import --all`                                        | workflow only                                                                                                                             | n/a              | `n/a`         | Workflow command.                                                                      |
| `reprocess`    | `reprocess`                                                     | workflow only                                                                                                                             | n/a              | `n/a`         | Workflow command.                                                                      |
| `cost-basis`   | `cost-basis`, `cost-basis export`                               | browse/report split still unclear under V3                                                                                                | partial          | `pending`     | Likely needs a dedicated surface decision before migration.                            |
| `portfolio`    | `portfolio`                                                     | may already be a browse-style TUI family, but no bare static ladder today                                                                 | partial          | `pending`     | Needs a separate V3 decision because the noun itself is the explorer today.            |

## Current Priority

1. `blockchains`
2. `providers`
3. `assets`
4. `links`
5. `prices`
6. `cost-basis`

## Notes

- `profiles` is treated as complete because V3 does not require every family to expose the browse ladder; text-first admin families are valid.
- `transactions` is considered complete for current scope even though `edit note` naming may still evolve.
- `balance` is no longer a user-facing CLI family; stored balance inspection moved into `accounts`, and live rebuild/verification lives under `accounts refresh`.
- This tracker is about user-facing shape, not internal helper refactors.
