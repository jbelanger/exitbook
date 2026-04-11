# Link Gaps Identity and Policy Plan

Status: proposed temporary dev plan
Owner: Codex + Joel
Scope: link-gap identity correctness, policy parity with existing diagnostics, finer-grained gap review overrides

## Goal

Make `links gaps` a clean review surface without overloading transfer links, transaction operations, or fee semantics.

The surface should answer:

- which asset-direction pairs are genuinely uncovered by confirmed links
- which rows are hidden by existing policy signals already present on the transaction
- which rows were explicitly dismissed by the user
- which cases justify a later first-class diagnostic or movement-model change

## Non-Negotiable Rules

These rules keep the refactor simple and consistent with the existing codebase.

1. `transaction_links` remains the source of truth for transfer coverage. Do not duplicate link state behind a generic "resolution" abstraction.
2. Gap identity must be asset-aware. `txFingerprint + assetId + direction` is the minimum correct key.
3. `assetSymbol` is display data, not identity.
4. Policy results are derived at query time from existing transaction diagnostics and flags. Do not persist "hidden by policy" state.
5. User review decisions remain separate from diagnostics and links. They are override state, not transaction semantics.
6. Ambiguous dust stays reviewable until the user dismisses it. Do not auto-hide by threshold.
7. Do not change ingestion or linking only to quiet review noise unless the missing semantics are deterministic and repeatable.

## Why This Plan

The current gaps surface is doing too much with too little identity:

- [LinkGapIssue](/Users/joel/Dev/exitbook/packages/accounting/src/linking/gaps/gap-model.ts) did not carry `assetId`, even though the gap analyzer computed coverage by `assetId`.
- This makes same-symbol collisions possible. Two different asset IDs sharing one symbol can silently collapse into one visible issue.
- Gap suppression logic is currently ad hoc and local to the analyzer.
- Gap dismissal is transaction-level in [links-gap-resolution-handler.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/links/command/gaps/links-gap-resolution-handler.ts), which is too coarse for mixed transactions.

This plan fixes the correctness hole first, then adds the smallest useful policy layer, then narrows user dismissals to the issue identity.

## Evidence Buckets

This corpus should drive the work. Do not generalize beyond what the data supports.

| Bucket                          | Evidence                                                                                                                                | Takeaway                                                                                                                                                                                                                   |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Protocol overhead               | `ec36390543`, `3a2664f861`, `920c244f01` on December 27, 2024                                                                           | Solana associated token account creation. Raw Helius data shows `ATokenGP...` create flow and `0.00203928 SOL` funding, plus separate network fee. This is deterministic protocol overhead, not principal transfer intent. |
| Suspicious airdrop / spam noise | `5e56aecaf2` on November 2, 2025; `5449664035` on November 27, 2025; `5b5ff59cf9` on December 4, 2025; `cb533f67fd` on January 30, 2026 | These rows are review noise. One Ethereum tx already carries `SUSPICIOUS_AIRDROP`; Injective and Akash raws contain obvious airdrop-bait memos.                                                                            |
| Ambiguous dust                  | `e9cf3d8fb7` on April 16, 2024; `f796b68d7a` on December 10, 2024; `66cdd4c7a7` on December 27, 2024                                    | Tiny real transfers, but not provably ignorable from chain data alone. These should stay visible until dismissed by the user.                                                                                              |

Important boundary:

- Bucket 1 justifies a future semantic/diagnostic improvement.
- Bucket 2 justifies policy parity with existing diagnostics.
- Bucket 3 does **not** justify a schema or policy shortcut.

## Current Hotspots

- [packages/accounting/src/linking/gaps/gap-model.ts](/Users/joel/Dev/exitbook/packages/accounting/src/linking/gaps/gap-model.ts)
  `LinkGapIssue` identity and summary shape now live with the linking capability.
- [packages/accounting/src/linking/gaps/gap-analysis.ts](/Users/joel/Dev/exitbook/packages/accounting/src/linking/gaps/gap-analysis.ts)
  coverage computation, gap emission, and suppression policies all live together.
- [apps/cli/src/features/links/command/gaps/load-links-gap-analysis.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/links/command/gaps/load-links-gap-analysis.ts)
  CLI still owns data loading and composition for the gaps view.
- [apps/cli/src/features/links/command/gaps/links-gap-resolution-handler.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/links/command/gaps/links-gap-resolution-handler.ts)
  gap dismissal is keyed to `txFingerprint` only.
- [packages/core/src/override/override.ts](/Users/joel/Dev/exitbook/packages/core/src/override/override.ts)
  link-gap override payloads are transaction-level only.
- [packages/ingestion/src/features/balance/balance-workflow.ts](/Users/joel/Dev/exitbook/packages/ingestion/src/features/balance/balance-workflow.ts)
  balance already treats `isSpam` / `SCAM_TOKEN` specially, so gaps and balance disagree today.
