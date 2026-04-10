# Links Gaps Resolution Tracker

Status: completed
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

## Key Decisions

- Resolution is transaction-level, not gap-row-level.
- Durable identity is persisted `txFingerprint`, not transaction id.
- Gap resolution uses a dedicated override scope instead of repurposing `excluded_from_accounting` or free-form notes.
- The gaps list hides resolved transactions by default.
- `resolve` targets currently open gap refs.
- `reopen` targets currently resolved gap refs from the override stream.
- Compatibility aliases were removed in the follow-up cleanup pass; `links gaps` is now the only supported gap browse surface.

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
- Resolve/reopen commands should accept the same short refs users see in `links gaps`.

Validation:

- Command routing tests.
- Handler tests for idempotent resolve/reopen behavior.
- End-to-end local CLI smoke runs for `links gaps` and compatibility aliases.

Status:

- Completed on 2026-04-09.
- Focused suite passed:
  - `packages/data/src/overrides/__tests__/link-gap-resolution-replay.test.ts`
  - `packages/data/src/overrides/__tests__/override-store.test.ts`
  - `apps/cli/src/features/links/command/view/__tests__/links-gap-analysis.test.ts`
  - `apps/cli/src/features/links/command/__tests__/links-browse-support.test.ts`
  - `apps/cli/src/features/links/command/gaps/__tests__/links-gap-resolution-handler.test.ts`
  - `apps/cli/src/features/links/command/gaps/__tests__/links-gap-resolution-command.test.ts`
  - `apps/cli/src/features/links/command/gaps/__tests__/links-gaps-command.test.ts`
  - `apps/cli/src/features/links/command/__tests__/links-command.test.ts`
  - `apps/cli/src/features/links/command/__tests__/links-view-command.test.ts`
  - `apps/cli/src/features/links/command/__tests__/links-explore-command.test.ts`
- Real CLI smoke checks passed:
  - `pnpm -s run dev links gaps --json`
  - `pnpm -s run dev links --gaps --json`

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

Status:

- Completed on 2026-04-09.
- Spec updates landed in:
  - `docs/specs/cli/links/README.md`
  - `docs/specs/cli/links/links-view-spec.md`
  - `docs/specs/cli/cli-design-language-spec.md`
  - `docs/specs/cli/prices/README.md`
- Additional polish landed:
  - gap selectors now dedupe by transaction fingerprint for detail/explore
  - gap detail and JSON now expose `transactionGapCount` for multi-row transactions
- Validation:
  - focused suite passed: 10 files / 57 tests
  - real duplicate-ref smoke check passed:
    - `pnpm -s run dev links gaps view 59015268c9 --json`

### Phase 4: Legacy Removal And Browse Split

Purpose:

- Remove the old `--gaps` compatibility path, split gap browsing from proposal browsing internally, and clean up the gap browse model.

Files touched:

- `apps/cli/src/features/links/command/links.ts`
- `apps/cli/src/features/links/command/links-list.ts`
- `apps/cli/src/features/links/command/links-view.ts`
- `apps/cli/src/features/links/command/links-explore.ts`
- `apps/cli/src/features/links/command/links-browse-command.ts`
- `apps/cli/src/features/links/command/links-browse-output.ts`
- `apps/cli/src/features/links/command/links-browse-support.ts`
- `apps/cli/src/features/links/command/links-gap-analysis-support.ts`
- `apps/cli/src/features/links/command/links-gaps-browse-output.ts`
- `apps/cli/src/features/links/command/links-gaps-browse-support.ts`
- `apps/cli/src/features/links/command/gaps/links-gaps-browse-command.ts`
- `apps/cli/src/features/links/command/gaps/links-gaps.ts`
- `apps/cli/src/features/links/command/gaps/links-gap-resolution-handler.ts`
- `apps/cli/src/features/links/links-browse-model.ts`
- `apps/cli/src/features/links/links-gap-model.ts`
- `apps/cli/src/features/links/links-gaps-browse-model.ts`
- `apps/cli/src/features/links/view/links-static-renderer.ts`
- `apps/cli/src/features/links/view/links-view-components.tsx`
- `apps/cli/src/features/links/view/links-view-state.ts`
- `apps/cli/src/features/links/__tests__/test-utils.ts`
- `apps/cli/src/features/links/command/__tests__/links-browse-support.test.ts`
- `apps/cli/src/features/links/command/__tests__/links-gaps-browse-support.test.ts`
- `apps/cli/src/features/links/command/__tests__/links-view-command.test.ts`
- `apps/cli/src/features/links/command/__tests__/links-explore-command.test.ts`
- `apps/cli/src/features/links/command/gaps/__tests__/links-gaps-command.test.ts`
- `apps/cli/src/features/links/command/view/__tests__/links-gap-analysis.test.ts`
- `apps/cli/src/features/links/view/__tests__/links-view-components.test.tsx`
- `docs/specs/cli/links/README.md`
- `docs/specs/cli/links/links-view-spec.md`

Implementation notes:

- Proposal browsing and gap browsing now have separate browse support/output models instead of a shared `gaps: true` mode switch.
- Gap issues now use explicit `platformKey` and `blockchainName` fields instead of the overloaded `source` naming.
- Hidden resolved counts moved out of `LinkGapAnalysis.summary` and into the gap browse/view state.
- Legacy `links --gaps` command paths are removed; they now fail as unknown options.

Validation:

- Focused links command suite passed:
  - `pnpm vitest run apps/cli/src/features/links/command apps/cli/src/features/links/view/__tests__/links-view-components.test.tsx`
- Real CLI smoke checks passed:
  - `pnpm run dev links --json`
  - `pnpm run dev links gaps --json`
  - `pnpm run dev links gaps view 59015268c9 --json`
  - `pnpm run dev links --gaps --json` now fails with `unknown option '--gaps'`
- Workspace build status:
  - `pnpm build` still fails on the pre-existing unrelated compile error in `apps/cli/src/features/assets/command/__tests__/asset-command-services.test.ts`

## Open Questions

- Whether `links gaps` should later gain a dedicated resolved-history surface.
- Whether resolved gap reasons should become structured enums instead of free-form audit text.

## Smells To Revisit

- The current gap selector is a short transaction fingerprint prefix but the code still talks about “gap” items as if they were row-unique identities in a few type names.
- Multi-row transaction detail still shows a representative gap row plus `transactionGapCount`, not a true transaction-level aggregated detail model.
- Gap list data still exposes inconsistent `blockchainName` values from upstream data (`solana` vs `SOL` vs `ADA`), which suggests a normalization seam is still missing between ingestion and presentation.
