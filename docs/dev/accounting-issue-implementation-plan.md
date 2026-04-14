---
last_verified: 2026-04-14
status: active
---

# Accounting Issue Implementation Plan

Owner: Codex + Joel
Discovery log:

- [accounting-issue-operations-plan.md](/Users/joel/Dev/exitbook/docs/dev/accounting-issue-operations-plan.md)
- [accounting-issues.md](/Users/joel/Dev/exitbook/docs/specs/accounting-issues.md)
- [issues-view-spec.md](/Users/joel/Dev/exitbook/docs/specs/cli/issues/issues-view-spec.md)

## Goal

Implement a clean operator workflow for accounting issues in phased slices.

The target UX is:

1. the user runs `issues`
2. sees remaining work clearly
3. sees the possible next actions for each issue without guessing
4. fixes issues without guessing which command family owns the correction
5. sees progress go down
6. reaches an explicit ready state for the relevant accounting scope

This work is not done when the user can only inspect issues.

It is done only when:

- every intended operator-facing accounting issue family is visible in the issue workflow
- the user has access to the corrective actions needed for the actionable families
- the remaining issue families are explicitly review-only by design, not by missing functionality
- the user can go from open issues to a real ready-to-report state without code changes

## Chosen Model

### Domain Boundary

- accounting owns the issue model and issue materialization
- data owns persisted storage
- CLI owns selectors, rendering, and command wiring
- domain-changing corrections stay in narrow domain override families
- Phase 1A issue contracts should stay in `@exitbook/accounting`, not `@exitbook/core`, unless a second non-accounting owner appears

### Persistence Boundary

- persisted issue projection, not ad hoc derived-only reads
- canonical issue identity stays derived by family
- persisted rows are not the source of accounting truth

### Deterministic Identity Rules

- `scopeKey` must be deterministic across reprocess for the same logical accounting scope
- `issueKey` must be deterministic across reprocess for the same logical issue when the underlying evidence has not materially changed
- persisted row `id` is **not** canonical identity and does not need to be stable across reprocess
- if the underlying evidence changes enough to produce a different canonical issue, a new `issueKey` is correct
- scoped cost-basis issue identity must stay profile-qualified; config-only scope keys are not sufficient

### Core Storage Shape

Phase 1A storage:

- one `accounting_issue_scopes` table
- one `accounting_issue_rows` lifecycle table for both:
  - current open rows
  - closed historical rows

Phase 1A row rules:

- one open row at most per `(scopeKey, issueKey)`
- reappearing issues create a new row
- closed rows are retained for history/progress

### Scope Model

- `profile`
  - current-state issues
  - transfer gaps
  - asset-review blockers
- `cost-basis`
  - filing/configuration-scoped issues
  - tax readiness
  - later execution failures

### CLI Lean

- `issues`
  - overview / work queue
- `issues view <ISSUE-REF>`
  - current issue detail
- `issues cost-basis ...`
  - scoped cost-basis lens entry and browsing

### Next-Action Model

- issue rows should advertise a typed list of allowed next actions
- action suggestions are family-owned, not generated from generic prose
- the action shape must be host-agnostic and usable by future non-CLI UIs
- baked shell command strings do **not** belong in the core action contract
- CLI may derive command hints at render time from the structured action data
- action suggestions may be:
  - `direct`
  - `routed`
  - `review_only`
- Phase 1A can ship mostly routed/review-only actions
- later phases can add direct corrective actions onto the same surface

### Phase 1A Field Lean

Scope row:

- `scopeKind`
- `scopeKey`
- `profileId`
- `title`
- `status`
- `openIssueCount`
- `blockingIssueCount`
- `updatedAt`
- optional metadata json

Issue row:

- `id`
- `scopeKey`
- `issueKey`
- `family`
- `code`
- `severity`
- `status`
- `summary`
- `firstSeenAt`
- `lastSeenAt`
- optional `closedAt`
- optional `closedReason='disappeared'`
- `detailJson`
- `evidenceJson`
- `nextActionsJson`

Phase 1A next-action shape:

- `kind`
- `label`
- `mode`
  - `direct`
  - `routed`
  - `review_only`
- optional `routeTarget`

### Authoritative Phase 1A Contracts

Phase 1A implementation should now treat the following docs as authoritative:

- domain/storage/lifecycle contract:
  [accounting-issues.md](/Users/joel/Dev/exitbook/docs/specs/accounting-issues.md)
- CLI read-surface contract:
  [issues-view-spec.md](/Users/joel/Dev/exitbook/docs/specs/cli/issues/issues-view-spec.md)

Do not mine the frozen operations doc for missing rules during implementation.
The canonical docs above now commit:

- `ISSUE-REF` derivation and prefix-resolution rules
- Phase 1A issue families, codes, severity/status enums, and evidence refs
- `routeTarget` and `nextActions` shape
- Phase 1A source-to-issue mapping
- persisted scope/row lifecycle and reconciliation rules

## Non-Negotiable Rules

1. Deterministic system fixes still come first.
2. User actions must be typed, auditable, and reversible.
3. No free-form notes as machine state.
4. No user action may silently rewrite raw transaction amounts or fake provenance.
5. Every corrective action must validate against current movement identity and semantics.
6. If the system cannot support a correction safely, the issue remains review-only.
7. Final implementation must land in canonical specs, not remain in `docs/dev`.

## Definition Of Done

This initiative is complete only when all of the following are true:

1. `issues` is the primary operator work queue for accounting problems.
2. All intended operator-facing accounting issue families are surfaced there directly or through explicit scoped drill-in.
3. Every actionable issue family has the corrective action path it requires.
4. Review-only issue families are explicitly review-only by design, not because we never built the correction path.
5. The user can move from open issues to a clear ready state and then produce the final report without code changes.
6. Canonical specs describe the shipped behavior fully.

## Phase Plan

### Phase 1A: Profile-Global Issue Projection

Status: complete

Completed so far:

- accounting-owned Phase 1A issue model landed in `packages/accounting/src/issues/`
- profile-global issue materialization landed for:
  - `transfer_gap`
  - `asset_review_blocker`
- persisted storage landed:
  - `accounting_issue_scopes`
  - `accounting_issue_rows`
- reconciliation repository landed in `packages/data/src/repositories/accounting-issue-repository.ts`
- profile-global issue source loading landed in `packages/data/src/accounting/issues-source-data.ts`
- targeted tests landed for:
  - profile snapshot building
  - repository reconciliation / read-back
  - issue selector resolution
  - static overview/detail rendering
- CLI browse surface landed under `apps/cli/src/features/issues/`
- overview/detail JSON output landed for:
  - `issues`
  - `issues list`
  - `issues view <ISSUE-REF>`
- live CLI validation passed against a fresh temp data dir using `node --import tsx ./apps/cli/src/index.ts issues --json`
- real-workspace CLI validation passed after DB reset and reimport:
  - `pnpm run dev issues`
  - `pnpm run dev issues --json`
  - `pnpm run dev issues list`
  - `pnpm run dev issues view <ISSUE-REF>`
  - `pnpm run dev issues view <ISSUE-REF> --json`

Notes:

- the initial real-workspace blocker was an in-flight import session, not an issue with the `issues` surface
- after the import completed, the reimported workspace validated cleanly with a 58-item profile-global issue queue

Deliver:

- new accounting-owned issue read model
- profile scope materialization only
- persisted scope rows
- persisted issue rows
- issue families:
  - `transfer_gap`
  - `asset_review_blocker`
- CLI surfaces:
  - `issues`
  - `issues list`
  - `issues view <ISSUE-REF>`
  - JSON parity for overview and detail
  - visible possible next actions on list/detail rows

Likely code areas:

- `packages/accounting/src/issues/`
- `packages/accounting/src/ports/`
- `packages/data/src/repositories/`
- `packages/data/src/migrations/001_initial_schema.ts`
- `apps/cli/src/features/issues/`

Acceptance criteria:

- bare `issues` shows current profile-global work only
- `issues list` is an alias of the same overview surface
- issue detail renders typed evidence and clear next-step guidance
- issue rows show typed possible next actions without requiring the user to infer the owning workflow
- no scoped tax-readiness rows appear yet
- no write actions exist yet
- selector behavior is covered:
  - `ISSUE-REF` is derived from `sha256Hex(scopeKey + ':' + issueKey)` with a 10-character displayed ref
  - ambiguous prefixes fail cleanly
  - missing refs fail cleanly
- lifecycle behavior is covered:
  - open rows refresh in place when `(scopeKey, issueKey)` is unchanged
  - disappeared rows close with `closedReason='disappeared'`
  - reappearing issues create a new row
- family mapping is covered:
  - `transfer_gap` rows reuse canonical gap identity and route to `links`
  - `asset_review_blocker` rows key on `assetId + evidenceFingerprint` and route to `assets`
- JSON contracts are covered:
  - overview summary
  - overview current issue rows
  - detail payload with embedded scope metadata
- targeted tests + package builds
- at least one live CLI check against real workspace data

### Phase 1B: Scoped Cost-Basis Issue Projection

Status: in progress

Completed so far:

- profile-qualified cost-basis issue scope identity landed in `packages/accounting/src/issues/`
- scoped `tax_readiness` issue family mapping landed in `packages/accounting/src/issues/cost-basis-issues.ts`
- cross-scope current-issue lookup landed in `packages/data/src/repositories/accounting-issue-repository.ts`
- accounting/data targeted tests landed for:
  - cost-basis issue scope key + snapshot building
  - cross-scope current-issue repository reads

