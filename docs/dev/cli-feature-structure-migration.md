# CLI Feature Structure Migration

This document defines the target folder shape for `apps/cli/src/features/*`
after the `cost-basis` cleanup.

The goal is not "make every command identical." The goal is:

- the same top-level vocabulary across CLI features
- predictable locations for command wiring vs TUI code
- fewer feature folders that mix handlers, prompts, view state, and components
- fewer cross-feature imports into another feature's internals

## Decision

Use this top-level structure for CLI features:

```text
apps/cli/src/features/<feature>/
  command/
    <feature>.ts
    <feature>-handler.ts
    <feature>-utils.ts
    <feature>-prompts.tsx
    <subcommand>.ts
    <subcommand>-handler.ts
    <subcommand>-utils.ts
    *.test.ts
    test-utils.ts
  view/
    <feature>-view-components.tsx
    <feature>-view-controller.ts
    <feature>-view-state.ts
    <feature>-view-utils.ts
    <feature>-run-components.tsx
    <feature>-run-state.ts
    <feature>-run-updater.ts
    *.test.ts
    test-utils.ts
  <feature>-types.ts only when shared by both command/ and view/
  <feature>-shared.ts only when shared by both command/ and view/
```

Use singular directory names:

- `command/`, not `commands/`
- `view/`, not `views/`

Keep `command/` and `view/` flat by default. Do not introduce subcommand
subdirectories as part of this migration unless a feature already becomes
unreadable after the root-smell cleanup.

Shared cross-feature UI helpers do not stay inside a feature. Move them to:

- `apps/cli/src/features/shared/` for command/runtime helpers
- `apps/cli/src/ui/shared/` for generic Ink/UI helpers

Example:

- `formatCryptoQuantity()` now lives in
  `apps/cli/src/features/shared/crypto-format.ts`
- `portfolio` should import that shared formatter, not reach into
  `cost-basis/view/`

## Rules

### 1. Command entrypoints live in `command/`

For every migrated feature:

- the root command registration file moves to `command/<feature>.ts`
- namespaced subcommands move to `command/<subcommand>.ts`
- handlers, prompts, option builders, JSON output builders, and command-only
  helpers live beside the command entrypoint that owns them
- `apps/cli/src/index.ts` imports `./features/<feature>/command/<feature>.js`

This keeps the Commander surface area in one place and matches the two-tier
handler pattern in `docs/code-assistants/cli-command-wiring.md`.

Why singular `command/` instead of `commands/`:

- the directory names describe the slice type, not a bag of files
- `cost-basis` already established `command/` and `view/`
- renaming to plurals would add broad churn without fixing any real smell
- `commands/view/` or `views/view/` would still be awkward once subcommand
  nesting appears

### 1a. Subcommand grouping stays flat unless proven necessary

For multi-command features such as `links`, `prices`, `providers`, and
`transactions`:

- keep subcommand files directly under `command/`
- keep subcommand-specific Ink files directly under `view/`
- distinguish ownership with file names, not extra directory depth

Default:

```text
command/
  prices.ts
  prices-view.ts
  prices-enrich.ts
  prices-set.ts

view/
  prices-view-components.tsx
  prices-enrich-components.tsx
```

Do not default to:

```text
command/
  view/
  enrich/
  set/

view/
  view/
  enrich/
```

That nested shape creates two problems:

- it adds path depth without reducing ambiguity much at the current repo size
- it creates awkward names for the `view` subcommand, especially inside `view/`

Only introduce a second-level subcommand folder later if all of these are true:

- one subcommand owns multiple peer files in the same slice
- the flat prefix form has become hard to scan in code review
- the folder can be named for a real capability, not just `view/`

If that ever happens, the nested folder is an exception for that feature, not a
new default for the repo.

### 2. TUI code lives in `view/`

If a feature renders an Ink app, move these into `view/`:

- `*-view-components.tsx`
- `*-view-controller.ts`
- `*-view-state.ts`
- `*-view-utils.ts`
- other monitor-specific view files such as `*-run-components.tsx`,
  `*-run-state.ts`, and `*-run-updater.ts`

Do not keep a generic `components/` barrel as the primary feature boundary.
Import concrete files directly.

### 3. Feature-root exceptions stay narrow

The feature root is not forbidden, but it is an exception path.

Allowed at the feature root:

- neutral shared types used by both slices, such as `<feature>-types.ts`
- neutral shared helpers used by both slices, such as `<feature>-shared.ts`

