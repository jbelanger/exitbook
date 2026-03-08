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
    <subcommand>.ts
    <subcommand>-handler.ts
    <feature>-utils.ts
    <feature>-prompts.tsx
    *.test.ts
  view/
    <feature>-view-components.tsx
    <feature>-view-controller.ts
    <feature>-view-state.ts
    <feature>-view-utils.ts
    *.test.ts
  <feature>-local files only if they do not fit command/ or view/
```

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
- `apps/cli/src/index.ts` imports
  `./features/<feature>/command/<feature>.js`
- feature-specific handlers, prompts, and flag-parsing helpers live beside the
  command entrypoint

### 2. TUI code lives in `view/`

If a feature renders an Ink app, move these into `view/`:

- `*-view-components.tsx`
- `*-view-controller.ts`
- `*-view-state.ts`
- `*-view-utils.ts`

Do not keep a generic `components/` barrel as the primary feature boundary.
Import concrete files directly.

### 3. Tests move with the slice they verify

When a file moves:

- move its test into the same slice directory
- do not leave one large feature-root `__tests__/` folder when the code is now
  split into `command/` and `view/`

### 4. Cross-feature helpers must be extracted

If another feature imports from `apps/cli/src/features/<other-feature>/...`,
that is a migration smell.

Move those helpers to:

- `features/shared/` if the helper is host-level or command-level
- `ui/shared/` if the helper is generic TUI logic

### 5. Keep the feature root thin

After migration, the feature root should usually contain:

- `command/`
- `view/` if the feature is interactive
- no dead barrels
- no leftover empty directories

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

## Rollout Order

Migrate the features with the most mixed responsibilities first.

### Phase 1: Interactive Single-Command Features

1. `portfolio`
2. `balance`
3. `providers`
4. `blockchains`
5. `transactions`
6. `accounts`
7. `clear`

For each feature:

- move `<feature>.ts` and `<feature>-handler.ts` into `command/`
- move view state/controller/components into `view/`
- move feature-specific view helpers into `view/`
- delete `components/index.ts` if it becomes a dead barrel

### Phase 2: Multi-Command Interactive Features

1. `prices`
2. `links`

These need one extra rule:

- put subcommand entrypoints and handlers under `command/`
- keep feature-local shared helpers at the feature root only if they are reused
  across multiple subcommands and are not view code

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

### Phase 3: Non-Interactive Feature Families

1. `import`
2. `reprocess`

These may not need `view/`.

Use:

```text
apps/cli/src/features/<feature>/
  command/
    <feature>.ts
    <feature>-handler.ts
    <feature>-utils.ts
    *.test.ts
```

## Migration Checklist

For each CLI feature:

1. Create `command/` and `view/` if needed.
2. Move the root command registration file into `command/`.
3. Move handlers, prompts, and option builders into `command/`.
4. Move TUI state/controller/components/helpers into `view/`.
5. Update `apps/cli/src/index.ts` to the new `command/<feature>.js` import.
6. Update tests so they live with the migrated slice.
7. Extract any cross-feature helper into `features/shared/` or `ui/shared/`.
8. Delete dead barrels and empty directories.
9. Run targeted tests for that feature.

## Explicit Non-Goals

- Do not move capability workflow logic into the CLI.
- Do not create a generic `lib/` or `utils/` dumping ground.
- Do not keep feature-local view code under `components/` while command code
  moves to `command/`; that just creates a new asymmetry.
