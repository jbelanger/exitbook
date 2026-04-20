last_verified: 2026-04-19
status: canonical

---

# Accounting Issues Specification

Define the accounting-owned issue projection that powers the operator-facing `issues`
workflow. The issue system exists to surface remaining accounting work clearly,
preserve stable derived issue identity across rebuilds, and advertise typed next
actions without collapsing every correction path into one generic mutation
surface.

## Goals

- Provide one accounting-owned read model for operator-facing accounting issues.
- Persist current-state issue scopes and issue occurrences instead of rebuilding
  every browse surface ad hoc.
- Keep canonical issue identity derived by scope and family-owned issue keys.
- Keep next actions typed and host-agnostic so CLI and future UIs can share the
  same contract.
- Keep domain-changing corrections in narrow override families or owning
  workflows instead of inventing a generic `issues fix`.

## Non-Goals

- Making persisted issue rows the source of accounting truth.
- Turning `issues` into a domain mutation host.
- Treating free-form notes as machine state.
- Pretending bare `issues` knows unmaterialized cost-basis scopes.

## Ownership And Boundaries

- `@exitbook/accounting` owns the issue model, family mapping, and
  materialization rules.
- `@exitbook/data` owns persisted storage and per-scope reconciliation.
- `apps/cli` owns selector parsing, human rendering, JSON output, and command
  wiring.
- Domain-changing corrections remain in narrow domain override families or in
  the owning workflow namespace.

## Scope Model

Accounting issues are always read inside an explicit accounting scope.

### `profile` scope

- Purpose: current-state, profile-global accounting issues.
- Current families:
  - `transfer_gap`
  - `asset_review_blocker`
- Scope key rule: reuse the profile projection scope key builder:
  `buildProfileProjectionScopeKey(profileId)`, which currently produces
  `profile:<profileId>`.

### `cost-basis` scope

- Purpose: filing/configuration-scoped accounting issues.
- Current families:
  - `missing_price`
  - `tax_readiness`
  - `execution_failure`
- Scope key rule: build the full profile-qualified cost-basis scope key with
  `buildCostBasisScopeKey(profileId, config)`.
- Config-only fingerprint rule: reuse `buildCostBasisConfigScopeKey(config)` as
  the stable config component when that narrower identity is needed.
- Materialization rule: scoped issue rows are created only when the user
  explicitly enters or refreshes that cost-basis scope.

### Scope-entry rules

- Bare `issues` is honest only when it shows the profile-global queue.
- Scoped cost-basis issue browsing stays explicit under `issues cost-basis ...`.
- The overview may list previously materialized scoped lenses, but it must not
  imply coverage for scopes the system has never materialized.

## Canonical Identity

The canonical logical identity for one surfaced issue is:

- `scopeKey`
- `issueKey`

Rules:

- `scopeKey` must be deterministic across rebuilds for the same logical
  accounting scope.
- `issueKey` must be deterministic across rebuilds for the same logical issue
  when the underlying evidence has not materially changed.
- `issueKey` must be family-qualified. It is not just a bare evidence id.
- Stored row `id` is persistence identity only. It is never the canonical issue
  identity and never appears in the operator surface.
- At most one open stored occurrence may exist for one `(scopeKey, issueKey)`.
- If the underlying evidence changes enough to produce a different canonical
  issue, a new `issueKey` is correct.

### Profile `issueKey` shapes

The profile scope uses the following canonical key recipes:

| Family                 | Canonical `issueKey`                                      | Notes                                                                                     |
| ---------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `transfer_gap`         | `transfer_gap:${buildLinkGapIssueKey(identity)}`          | Reuses the existing gap identity inputs: `txFingerprint`, `assetId`, `direction`.         |
| `asset_review_blocker` | `asset_review_blocker:${assetId}\|${evidenceFingerprint}` | Includes `evidenceFingerprint` so changed review evidence produces a new canonical issue. |

Examples:

- `transfer_gap:9c1f37d0ab|cardano:ADA|outflow`
- `asset_review_blocker:blockchain:ethereum:0xa0b8...|asset-review:v1:usdc`

### `ISSUE-REF`

`ISSUE-REF` is a selector-friendly convenience layer, not canonical identity.

Rules:

- Build the full selector material from the canonical identity:
  `sha256Hex(scopeKey + ':' + issueKey)`.