Not allowed at the feature root after migration:

- command registration files
- handlers
- prompts
- view components, controllers, state, or view-only helpers
- a root file with a misleading `*-view-*` name when it is actually shared by
  both command and view

If a file is shared by both slices but the current name implies a single slice,
rename it to a neutral name during migration.

Examples of likely renames:

- `providers-view-utils.ts` -> `providers-shared.ts` or a more specific neutral
  name if it remains shared
- `transactions-view-utils.ts` -> split or rename if export code still depends
  on it
- `balance-debug.ts` -> `balance-diagnostics.ts` or move it into the owning
  slice

### 3a. Resolve smells by ownership, not by more folders

When a file smells wrong, fix the ownership first:

- if only Commander wiring imports it, move it to `command/`
- if only Ink code imports it, move it to `view/`
- if both slices import it, rename it to a neutral shared name at the feature
  root
- if another feature imports it, extract it to `features/shared/` or
  `ui/shared/`

Do not respond to an ownership smell by creating another vague folder such as:

- `components/`
- `helpers/`
- `lib/`
- `misc/`

### 4. Cross-feature helpers must be extracted

If a feature imports from `apps/cli/src/features/<other-feature>/...`, that is a
migration smell.

Move those helpers to:

- `features/shared/` if the helper is host-level or command-level
- `ui/shared/` if the helper is generic TUI logic

Current repo examples that must be eliminated as part of this migration:

- `features/shared/ingestion-infrastructure.ts` imports
  `../import/components/ingestion-monitor-view-components.jsx`
- `features/shared/projection-runtime.ts` imports
  `../links/components/links-run-components.jsx`
- `features/shared/projection-runtime.ts` imports
  `../prices/components/prices-enrich-components.jsx`
- `features/shared/projection-runtime.ts` imports `../prices/prices-utils.js`
- `providers/providers-view-utils.ts` imports
  `../blockchains/blockchains-view-utils.js`

Those dependencies should either move into:

- `apps/cli/src/features/shared/` if they are CLI-runtime concerns
- `apps/cli/src/ui/shared/` if they are reusable monitors or controller helpers

### 5. Tests move with the slice they verify

When a file moves:

- move its test into the same slice directory
- keep `test-utils.ts` beside the tests that share it
- do not leave one large feature-root `__tests__/` folder when the code is now
  split into `command/` and `view/`

### 6. Keep the feature root thin

After migration, the feature root should usually contain:

- `command/`
- `view/` if the feature is interactive
- at most one or two neutral shared files
- no dead barrels
- no leftover empty directories

If a feature root still contains many files after migration, that is a signal to
revisit ownership or extract shared runtime/UI code, not a reason to rename the
top-level slices to `commands/` and `views/`.

## Current State Snapshot

This is the actual March 8, 2026 repo shape, not an aspirational grouping:

| Feature        | Current state                                                              | Migration target                                                                                                                  |
| -------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `cost-basis`   | Already split into `command/` + `view/`                                    | Reference implementation                                                                                                          |
| `accounts`     | Root command files plus `components/` barrel                               | Move namespace + view subcommand into `command/`; move Ink files into `view/`                                                     |
| `balance`      | Single command with handler, debug/explain helpers, and `components/`      | Move command files into `command/`, Ink files into `view/`, keep only neutral shared helpers at root if still needed              |
| `blockchains`  | Root namespace files plus `components/`                                    | Same split as `accounts`                                                                                                          |
| `clear`        | Single command plus `components/`                                          | Same split as `balance`                                                                                                           |
| `import`       | Root command files plus ingestion monitor `components/`                    | Move command files into `command/`; move ingestion monitor UI into `view/`; extract any monitor reused by shared runtime          |
| `links`        | Root namespace files, many subcommands, shared `__tests__/`, `components/` | Move subcommands/handlers into `command/`, monitors and view files into `view/`, keep only neutral shared files at root if needed |
| `portfolio`    | Single command, handler, types, utils, `components/`                       | Move command files into `command/`, Ink files into `view/`, keep types at root only if still shared by both slices                |
| `prices`       | Root namespace files, multiple subcommands, `components/`                  | Same split as `links`                                                                                                             |
| `providers`    | Root namespace files, benchmark files, `components/`                       | Same split as `links`; also remove dependency on `blockchains` internals                                                          |
| `reprocess`    | Root command files, no feature-local TUI folder                            | Move command files into `command/`; no `view/` needed unless a local monitor is introduced                                        |
| `transactions` | Root namespace files, export files, `components/`                          | Move namespace and subcommands into `command/`, Ink files into `view/`, rename or split any shared non-view helpers               |