Remaining in this phase:

- `issues cost-basis ...` CLI browse path
- known scoped lens discovery from bare `issues`
- cross-scope `issues view <ISSUE-REF>` resolution
- Phase 1B live CLI validation

Deliver:

- cost-basis scope materialization on the same persisted model
- known scoped lenses discoverable from `issues`
- scoped tax-readiness issue rows
- `issues cost-basis ...` browse path
- typed next actions for scoped issue rows

Acceptance criteria:

- scoped lens entry is explicit
- overview can discover known scoped lenses honestly
- scoped rows do not appear without a real scope story
- scoped issue rows show their possible next actions clearly
- scoped materialization is explicit:
  - no hidden cost-basis calculation runs from bare `issues`
  - `issues cost-basis ...` only shows the requested scope
- scoped identity is profile-safe:
  - cost-basis issue scopes cannot collide across profiles that share the same reporting config
- targeted tests + package builds + live CLI checks

### Phase 2: Review-State Actions

Status: pending

Deliver:

- `acknowledge`
- `reopen` acknowledgement
- durable review-state persistence shape
- review-state actions appear in the same typed next-action model

Rules:

- acknowledgement must not change accounting truth
- acknowledgement must not make a blocking scope ready
- reappearing issues must require fresh acknowledgement

Acceptance criteria:

- review-state survives rebuilds as designed
- readiness counts remain honest
- targeted tests + package builds + live CLI checks

### Phase 3: Domain Corrective Actions

Status: pending

Candidate families:

- grouped transfer confirmation
- explained residual declaration
- movement-role override
- other family-specific typed corrections

Rules:

- corrections stay in domain-specific override streams
- no generic `issues fix`
- each corrective action ships independently with its own validation and replay rules

Overlap risks to guard explicitly:

- `confirm_grouped_transfer` vs `declare_explained_residual`
- `declare_explained_residual` vs `override_movement_role`
- `override_movement_role` vs any future `exclude_from_transfer_matching`

Acceptance criteria:

- each action changes accounting state safely and audibly
- each action has preview/validation where required
- no overlapping escape hatches without explicit boundaries
- all actionable issue families identified so far have either:
  - shipped corrective actions
  - or an explicit later phase because the family itself is not shipped yet
- direct corrective actions appear through the same typed next-action surface the user already sees in `issues`

### Phase 4: Remaining Issue Families

Status: pending

Deliver:

- execution-failure issue family
- missing-price issue family once item-backed accounting detail exists
- any other deferred issue families needed for the accounting work queue to be complete

Rules:

- do not force summary-only rows into the queue when the actionable unit is still unknown
- do not add a family until its read seam and ownership are clear

Acceptance criteria:

- `issues` covers all intended operator-facing accounting issue families
- no major accounting blocker still lives only in an unrelated command without issue-surface visibility
- any newly added issue family is explicitly classified as:
  - actionable with a corrective path
  - or review-only by design
- targeted tests + package builds + live CLI checks

### Phase 5: Completion And Convergence

Status: pending

Deliver:

- remove or narrow duplicated legacy issue/warning surfaces where appropriate
- ensure `issues` is the primary operator work queue
- finalize canonical specs
- complete end-to-end verification for:
  - `issues` overview
  - scoped issue browsing
  - corrective actions
  - readiness-to-report flow

Acceptance criteria:

- the user can go from open accounting issues to a clear ready state without needing code changes
- the user has access to all corrective actions required for the shipped actionable issue families
- legacy surfaces no longer carry issue-review burden that properly belongs in `issues`
  - candidate narrowing/removal targets:
    - duplicate interactive `cost-basis` readiness warning surfacing
    - portfolio warning-string issue surfacing
    - broader accounting-review burden currently leaking through `links gaps`
- canonical specs describe the shipped system fully
- end-to-end live verification is clean for at least one real reporting scope

## Explicit Non-Goals For Phase 1A

- no generic write actions
- no scoped tax-readiness rows
- no execution-failure issue rows
- no missing-price issue rows
- no TUI/explorer
- no append-only issue event store as the primary persistence model

## Open Questions

These are real follow-ups, but they do not block Phase 1A.

- What is the cleanest read seam for discovering known scoped accounting lenses?
- How much scoped-lens freshness and staleness detail should bare `issues` show in Phase 1A?
- What durable persistence shape is right for Phase 2 review-state actions?

## Canonical Spec Targets

When implementation lands, update or add canonical specs for:

- [accounting-issues.md](/Users/joel/Dev/exitbook/docs/specs/accounting-issues.md)
- [issues-view-spec.md](/Users/joel/Dev/exitbook/docs/specs/cli/issues/issues-view-spec.md)
- scoped cost-basis issue browsing
- review-state actions