- The full selector is lowercase hexadecimal and is the value used for prefix
  resolution.
- `ISSUE-REF` is the first 10 characters of that full selector.
- CLI selector parsing must normalize user input with `trim().toLowerCase()`.
- `issues view <selector>` resolves against current open issue rows only.
- Selector resolution is prefix-based against the full selector, not against the
  stored row id.
- Ambiguous prefixes must fail and tell the user to provide a longer ref.
- Not-found selectors must fail cleanly.
- Normal operator-facing read contracts use `issueRef`, not raw `issueKey`.

This intentionally aligns `ISSUE-REF` with the existing hashed selector pattern
already used by `LINK-REF` and `GAP-REF`.

## Read Contract

### Shared enums

```ts
type AccountingIssueScopeKind = 'profile' | 'cost-basis';

type AccountingIssueScopeStatus = 'ready' | 'has-open-issues' | 'failed';

type AccountingIssueFamily =
  | 'transfer_gap'
  | 'asset_review_blocker'
  | 'missing_price'
  | 'tax_readiness'
  | 'execution_failure';

type AccountingIssueSeverity = 'warning' | 'blocked';

type AccountingIssueCode =
  | 'LINK_GAP'
  | 'ASSET_REVIEW_BLOCKER'
  | 'MISSING_PRICE_DATA'
  | 'FX_FALLBACK_USED'
  | 'UNRESOLVED_ASSET_REVIEW'
  | 'UNKNOWN_TRANSACTION_CLASSIFICATION'
  | 'UNCERTAIN_PROCEEDS_ALLOCATION'
  | 'INCOMPLETE_TRANSFER_LINKING'
  | 'WORKFLOW_EXECUTION_FAILED';

type StoredAccountingIssueRowStatus = 'open' | 'closed';
```

### Evidence refs

```ts
type AccountingIssueEvidenceRef =
  | { kind: 'transaction'; ref: string }
  | { kind: 'gap'; ref: string }
  | { kind: 'asset'; selector: string };
```

### Next actions

```ts
interface AccountingIssueRouteTarget {
  family: 'links' | 'assets' | 'transactions' | 'prices';
  selectorKind?: 'tx-ref' | 'gap-ref' | 'asset-selector' | undefined;
  selectorValue?: string | undefined;
}

type AccountingIssueNextActionMode = 'direct' | 'routed' | 'review_only';

interface AccountingIssueNextAction {
  kind: string;
  label: string;
  mode: AccountingIssueNextActionMode;
  routeTarget?: AccountingIssueRouteTarget | undefined;
}
```

Rules:

- `nextActions` is part of the accounting issue contract, not a CLI-only
  convenience field.
- Routed actions must point to the owning workflow semantically, not as baked
  shell command strings.
- The shipped `issues` workflow is browse-and-route only and uses `routed` and
  `review_only` actions.
- The shared mode enum retains `direct` for host compatibility, but the `issues`
  browse surfaces do not own domain writes.

### Summary and detail contracts

```ts
interface AccountingIssueSummaryItem {
  issueRef: string;
  family: AccountingIssueFamily;
  code: AccountingIssueCode;
  severity: AccountingIssueSeverity;
  summary: string;
  nextActions: readonly AccountingIssueNextAction[];
}

interface AccountingIssueDetailScope {
  kind: AccountingIssueScopeKind;
  key: string;
}

interface AccountingIssueDetailItem extends AccountingIssueSummaryItem {
  scope: AccountingIssueDetailScope;
  details: string;
  whyThisMatters: string;
  evidenceRefs: readonly AccountingIssueEvidenceRef[];
}
```

### Scope summary contract

```ts
interface AccountingIssueScopeSummary {
  scopeKind: AccountingIssueScopeKind;
  scopeKey: string;
  profileId: number;
  title: string;
  status: AccountingIssueScopeStatus;
  openIssueCount: number;
  blockingIssueCount: number;
  updatedAt: Date;
  metadata?: Record<string, unknown> | undefined;
}
```

## Profile Family Mapping

### `transfer_gap`

- Source: accounting-owned profile link-gap analysis over processed
  transactions, links, accounts, and resolved-gap visibility inputs.
- Scope kind: `profile`.
- Code: `LINK_GAP`.
- Canonical key inputs: existing `LinkGapIssueIdentity`.
- Evidence refs:
  - one `gap` ref using `GAP-REF`
  - one `transaction` ref using `TX-REF`