## Reference: Cost-Basis

Current reference shape:

```text
apps/cli/src/features/cost-basis/
  command/
    cost-basis.ts
    cost-basis-handler.ts
    cost-basis-prompts.tsx
    cost-basis-utils.ts
    cost-basis-handler.test.ts
    cost-basis-utils.test.ts
  view/
    cost-basis-view-components.tsx
    cost-basis-view-controller.ts
    cost-basis-view-state.ts
    cost-basis-view-utils.ts
```

This is the reference to migrate the other CLI features toward.

## Target Shapes By Family

### A. Namespaced view commands

Applies to:

- `accounts`
- `blockchains`

Target shape:

```text
apps/cli/src/features/<feature>/
  command/
    <feature>.ts
    <feature>-view.ts
    <feature>-view-handler.ts
    <feature>-view-utils.ts
    *.test.ts
  view/
    <feature>-view-components.tsx
    <feature>-view-controller.ts
    <feature>-view-state.ts
    *.test.ts
```

### B. Single-command interactive features

Applies to:

- `portfolio`
- `balance`
- `clear`

Target shape:

```text
apps/cli/src/features/<feature>/
  command/
    <feature>.ts
    <feature>-handler.ts
    <feature>-utils.ts
    <feature>-prompts.tsx
    *.test.ts
  view/
    <feature>-view-components.tsx
    <feature>-view-controller.ts
    <feature>-view-state.ts
    <feature>-view-utils.ts
    *.test.ts
  <feature>-types.ts or <feature>-shared.ts only if both slices import it
```

Notes:

- `balance-debug.ts` should not stay at the root under that name if it is
  slice-owned. Either move it into the owning slice or rename it to a neutral
  shared name if both slices truly depend on it.
- `portfolio-types.ts` is a legitimate root candidate only if both
  `command/portfolio-handler.ts` and `view/*` still import it after migration.

### C. Namespaced mixed command families

Applies to:

- `transactions`
- `prices`
- `links`
- `providers`

These need one extra rule:

- put subcommand entrypoints and handlers under `command/`
- keep feature-local shared files at the feature root only if they are reused
  across multiple subcommands or across command + view, and rename them to a
  neutral name
- do not create per-subcommand folders during this migration unless the flat
  form becomes materially harder to read after the other smells are removed

#### Target shape for `transactions`

```text
apps/cli/src/features/transactions/
  command/
    transactions.ts
    transactions-view.ts
    transactions-export.ts
    transactions-export-handler.ts
    transactions-export-utils.ts
    *.test.ts
  view/
    transactions-view-components.tsx
    transactions-view-controller.ts
    transactions-view-state.ts
    *.test.ts
  transactions-shared.ts if export and view still share filtering or mapping logic
```

#### Target shape for `prices`

```text
apps/cli/src/features/prices/
  command/
    prices.ts
    prices-view.ts
    prices-view-handler.ts
    prices-enrich.ts
    prices-enrich-handler.ts
    prices-set.ts
    prices-set-handler.ts
    prices-set-fx.ts
    prices-set-fx-handler.ts
    prices-utils.ts
    *.test.ts
  view/
    prices-view-components.tsx
    prices-view-controller.ts
    prices-view-state.ts
    prices-view-utils.ts
    prices-enrich-components.tsx
    prices-enrich-state.ts
    prices-enrich-updater.ts
    *.test.ts
```

#### Target shape for `links`

```text
apps/cli/src/features/links/
  command/
    links.ts
    links-view.ts
    links-run.ts
    links-confirm.ts
    links-reject.ts
    links-view-handler.ts
    links-run-handler.ts
    links-confirm-handler.ts
    links-reject-handler.ts
    links-utils.ts
    links-gap-utils.ts
    links-override-utils.ts
    *.test.ts
    test-utils.ts
  view/
    links-view-components.tsx
    links-view-controller.ts
    links-view-state.ts
    links-view-utils.ts
    links-run-components.tsx
    links-run-state.ts
    links-run-updater.ts
    link-action-result.tsx
    *.test.ts
```

#### Target shape for `providers`

