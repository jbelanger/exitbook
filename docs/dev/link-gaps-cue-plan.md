# Link Gaps Cue Plan

Status: active dev plan
Owner: Codex + Joel
Scope: narrow cueing for unresolved gap rows, starting with Solana-style correlated service swaps

## Goal

Add an honest hint to `links gaps` when the review surface can recognize a likely pattern without inventing a link, changing transaction semantics, or hiding data.

First target:

- `likely_correlated_service_swap`

This should help cases like:

- `cc617ae2ae` `2026-03-13 00:02` `solana` `OUT` `RENDER` `100`
- `f4a5cd8b50` `2026-03-13 00:02` `solana` `IN` `SOL` `0.00001`
- `3d1c475752` `2026-03-13 00:03` `solana` `IN` `USDT` `165.1695`

These rows should remain visible in `links gaps`, but the user should see that they likely belong to one correlated service-mediated swap flow rather than three unrelated transfer problems.

## Why This Exists

The current gap system is now structurally correct:

- issue identity is `txFingerprint + assetId + direction`
- issue-level resolve/reopen uses `GAP-REF`
- spam/exclusion policy is already handled in gap visibility

But it is still semantically thin. The March 13, 2026 Solana trio remains three plain `manual review` rows with no hint that they likely form one user intent.

The missing piece is not more suppression. It is a cue layer.

## Non-Negotiable Rules

1. A cue is a label, not a policy decision.
2. Cues must not create or imply `transaction_links`.
3. Cues must not suppress rows from `links gaps`.
4. Cues must not touch ingestion, processors, or persisted transaction semantics.
5. Cues must be derived locally inside gap analysis from data already loaded for the gaps workflow.
6. The first cue should be narrow and explicitly uncertain. Prefer `likely_...` naming over semantic overreach.

## Explicit Non-Goals

- no new processor logic
- no correlated-intent infrastructure
- no new override shape
- no user-taught grouping
- no gap grouping UI
- no spam cue work in this phase
- no residual native overhead cue work in this phase
- no change to existing suppression policy

Those may still be valid later. They are not part of this plan.

## Current Constraints

- Spam and suspicious-airdrop rows are already suppressed by policy in [gap-analysis.ts](/Users/joel/Dev/exitbook/packages/accounting/src/linking/gaps/gap-analysis.ts).
- Residual native-overhead rows are already suppressed by `isResidualFeeAssetGapOnOtherwiseCoveredSend(...)` in [gap-analysis.ts](/Users/joel/Dev/exitbook/packages/accounting/src/linking/gaps/gap-analysis.ts).
- So a general "free cues" phase would either duplicate existing UI meaning or force policy reversals.
- The March 13 Solana trio is not covered by:
  - `isNearbySwapTransaction(...)`
  - `isLikelyCrossChainServiceFlowPair(...)`

That means the first useful cue requires a new detector.

## Target Model

Keep it minimal.

In [gap-model.ts](/Users/joel/Dev/exitbook/packages/accounting/src/linking/gaps/gap-model.ts):

```ts
export type GapCueKind = 'likely_correlated_service_swap';

export interface LinkGapIssue {
  ...
  gapCue?: GapCueKind | undefined;
}
```

Important:

- Use a string union, not a cue object, for the first version.
- If we later need cue-specific metadata, we can promote the shape then.

## Detection Scope

The detector should run on currently emitted uncovered gap issues, not on all processed transactions.

Why:

- keeps the feature local to the `links gaps` lens
- avoids tagging transactions that are already fully explained
- prevents the cue system from becoming a second classification pipeline

## First Heuristic

Add one pure helper in [gap-analysis.ts](/Users/joel/Dev/exitbook/packages/accounting/src/linking/gaps/gap-analysis.ts), something like:

- `applyGapCues(issues, transactions): LinkGapIssue[]`

Inside it, add a narrow detector for `likely_correlated_service_swap`.

Suggested shape:

1. Start from emitted `LinkGapIssue[]`.
2. Resolve each issue back to its `Transaction` by `transactionId`.
3. Build correlation candidates only for issues where:
   - the transaction is blockchain-backed
   - the transaction has either only inflows or only outflows after existing gap filtering
   - the tx has a tracked self address via `from` or `to`
4. Group candidate issues by:
   - `accountId`
   - `blockchain.name`
   - normalized self address
5. Inside each group, cluster issues inside a tight time window.
6. Mark every issue in a cluster with `gapCue='likely_correlated_service_swap'` when the cluster has:
   - at least one inflow gap
   - at least one outflow gap
   - at least two distinct `assetId`s
   - not all issues on the same `assetId`

Starting time window:

- `5 minutes`

Use a new local constant, not the existing one-hour `LIKELY_SERVICE_FLOW_WINDOW_MS`.

Suggested constant:

```ts
const CORRELATED_SERVICE_SWAP_WINDOW_MS = 5 * 60 * 1000;
```

## Interaction With Existing Logic

Do not change these behaviors in this phase:

- `shouldSuppressGapByPolicy(...)`
- `isResidualFeeAssetGapOnOtherwiseCoveredSend(...)`
- `classifySuppressedGapTransactionIds(...)`

The new cue should be additive only.

Important comment to leave in code:

- the cue detector is orthogonal to the existing same-account explicit-swap suppression and cross-account service-flow suppression
- this detector exists because same-account, same-chain, multi-transaction service swaps can still surface as unresolved gaps

## Render Plan

Both render paths already consume `LinkGapIssue` directly enough to carry the field without adding another model layer.

Render targets:

- [links-static-renderer.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/links/view/links-static-renderer.ts)
- [links-view-components.tsx](/Users/joel/Dev/exitbook/apps/cli/src/features/links/view/links-view-components.tsx)

Minimal UX:

- static detail shows one line:
  - `Cue: likely correlated service swap`
- TUI gap detail panel shows the same cue
- static list appends the cue to the readiness text
- TUI list row appends the cue inline after coverage when present

List treatment rule:

- do not add a new column in this phase
- keep the cue as an inline suffix so the table shape stays stable

## Detailed Implementation Plan

### Step 1: Extend Gap Issue Shape

Files:

- [packages/accounting/src/linking/gaps/gap-model.ts](/Users/joel/Dev/exitbook/packages/accounting/src/linking/gaps/gap-model.ts)
- [packages/accounting/src/linking.ts](/Users/joel/Dev/exitbook/packages/accounting/src/linking.ts)

Changes:

1. Add `GapCueKind = 'likely_correlated_service_swap'`.
2. Add `gapCue?: GapCueKind | undefined` to `LinkGapIssue`.
3. Re-export `GapCueKind` from `@exitbook/accounting/linking`.

### Step 2: Add Cue Derivation

File:

- [packages/accounting/src/linking/gaps/gap-analysis.ts](/Users/joel/Dev/exitbook/packages/accounting/src/linking/gaps/gap-analysis.ts)

Changes:

1. Add `CORRELATED_SERVICE_SWAP_WINDOW_MS = 5 * 60 * 1000`.
2. Add a helper to map emitted issues back to their source transactions.
3. Add a helper to normalize same-account blockchain issue candidates.
4. Add `applyGapCues(issues, transactions): LinkGapIssue[]`.
5. Run `applyGapCues(...)` once, after inflow/outflow issues are collected and before the summary is built.

Pseudo-code:

```ts
const rawIssues = [
  ...collectInflowGapIssues(...),
  ...collectOutflowGapIssues(...),
];

const issues = applyGapCues(rawIssues, transactions);

return {
  issues,
  summary: buildLinkGapSummary(issues),
};
```

Inside `applyGapCues(...)`:

```ts
for each issue:
  tx = transactionById.get(issue.transactionId)
  if tx missing or !tx.blockchain:
    continue
  candidate = buildCueCandidate(issue, tx)

group candidates by accountId + blockchain + selfAddress

for each group:
  cluster by <= CORRELATED_SERVICE_SWAP_WINDOW_MS
  if cluster has inflow + outflow + >= 2 assetIds:
    mark all issues in cluster with gapCue='likely_correlated_service_swap'
```

### Step 3: Render The Cue

Files:

- [apps/cli/src/features/links/view/links-static-renderer.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/links/view/links-static-renderer.ts)
- [apps/cli/src/features/links/view/links-view-components.tsx](/Users/joel/Dev/exitbook/apps/cli/src/features/links/view/links-view-components.tsx)

Changes:

1. Add a small formatter for `GapCueKind -> human label`.
2. Show the cue in gap detail output.
3. Show the cue inline in list/explorer rows without adding a new column.

Do not:

- change sorting
- change readiness colors
- change suppression behavior

### Step 4: Add Focused Tests

Files:

- [packages/accounting/src/linking/gaps/**tests**/gap-analysis.test.ts](/Users/joel/Dev/exitbook/packages/accounting/src/linking/gaps/__tests__/gap-analysis.test.ts)
- existing CLI renderer tests only if output text changes there

Required positive test:

- synthetic mirror of the March 13, 2026 Solana trio
- expect all three emitted issues to carry `gapCue='likely_correlated_service_swap'`

Required negative tests:

1. isolated one-sided inflow
   - no cue
2. existing cross-account service-flow case
   - no `likely_correlated_service_swap` cue
3. nearby explicit swap-transaction anchor case
   - no cue
4. same-window issues with only one `assetId`
   - no cue

### Step 5: Document The New Work

Files:

- this plan
- later, the CLI spec only if the cue becomes part of committed user-facing behavior worth documenting canonically

Do not update the canonical spec before the cue exists in code.

## Review Criteria

This phase is successful if:

1. the March 13 Solana trio stays visible in `links gaps`
2. those rows carry `likely_correlated_service_swap`
3. no rows are hidden because of the cue
4. no processor code changes
5. no override schema changes
6. false positives are constrained by the negative tests

## Open Questions

1. Should the cue appear only in detail, or also in list rows?
2. Is `5 minutes` tight enough in real data, or should it be reduced once we see more examples?
3. After this lands, do we still need user-taught grouping, or does the cue solve enough of the review problem?

## Naming

Preferred terms:

- `gapCue`
- `GapCueKind`
- `likely_correlated_service_swap`

Avoid:

- `gapDiagnostic`
- `swap`
- `service_swap`
- any name that implies confirmed semantics rather than a hint