- Severity mapping:
  - reuse the family-owned gap severity signal when available
  - collapse blocking/error-style gap severity to issue severity `blocked`
  - collapse warning/info-style gap severity to issue severity `warning`
- Primary next action:
  - `kind: 'review_gap'`
  - `label: 'Review in links gaps'`
  - `mode: 'routed'`
  - `routeTarget.family: 'links'`
  - `routeTarget.selectorKind: 'gap-ref'`
  - `routeTarget.selectorValue: <GAP-REF>`

### `asset_review_blocker`

- Source: current asset-review projection summaries.
- Scope kind: `profile`.
- Code: `ASSET_REVIEW_BLOCKER`.
- Inclusion rule:
  - only rows with `accountingBlocked === true` become issue rows
  - assets excluded by the current profile exclusion policy do not become
    `asset_review_blocker` issue rows
  - same-symbol ambiguity is evaluated against the current exclusion policy at
    read time; if every conflicting alternative is excluded, the surviving
    asset does not remain an `asset_review_blocker`
- Canonical key inputs:
  - `assetId`
  - `evidenceFingerprint`
- Evidence refs:
  - one `asset` selector using the canonical asset selector / asset id
- Severity mapping:
  - always `blocked` because this family exists specifically to surface
    accounting blockers
- Primary next action:
  - `kind: 'review_asset'`
  - `label: 'Review in assets'`
  - `mode: 'routed'`
  - `routeTarget.family: 'assets'`
  - `routeTarget.selectorKind: 'asset-selector'`
  - `routeTarget.selectorValue: <asset selector>`

## Cost-Basis Family Mapping

### `missing_price`

- Source: transaction-backed missing-price readiness rows for one explicit
  cost-basis scope.
- Scope kind: `cost-basis`.
- Code set:
  - `MISSING_PRICE_DATA`
- Item-backing rule:
  - always transaction-backed
  - no summary-only fallback row shape is allowed for this family
- Canonical key inputs:
  - readiness code
  - source transaction ref
- Severity mapping:
  - always `blocked`
- Evidence refs:
  - always the owning transaction ref
- Primary next-action mapping:
  - `kind: 'review_prices'`
  - `label: 'Review in prices'`
  - `mode: 'routed'`
  - `routeTarget.family: 'prices'`
  - plus `inspect_transaction` review-only when the row is transaction-backed

### `tax_readiness`

- Source: tax-package readiness evaluation for one explicit cost-basis scope.
- Scope kind: `cost-basis`.
- Code set:
  - `FX_FALLBACK_USED`
  - `UNRESOLVED_ASSET_REVIEW`
  - `UNKNOWN_TRANSACTION_CLASSIFICATION`
  - `UNCERTAIN_PROCEEDS_ALLOCATION`
  - `INCOMPLETE_TRANSFER_LINKING`
- Canonical key inputs:
  - readiness code
  - affected artifact when present
  - affected row ref when present
- Severity mapping:
  - `UNRESOLVED_ASSET_REVIEW`
  - `UNKNOWN_TRANSACTION_CLASSIFICATION`
    map to `blocked`
  - `UNCERTAIN_PROCEEDS_ALLOCATION`
  - `INCOMPLETE_TRANSFER_LINKING`
    map to `warning`
  - `FX_FALLBACK_USED` maps to `warning`
- Evidence refs:
  - transaction refs when the readiness row is transaction-backed
  - no synthetic evidence refs when the issue is scope-backed only
- Primary next-action mapping:
  - `UNRESOLVED_ASSET_REVIEW`
    - `kind: 'review_asset'`
    - `label: 'Review in assets'`
    - `mode: 'routed'`
    - `routeTarget.family: 'assets'`
  - `INCOMPLETE_TRANSFER_LINKING`
    - `kind: 'review_links'`
    - `label: 'Review in links'`
    - `mode: 'routed'`
    - `routeTarget.family: 'links'`
  - `UNKNOWN_TRANSACTION_CLASSIFICATION`
  - `UNCERTAIN_PROCEEDS_ALLOCATION`
    - `kind: 'inspect_transaction'`
    - `label: 'Inspect transaction'`
    - `mode: 'review_only'`
    - `routeTarget.family: 'transactions'`
    - include a transaction selector only when the readiness row is transaction-backed
  - `FX_FALLBACK_USED`
    - `kind: 'review_filing_output'`
    - `label: 'Review filing output'`
    - `mode: 'review_only'`