```text
apps/cli/src/features/providers/
  command/
    providers.ts
    providers-view.ts
    providers-view-handler.ts
    providers-benchmark.ts
    providers-benchmark-handler.ts
    *.test.ts
  view/
    providers-view-components.tsx
    providers-view-controller.ts
    providers-view-state.ts
    benchmark-components.tsx
    benchmark-state.ts
    *.test.ts
  benchmark-tool.ts only if the benchmark handler and benchmark view both import it
  providers-shared.ts only if view and command still share provider summary logic
  providers-benchmark-shared.ts only if benchmark command and benchmark view still share params or config helpers
```

### D. Runtime-first ingestion/projection features

Applies to:

- `import`
- `reprocess`

These may not expose a normal feature-local browse view, but they still follow
the same ownership rule:

- command wiring stays in `command/`
- any feature-owned monitor UI stays in `view/`
- shared runtime monitors must not be imported from another feature's internals

#### Target shape for `import`

```text
apps/cli/src/features/import/
  command/
    import.ts
    import-handler.ts
    import-utils.ts
    *.test.ts
  view/
    ingestion-monitor-view-components.tsx
    ingestion-monitor-view-controller.ts
    ingestion-monitor-view-state.ts
    *.test.ts
```

#### Target shape for `reprocess`

```text
apps/cli/src/features/reprocess/
  command/
    reprocess.ts
    reprocess-handler.ts
    *.test.ts
```

## Rollout Order

Migrate the shared dependencies first, then move the simplest feature slices,
then tackle the multi-command families.

### Phase 0: Reference complete

1. `cost-basis`

Use it as the structure reference, not as a template to cargo-cult.

### Phase 1: Shared extractions that unblock the rest

1. Extract the import ingestion monitor dependency out of
   `features/shared/ingestion-infrastructure.ts`
2. Extract the links and prices monitor dependencies out of
   `features/shared/projection-runtime.ts`
3. Extract provider summary logic so `providers` no longer imports
   `blockchains` internals

These should land before or alongside the first feature migration that touches
those files.

### Phase 2: Simple namespaced view commands

1. `accounts`
2. `blockchains`

For each feature:

- move `<feature>.ts` and `<feature>-view.ts` into `command/`
- move `*-view-handler.ts` and other command-owned helpers into `command/`
- move view state/controller/components into `view/`
- delete `components/index.ts` after direct imports are in place

### Phase 3: Single-command interactive features

1. `portfolio`
2. `clear`
3. `balance`

For each feature:

- move command entrypoint, handler, prompts, and command utilities into
  `command/`
- move view state/controller/components/helpers into `view/`
- keep only neutral shared root files if both slices still import them

### Phase 4: Multi-command command families

1. `transactions`
2. `prices`
3. `links`
4. `providers`

For each feature:

- move the namespace file and all subcommand files into `command/`
- move all monitor/view components into `view/`
- rename or split any misleading root `*-view-*` utility that is still shared
  by non-view code
- delete `components/index.ts` after direct imports are in place

### Phase 5: Runtime-heavy features

1. `import`
2. `reprocess`

For each feature:

- move command wiring into `command/`
- move feature-local monitors into `view/` when they remain feature-owned
- keep shared runtime infrastructure in `features/shared/` or `ui/shared/`,
  never under another feature's internal folders

## Migration Checklist

For each CLI feature:

1. Create `command/` and `view/` if needed.
2. Move the root command registration file into `command/`.
3. Move handlers, prompts, and option builders into `command/`.
4. Move TUI state/controller/components/helpers into `view/`.
5. Rename any root file whose name implies `view` or `command` ownership if it
   is actually shared by both slices.
6. Update `apps/cli/src/index.ts` to the new `command/<feature>.js` import.
7. Replace `components/index.ts` imports with direct file imports.
8. Extract any cross-feature helper into `features/shared/` or `ui/shared/`.
9. Move tests so they live with the migrated slice.
10. Delete dead barrels and empty directories.
11. Run targeted tests for that feature.

## Explicit Non-Goals

- Do not move capability workflow logic into the CLI.
- Do not create a generic `lib/` or `utils/` dumping ground.
- Do not keep feature-local view code under `components/` while command code
  moves to `command/`; that just creates a new asymmetry.
- Do not let `features/shared/` become a second dumping ground for anything
  merely "used in two places." Shared ownership still needs a clear host-level
  reason.
