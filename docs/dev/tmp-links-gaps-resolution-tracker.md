# Links Gaps Resolution Tracker

Status: in progress
Owner: Codex
Last updated: 2026-04-09

## Goal

Implement transaction-level link-gap resolution with a first-class `links gaps` command family.

Target UX:

- `exitbook links gaps`
- `exitbook links gaps view <ref>`
- `exitbook links gaps explore [ref]`
- `exitbook links gaps resolve <ref> [--reason <text>]`
- `exitbook links gaps reopen <ref> [--reason <text>]`

Compatibility:

- Keep existing `links --gaps`, `links list --gaps`, `links view <ref> --gaps`, and `links explore [ref] --gaps` working as aliases during this phase.

## Key Decisions

- Resolution is transaction-level, not gap-row-level.
- Durable identity is persisted `txFingerprint`, not transaction id.
- Gap resolution uses a dedicated override scope instead of repurposing `excluded_from_accounting` or free-form notes.
- The gaps list hides resolved transactions by default.
- `resolve` targets currently open gap refs.
- `reopen` targets currently resolved gap refs from the override stream.

## Phase Plan

### Phase 0: Baseline Cleanup

Purpose:

- Land the current in-flight gap improvements before layering new resolution behavior on top.

Files already in flight:

- `packages/ingestion/src/sources/blockchains/solana/processor-utils.ts`
- `packages/ingestion/src/sources/blockchains/solana/__tests__/processor-utils.test.ts`
- `packages/accounting/src/linking/strategies/counterparty-roundtrip-strategy.ts`
- `packages/accounting/src/linking/strategies/__tests__/counterparty-roundtrip-strategy.test.ts`
- `packages/accounting/src/linking/strategies/index.ts`
- `packages/accounting/src/linking/strategies/__tests__/default-strategies.test.ts`
- `packages/core/src/transaction/transaction-link.ts`
- `apps/cli/src/features/links/command/links-browse-support.ts`
- `apps/cli/src/features/links/command/__tests__/links-browse-support.test.ts`

Validation:

- Focused Vitest runs for the touched ingestion/accounting/links command tests.

### Phase 1: Override Model And Gap Analysis

Purpose:

- Add durable transaction-level gap resolution state and make gap analysis honor it.

Planned files:

- `packages/core/src/override/override.ts`
- `packages/data/src/overrides/index.ts`
- `packages/data/src/overrides/link-gap-resolution-replay.ts`
- `packages/data/src/overrides/__tests__/link-gap-resolution-replay.test.ts`
- `packages/data/src/overrides/__tests__/override-store.test.ts`
- `apps/cli/src/features/links/links-gap-model.ts`
- `apps/cli/src/features/links/command/view/links-gap-analysis.ts`
- `apps/cli/src/features/links/command/view/__tests__/links-gap-analysis.test.ts`
- `apps/cli/src/features/links/command/links-browse-command.ts`
- `apps/cli/src/features/links/command/links-browse-support.ts`
- `apps/cli/src/features/links/view/links-static-renderer.ts`

Implementation notes:

- Add `link-gap-resolve` and `link-gap-reopen` scopes with payloads keyed by `tx_fingerprint`.
- Replay uses latest-event-wins semantics and produces a set of resolved transaction fingerprints.
- Gap analysis should compute visible issues and summary metadata for hidden resolved transactions without changing proposal behavior.

Validation:

- Override replay unit tests.
- Gap analysis unit tests.
- Static links browse tests for hidden resolved count and selection behavior.

### Phase 2: `links gaps` Command Surface

Purpose:

- Add first-class commands for browsing, viewing, exploring, resolving, and reopening gaps.

Planned files:

- `apps/cli/src/features/links/command/links.ts`
- `apps/cli/src/features/links/command/links-list.ts`
- `apps/cli/src/features/links/command/links-view.ts`
- `apps/cli/src/features/links/command/links-explore.ts`
- `apps/cli/src/features/links/command/gaps/links-gaps.ts`
- `apps/cli/src/features/links/command/gaps/links-gaps-browse-command.ts`
- `apps/cli/src/features/links/command/gaps/links-gap-resolution-handler.ts`
- `apps/cli/src/features/links/command/gaps/links-gap-resolution-command.ts`
- `apps/cli/src/features/links/command/gaps/links-gaps-command-scope.ts`
- `apps/cli/src/features/links/command/__tests__/links-command.test.ts`
- `apps/cli/src/features/links/command/__tests__/links-view-command.test.ts`
- `apps/cli/src/features/links/command/__tests__/links-explore-command.test.ts`
- new tests under `apps/cli/src/features/links/command/gaps/__tests__/`

Implementation notes:

- `links gaps` should be the primary UX.
- Existing `--gaps` paths should delegate to the same underlying gap browse plumbing for compatibility.
- Resolve/reopen commands should accept the same short refs users see in `links gaps`.

Validation:

- Command routing tests.
- Handler tests for idempotent resolve/reopen behavior.
- End-to-end local CLI smoke runs for `links gaps` and compatibility aliases.

### Phase 3: Spec And Polish

Purpose:

- Update canonical specs to match implementation and tighten copy/naming.

Planned files:

- `docs/specs/cli/links/README.md`
- `docs/specs/cli/links/links-view-spec.md`
- `docs/specs/override-event-store-and-replay.md`
- `docs/specs/cli/cli-design-language-spec.md`

Validation:

- Re-read help text, JSON metadata, and spec language for consistency.

## Open Questions

- Whether `links gaps` should later gain a dedicated resolved-history surface.
- Whether resolved gap reasons should become structured enums instead of free-form audit text.

## Smells To Revisit

- The current gap selector is a short transaction fingerprint prefix but the code still talks about “gap” items as if they were row-unique identities.
- The old `--gaps` lens leaks through several command names and specs; compatibility is fine, but the terminology is already split.
- `LinkGapAnalysis.summary` is beginning to carry browse-oriented metadata as well as analytical totals, which may want a clearer separation later.