### `execution_failure`

- Source: current workflow/build failure while materializing one explicit
  cost-basis scope.
- Scope kind: `cost-basis`.
- Code set:
  - `WORKFLOW_EXECUTION_FAILED`
- Canonical key inputs:
  - failure stage
- Severity mapping:
  - always `blocked`
- Evidence refs:
  - none in the first slice
  - latest failure snapshots remain debug state, not the canonical issue source
- Primary next-action mapping:
  - `kind: 'review_execution_failure'`
  - `label: 'Review failure detail'`
  - `mode: 'review_only'`

## Persistence Model

The current issue projection persists:

- one `accounting_issue_scopes` table
- one `accounting_issue_rows` lifecycle table containing both open and closed
  occurrences

### Scope row

```ts
interface AccountingIssueScopeRow {
  scopeKind: AccountingIssueScopeKind;
  scopeKey: string;
  profileId: number;
  title: string;
  status: AccountingIssueScopeStatus;
  openIssueCount: number;
  blockingIssueCount: number;
  updatedAt: Date;
  metadataJson?: string | undefined;
}
```

### Issue row

```ts
interface AccountingIssueRow {
  id: string;
  scopeKey: string;
  issueKey: string;
  family: string;
  code: string;
  severity: string;
  status: StoredAccountingIssueRowStatus;
  summary: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  closedAt?: Date | undefined;
  closedReason?: 'disappeared' | undefined;
  detailJson: string;
  evidenceJson: string;
  nextActionsJson: string;
}
```

Rules:

- One open row at most per `(scopeKey, issueKey)`.
- Reappearing issues create a new row.
- Closed rows are retained for history and progress.
- `detailJson`, `evidenceJson`, and `nextActionsJson` cache typed accounting
  payloads. They are not permission to treat those contracts as untyped blobs at
  the accounting boundary.
- Issue rows are a persisted derived projection. Users do not mutate issue rows
  directly.

## Materialization Rules

### Materializer split

- One materializer handles profile-global issue scopes.
- A second materializer handles cost-basis-scoped issue lenses on the same
  storage model.

### Scope reconciliation

For one scope materialization pass:

1. Derive the full current issue set for that scope from accounting-owned
   sources.
2. Upsert the scope row with current title, counts, status, and `updatedAt`.
3. Match each derived issue occurrence to any currently open stored row by
   `(scopeKey, issueKey)`.
4. If one open row already exists:
   - refresh its cached summary, detail, evidence, and next actions
   - keep the same row `id`
   - update `lastSeenAt`
5. If no open row exists:
   - create a new row
   - generate a new row `id`
   - set `firstSeenAt = lastSeenAt = now`
6. For any previously open stored row missing from the new derived set:
   - mark it `closed`
   - set `closedAt`
   - set `closedReason = 'disappeared'`

Logical replace-by-scope means:

- current truth is fully rederived per scope
- persistence preserves issue-occurrence continuity and disappearance history
  instead of deleting rows physically
- owning workflows change source state, not issue rows
- the next issue materialization pass must remove or change the affected issue
  when that source state changed
- hosts may refresh an affected scope projection immediately after a corrective
  action when the affected scope is exact and cheap to recompute

## Read-Service Lean

The first accounting-owned service seam should stay scope-oriented:

- materialize or refresh one scope
- list persisted scope summaries for one profile
- list current issue rows for one scope
- read one current issue by `(scopeKey, issueKey)`

Repositories stay responsible for persistence and reconciliation. CLI must not
assemble issue persistence ad hoc.

## Shipped Surface

### Profile scope

- Profile-global scope materialization.
- Families:
  - `transfer_gap`
  - `asset_review_blocker`
- Read surfaces:
  - `issues`
  - `issues list`
  - `issues view <ISSUE-REF>`
- JSON parity for overview and detail.
- No write actions in `issues`.

### Cost-basis scope

- Explicit `cost-basis` scoped issue browsing on the same issue model.
- Uses the full profile-qualified cost-basis scope key:
  `buildCostBasisScopeKey(profileId, config)`.
- Scoped lenses appear in the overview only after they have been materialized
  explicitly.
- Families:
  - `missing_price`
  - `tax_readiness`
  - `execution_failure`