- [packages/core/src/transaction/transaction.ts](/Users/joel/Dev/exitbook/packages/core/src/transaction/transaction.ts)
  transaction-level diagnostics already exist via `notes`, `isSpam`, and `excludedFromAccounting`.

## Target Model

Keep the model minimal:

- Coverage: confirmed `transaction_links`
- Gap issue identity: `txFingerprint + assetId + direction`
- Gap policy: pure code over existing transaction diagnostics and flags
- Gap disposition: persisted user override keyed to the gap issue identity
- Future deterministic semantics: typed diagnostics only when we have enough evidence

Final end state:

- no transaction-level gap identity in active code paths
- no transaction-level gap resolve/reopen writes
- no permanent legacy branch in the analyzer or resolution handler
- old transaction-level overrides may remain readable only as migration input until they are converted or dropped
- once issue-level dismissal is live and existing saved state is handled, remove the legacy compatibility path completely

Explicit non-goals:

- no generic `MovementResolution`
- no side table for generic resolutions
- no new fee scopes for protocol rent yet
- no auto-hide dust threshold
- no processor changes for ambiguous dust

## Structure Note

`links gaps` should stay inside the existing `links` capability.

Reason:

- it is a review surface over transfer-link coverage
- it depends directly on `transaction_links`, link suggestions, and link review overrides
- it does not currently justify its own independent capability boundary

What should change is the internal slice shape, not the top-level feature boundary.

Preferred direction:

- keep `links` as the feature
- keep the pure gap domain under `packages/accounting/src/linking/gaps/`
- keep the CLI slice focused on loading, command handling, browse behavior, and rendering
- avoid scattering gap-specific logic across generic `links/command/*` files once the refactor starts

Only revisit a separate feature boundary if `links gaps` grows its own durable domain model and workflows that no longer center on transfer-link review.

## Phase Plan

### Phase 1: Fix Gap Identity

Goal:

- make the gap surface correct before making it smarter

Deliverable:

- `LinkGapIssue` includes `assetId`
- issue identity becomes `txFingerprint + assetId + direction`

Target files:

- [packages/accounting/src/linking/gaps/gap-model.ts](/Users/joel/Dev/exitbook/packages/accounting/src/linking/gaps/gap-model.ts)
- [packages/accounting/src/linking/gaps/gap-analysis.ts](/Users/joel/Dev/exitbook/packages/accounting/src/linking/gaps/gap-analysis.ts)
- [apps/cli/src/features/links/command/gaps/links-gaps-browse-support.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/links/command/gaps/links-gaps-browse-support.ts)
- [apps/cli/src/features/links/view/links-static-renderer.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/links/view/links-static-renderer.ts)
- tests under `packages/accounting/src/linking/gaps/__tests__/` and related CLI browse/renderer tests

Implementation notes:

1. Add `assetId` to `LinkGapIssue`.
2. Populate `assetId` in `createLinkGapIssue(...)`.
3. Keep summary aggregation by symbol for now, but keep issue identity asset-aware.
4. Do **not** add `movementFingerprint` yet. Current gap analysis is asset-direction scoped, not movement-scoped.

Required test:

- one transaction with two uncovered assets sharing the same symbol but different `assetId`s should emit two distinct gap issues

Commit boundary:

- gap issue identity is correct
- no policy changes yet

### Phase 2: Add Policy Parity With Existing Diagnostics

Goal:

- stop surfacing rows that the system already knows are spam-like or intentionally excluded

Deliverable:

- one small policy pass inside gap analysis

Target files:

- [packages/accounting/src/linking/gaps/gap-analysis.ts](/Users/joel/Dev/exitbook/packages/accounting/src/linking/gaps/gap-analysis.ts)
- optionally a small helper module beside it if extraction keeps the file cleaner

Preferred shape:

- a pure helper like `shouldSuppressGapByPolicy(tx, assetId, direction): boolean`
- called after uncovered amount is computed but before issue emission

Initial policy inputs:

1. `tx.excludedFromAccounting === true`
2. `tx.isSpam === true`
3. `tx.notes` contains `SCAM_TOKEN`
4. `tx.notes` contains `SUSPICIOUS_AIRDROP`

Important note:

- `SUSPICIOUS_AIRDROP` is a product decision, not strict parity with balance. This plan opts in explicitly because the transaction is already carrying a warning that it is likely airdrop bait, and leaving those rows in `links gaps` creates review noise rather than useful transfer work.

Commit boundary:

- existing diagnostics affect gap visibility
- no override changes yet

### Phase 2b: Keep The Pure Gaps Domain In Accounting

Goal:

- keep feature logic out of the host layer before Phase 3 adds more behavior

Deliverable:

- pure gap model and analysis stay under `accounting/linking`
- CLI keeps only composition, browse, resolution command flow, and rendering

Target files:

- [packages/accounting/src/linking/gaps/gap-model.ts](/Users/joel/Dev/exitbook/packages/accounting/src/linking/gaps/gap-model.ts)
- [packages/accounting/src/linking/gaps/gap-analysis.ts](/Users/joel/Dev/exitbook/packages/accounting/src/linking/gaps/gap-analysis.ts)
- [packages/accounting/src/linking.ts](/Users/joel/Dev/exitbook/packages/accounting/src/linking.ts)
- [apps/cli/src/features/links/command/gaps/load-links-gap-analysis.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/links/command/gaps/load-links-gap-analysis.ts)
- gap-related CLI model/view files that consume the accounting types

Implementation notes:

1. Export gap types and analysis from `@exitbook/accounting/linking`.
2. Do not move terminal browse sorting or rendering into `accounting`.
3. Do not move `DataSession` loading into `accounting` yet unless we also introduce a linking-owned port.
4. Delete CLI-owned copies of the pure gap model/analysis once imports are switched.

Commit boundary:

- gap semantics live with the linking capability
- CLI remains a thin host adapter for the `links gaps` surface

### Phase 3: Move Gap Dismissal From Transaction-Level To Issue-Level

Goal:

- let the user dismiss only the specific uncovered asset-direction pair

Deliverable:

- gap resolve/reopen keyed to `txFingerprint + assetId + direction`

Target files:

- [packages/core/src/override/override.ts](/Users/joel/Dev/exitbook/packages/core/src/override/override.ts)
- override readers/writers in `@exitbook/data/overrides`
- [apps/cli/src/features/links/command/gaps/links-gap-resolution-handler.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/links/command/gaps/links-gap-resolution-handler.ts)
- [apps/cli/src/features/links/command/gaps/links-gaps-browse-support.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/links/command/gaps/links-gaps-browse-support.ts)
- related gap command and renderer tests

Implementation approach:

1. Extend `link_gap_resolve` / `link_gap_reopen` payloads with `asset_id` and `direction`.
2. Keep legacy transaction-level payloads readable for back-compat.
3. New writes should use issue-level payloads.
4. `applyResolvedLinkGapVisibility(...)` should check issue identity, not just `txFingerprint`.

Back-compat rule:

- transaction-level compatibility is temporary only
- new writes must be issue-level from day one of this phase
- historical tx-level dismissals should be converted or explicitly retired in a follow-up cleanup step
- do not leave a permanent dual-path implementation in active code

Why this order:

- the identity fix from Phase 1 must exist first
- otherwise dismissal is still too coarse to be correct

Commit boundary:

- mixed transactions can be dismissed one issue at a time

### Phase 3b: Remove Legacy Transaction-Level Dismissal Support

Goal:

- finish the refactor cleanly instead of carrying a permanent compatibility branch

Deliverable:

- one active dismissal identity only: `txFingerprint + assetId + direction`

Implementation note:

Choose one of these approaches before closing the work:

1. migrate existing tx-level gap overrides to issue-level entries, then delete tx-level read support
2. explicitly drop old tx-level gap overrides and document that pre-refactor dismissals must be re-applied manually

What not to do:

- do not keep both issue-level and transaction-level dismissal logic indefinitely

Commit boundary:

- legacy transaction-level dismissal reads removed
- docs and tests only describe issue-level behavior

### Phase 4: Revisit Deterministic Protocol-Overhead Diagnostics

Goal:

- give deterministic cases a first-class home only if more than one chain pattern needs it

Current evidence that qualifies:

- Solana associated token account rent/funding rows

Candidate future concept:

- typed diagnostic, likely movement-scoped, for deterministic protocol overhead

Important restraint:

- do not implement this in Phase 4 unless we have at least a second or third qualifying case
- do not use ambiguous dust to justify it

Open design question for Phase 4:

- whether the right home is a movement-level diagnostic field, a reserved movement note, or a typed transaction note that points to affected assets

What Phase 4 must **not** become:

- a generic resolution enum
- a replacement for links
- a substitute for user dismissals

## Recommended Order Of Execution

1. Phase 1: gap identity correctness
2. Phase 2: policy parity with existing diagnostics
3. Phase 3: issue-level dismissal
4. Phase 3b: remove legacy transaction-level dismissal support
5. Pause and reassess whether Phase 4 still matters after the review noise drops

This order keeps each step independently shippable and avoids speculative schema work.

## Open Questions

1. Should `SUSPICIOUS_AIRDROP` hide a row by default in gaps, or should only `isSpam` / `SCAM_TOKEN` do that?
2. Do we want a tiny dedicated `gap-policy.ts` helper now, or only once the first policy lands and proves the shape useful?
3. If Phase 4 happens, do we want diagnostics at transaction-level first or directly at movement-level?

## Naming

Preferred current terms:

- `GapPolicy` for runtime visibility rules
- `GapDisposition` for persisted user review state
- `MovementDiagnostic` for a future typed semantic signal

Avoid:

- `MovementResolution`
- vague names like `tag`, `kind`, or `ignoreReason` for persisted review state
