last_verified: 2026-04-14
status: canonical

---

# Issues CLI Spec

## Scope

This document defines the browse surfaces for the `issues` family:

- `exitbook issues`
- `exitbook issues list`
- `exitbook issues view <selector>`
- `exitbook issues cost-basis --jurisdiction ... --tax-year ... --method ... [--fiat-currency ... --start-date ... --end-date ...]`

It covers:

- overview/work-queue UX
- issue detail UX
- scoped cost-basis issue browsing
- selector rules
- list/detail JSON shape expectations
- how possible next actions render in the read path

Out of scope:

- domain corrective actions
- routed domain workflows such as `assets confirm` or future transfer corrections
- TUI/explorer behavior
- issue-local acknowledgement or reopen state

This spec is the intended browse target for the shipped issue surface.

The shared accounting issue object, selector contract, scope model, and
materialization lifecycle live in
[accounting-issues.md](/Users/joel/Dev/exitbook/docs/specs/accounting-issues.md).
This document defines how that shared contract renders through the CLI.

## Family Model

The `issues` family is the operator-facing accounting issue workflow.

Rules:

- `issues` is overview-first, not filter-first
- the `issues` family is browse-first; corrective actions stay in owning
  workflows
- issue identity is derived; numeric row ids are storage details only
- the family may route users into owning workflows, but does not absorb those workflows by default
- the family must make remaining work and next actions clear without requiring the user to infer command ownership

Shared contract note:

- overview `currentIssues` rows use the shared `AccountingIssueSummaryItem`
  contract
- `issues view <selector>` uses the shared `AccountingIssueDetailItem`
  contract
- overview `scopedLenses` rows use the shared `AccountingIssueScopeSummary`
  contract

## Command Surface

### Browse shapes

| Shape                                                                                                                    | Meaning                                     | Human surface      |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- | ------------------ |
| `issues`                                                                                                                 | Overview of current accounting work         | Static overview    |
| `issues list`                                                                                                            | Explicit alias of the same overview surface | Static overview    |
| `issues view <selector>`                                                                                                 | Focused inspection of one current issue     | Static detail card |
| `issues cost-basis --jurisdiction ... --tax-year ... --method ... [--fiat-currency ... --start-date ... --end-date ...]` | Scoped issue list for one cost-basis lens   | Static scoped list |
| Any of the above + `--json`                                                                                              | Machine output for the same semantic target | JSON               |

Rules:

- bare `issues` is not a flat dump of all rows; it is an overview/work queue
- `issues list` is an alias of the same overview surface
- `issues view <selector>` is always detail-shaped
- `issues` remains useful even before scoped cost-basis lenses exist
- `issues` does not require flags for the default operator flow

### Scoped cost-basis path

The scoped path is intentionally explicit:

```text
exitbook issues cost-basis --jurisdiction CA --tax-year 2024 --method average-cost
```

Rules:

- scoped cost-basis browsing is a separate lens under the same issue family
- when a host already knows the exact cost-basis scope, it should include `--fiat-currency`, `--start-date`, and `--end-date` in the routed command instead of collapsing back to a looser tax-year-only selector
- scoped issue rows must never appear without an explicit scope story
- `issues cost-basis ...` is list-shaped
- `issues view <selector>` remains the detail path even for scoped issues

## Selectors And Identity

### Selector

`<selector>` is a short `ISSUE-REF` derived from the current issue identity.

Canonical identity inputs:

- `scopeKey`
- `issueKey`

Rules:

- `scopeKey` must be deterministic across reprocess for the same logical accounting scope
- `issueKey` must be deterministic across reprocess for the same logical issue when the underlying evidence has not materially changed
- `issueKey` must be family-qualified
- `ISSUE-REF` is derived from current issue identity; it is not the canonical key itself
- persisted row `id` is storage identity only and does not appear in the operator surface
- selector resolution is prefix-based
- ambiguous ref prefixes must fail and tell the user to provide a longer ref
- `issues view <selector>` resolves only against current surfaced issue rows
- closed historical rows are out of scope for the Phase 1A / 1B read surface
- operator-facing list and detail surfaces use `ISSUE-REF`, not raw `issueKey`

Implementation contract:

- build the full selector as `sha256Hex(scopeKey + ':' + issueKey)`
- `ISSUE-REF` is the first 10 characters of that full selector
- normalize selector input with `trim().toLowerCase()`
- prefix matching happens against the full selector, not the displayed 10-character ref alone

### Reappearing issues

Rules:

- reappearing issues create a new stored row
- the canonical issue identity remains derived from `scopeKey + issueKey`
- the user-facing selector always targets the current surfaced issue row

## Shared Data Semantics

### Current read families

The issue family may surface rows from these families:

- `transfer_gap`
- `asset_review_blocker`
- `missing_price`
- `tax_readiness`
- `execution_failure`

### Next actions

Every issue row must include a typed `nextActions` list.

Rules:

- `nextActions` is part of the cross-UI issue contract, not a CLI-only convenience
- the action shape must be host-agnostic and usable by future non-CLI surfaces
- action suggestions are family-owned, not generated from free-form prose
- action modes are:
  - `direct`
  - `routed`
  - `review_only`
- a routed action includes a semantic route target
- CLI may derive renderer-specific command hints from structured action data
- direct actions are reserved for real domain corrections that change the
  underlying source state and therefore the derived issue projection

### Action rendering rules

Rules:

- issue list rows should render the primary next action inline when one exists
- if multiple actions exist, the list may show one primary action plus a compact “+N more” indicator
- issue detail must render the full action list
- routed actions must clearly indicate the owning workflow
- review-only actions must render as informational next steps, not as fake mutations
- direct actions may appear only when the underlying write path is implemented
- the same action slot must later support real corrective actions such as:
  - grouped transfer confirmation
  - grouped transfer confirmation with one exact explained target residual
  - movement-role override
  - pricing correction flows when those are modeled as issue actions

## Overview Surface

### Applies to

- `exitbook issues`
- `exitbook issues list`

### Layout

The overview is sectioned, not a flat undifferentiated table.

Sections:

1. summary header
2. `Current Issues`
3. optional `Scoped Accounting Lenses`

Rules:

- Phase 1A may render only `Current Issues`
- Phase 1B renders `Scoped Accounting Lenses` when scoped issue scopes have
  already been materialized for the active profile
- when there are no current issues, the overview still shows readiness clearly
- overview ordering should prefer:
  1. blocking work
  2. actionable non-blocking work
  3. informational context

### Header

Header shape:

```text
Issues {open} open · {blocking} blocking · {ready_or_not_ready_summary}
```

Rules:

- header should make remaining work obvious
- the surface should help the user answer “how many are left?”
- readiness copy must stay honest: only real source-state changes can make a
  blocking scope ready

### Current Issues section

List columns:

- `ISSUE-REF`
- `SEV`
- `TYPE`
- `SUMMARY`
- `NEXT`

Rules:

- `TYPE` is a human family label, not an internal enum
- `SUMMARY` must be user-facing and outcome-oriented
- `NEXT` renders the primary next action label, not just a family name
- if the issue has no direct or routed action, `NEXT` may render a review-only label
- issue rows are chronologically stable only insofar as severity and current-state ordering allow; the primary sort is operator usefulness, not timestamp

Overview JSON contract:

- every `currentIssues` row must include:
  - `issueRef`
  - `family`
  - `code`
  - `severity`
  - `summary`
  - `nextActions`
- overview JSON may omit detail-only fields such as `details`,
  `whyThisMatters`, and `evidenceRefs`

### Scoped Accounting Lenses section

This section is hidden when no scoped lenses are known.

Each row represents one known scoped cost-basis lens.

Scoped lens columns:

- `SCOPE`
- `STATUS`
- `OPEN`
- `UPDATED`
- `NEXT`

Rules:

- scoped lenses are overview entries, not issue rows
- a scoped lens row leads to `issues cost-basis ...`
- the section must not imply coverage for scopes the system has never materialized

Scoped lens JSON contract:

- every `scopedLenses` row must include:
  - `scopeKind`
  - `scopeKey`
  - `title`
  - `status`
  - `openIssueCount`
  - `blockingIssueCount`
  - `updatedAt`
- human rendering may derive friendlier `SCOPE` labels and readiness labels from
  scope metadata, but the JSON contract keeps the canonical scope identity and
  readiness enum

## Issue Detail Surface

### Applies to

- `exitbook issues view <selector>`

### Body order

1. title line with issue ref, severity, and human type
2. `Scope`
3. `Summary`
4. `Details`
5. `Why this matters`
6. `Possible next actions`
7. `Evidence`
8. optional routed workflow guidance

Rules:

- detail must explain the issue in operator language, not only system language
- detail must show all possible next actions for that row
- `Why this matters` should be family-owned baseline copy with issue-specific detail only when needed
- evidence refs should remain native:
  - `TX-REF`
  - `GAP-REF`
  - asset selectors
  - later link refs or failure refs
- if the fix lives elsewhere, detail must make that clear without pretending the action runs inside `issues`

Detail JSON contract:

- detail payload must include:
  - `issueRef`
  - `scope`
  - `family`
  - `code`
  - `severity`
  - `summary`
  - `details`
  - `whyThisMatters`
  - `evidenceRefs`
  - `nextActions`

## Scoped Cost-Basis Surface

### Applies to

- `exitbook issues cost-basis --jurisdiction ... --tax-year ... --method ...`

### Layout

1. scope header
2. readiness line
3. scoped issue list

Rules:

- the scoped view is list-shaped, not overview-shaped
- this surface includes only issues for the requested accounting scope
- scope metadata must be explicit in the header
- readiness must be shown for the requested scope, not inferred from the global overview

Readiness line shape:

```text
Status: {human_readiness} · {blocking} blocking · {open} open
```

### Scoped list columns

- `ISSUE-REF`
- `SEV`
- `TYPE`
- `SUMMARY`
- `NEXT`

Rules:

- scoped issue rows render the same next-action model as profile-global issue rows
- if the issue routes back to another workflow, that route remains visible here
- the scoped list must not silently mix in other scopes

## JSON Output

### Overview JSON

Applies to:

- `exitbook issues --json`
- `exitbook issues list --json`

Shape:

```json
{
  "data": {
    "summary": {
      "openIssueCount": 4,
      "blockingIssueCount": 3,
      "status": "has-open-issues"
    },
    "currentIssues": [
      {
        "issueRef": "2d4c8e1af3",
        "family": "transfer_gap",
        "code": "LINK_GAP",
        "severity": "blocked",
        "summary": "Unmatched ADA outflow still needs transfer review",
        "nextActions": [
          {
            "kind": "review_gap",
            "label": "Review in links gaps",
            "mode": "routed",
            "routeTarget": {
              "family": "links",
              "selectorKind": "gap-ref",
              "selectorValue": "c6787f8ae9"
            }
          }
        ]
      }
    ],
    "scopedLenses": []
  }
}
```

Rules:

- `currentIssues` contains real issue rows
- `scopedLenses` contains scope summaries, not issue rows
- overview JSON must preserve the structured `nextActions` list

### Detail JSON

Applies to:

- `exitbook issues view <selector> --json`

Rules:

- returns one issue detail object with embedded scope metadata
- includes the full `nextActions` list
- includes typed evidence refs

Shape:

```json
{
  "data": {
    "issueRef": "2d4c8e1af3",
    "scope": {
      "kind": "profile",
      "key": "profile:42"
    },
    "family": "transfer_gap",
    "code": "LINK_GAP",
    "severity": "blocked",
    "summary": "ADA transfer still needs review",
    "details": "This outflow has no confirmed internal transfer match yet.",
    "whyThisMatters": "Blocks trustworthy transfer accounting for this movement.",
    "evidenceRefs": [
      { "kind": "gap", "ref": "c6787f8ae9" },
      { "kind": "transaction", "ref": "9c1f37d0ab" }
    ],
    "nextActions": [
      {
        "kind": "review_gap",
        "label": "Review in links gaps",
        "mode": "routed",
        "routeTarget": {
          "family": "links",
          "selectorKind": "gap-ref",
          "selectorValue": "c6787f8ae9"
        }
      }
    ]
  }
}
```

### Scoped cost-basis JSON

Applies to:

- `exitbook issues cost-basis ... --json`

Rules:

- returns scoped lens metadata plus scoped issue rows
- scoped rows use the same issue row shape as detail/list outputs

Shape:

```json
{
  "data": {
    "scope": {
      "scopeKind": "cost-basis",
      "scopeKey": "profile:42:cost-basis:8b5e53cd",
      "profileId": 42,
      "title": "CA / average-cost / 2024",
      "status": "has-open-issues",
      "openIssueCount": 2,
      "blockingIssueCount": 2,
      "updatedAt": "2026-04-14T22:30:00.000Z"
    },
    "currentIssues": [
      {
        "issueRef": "a8f24c7d19",
        "family": "missing_price",
        "code": "MISSING_PRICE_DATA",
        "severity": "blocked",
        "summary": "Required transaction price data is missing.",
        "nextActions": [
          {
            "kind": "review_prices",
            "label": "Review in prices",
            "mode": "routed",
            "routeTarget": {
              "family": "prices"
            }
          },
          {
            "kind": "inspect_transaction",
            "label": "Inspect transaction",
            "mode": "review_only",
            "routeTarget": {
              "family": "transactions",
              "selectorKind": "tx-ref",
              "selectorValue": "abcd1234ef"
            }
          }
        ]
      }
    ]
  }
}
```

## Mockups

These mockups illustrate the intended screen shape.

- The first examples show Phase 1A-style routed and review-only actions because those are the first actions expected to exist.
- They do **not** imply that the final `issues` surface is limited to routed actions.
- Later phases should render real direct corrective actions in the same `Possible next actions` section.

### Overview Mockup

```text
Issues 4 open · 3 blocking · Profile not ready

Current Issues

ISSUE-REF   SEV      TYPE                  SUMMARY                               NEXT
2d4c8e1af3  blocked  Transfer gap          ADA transfer still needs review       Review in links gaps
7b12aa09ce  blocked  Asset review blocker  USDC asset review blocks accounting   Review in assets
31a9ef2b77  warning  Transfer gap          Small SOL residual is unexplained     Inspect gap detail

Scoped Accounting Lenses

SCOPE                         STATUS     OPEN  UPDATED            NEXT
CA / average-cost / 2024      NOT READY  2     2026-04-13 09:42  Open scoped issues
US / fifo / 2025              READY      0     2026-04-12 18:10  View readiness
```

### Empty Overview Mockup

```text
Issues 0 open · 0 blocking · Profile ready

Current Issues

No current accounting issues.

You can proceed to your next scoped reporting workflow.
```

### Issue Detail Mockup

```text
Issue 2d4c8e1af3 [BLOCKED] Transfer gap

Scope: profile (profile:1)
Summary
  ADA transfer still needs review

Details
  This outflow has no confirmed internal transfer match yet. The system found no exact deterministic explanation.

Why this matters
  Blocks trustworthy transfer accounting for this movement.

Possible next actions
  1. Review in links gaps
     Routed action · links gaps view c6787f8ae9
  2. Inspect transaction
     Review only · transactions view 9c1f37d0ab

Evidence
  GAP-REF c6787f8ae9
  TX-REF  9c1f37d0ab
```

### Future Direct-Action Detail Mockup

```text
Issue 6f2e4c91ab [BLOCKED] Transfer gap

Scope: profile (profile:1)
Summary
  Three source movements and one target movement likely form one grouped transfer

Possible next actions
  1. Confirm grouped transfer
     Direct action
  2. Review in links gaps
     Routed action · links gaps view 4cb3180f2d
  3. Inspect transaction
     Review only · transactions view a19c42d177
```

### Scoped Cost-Basis Mockup

```text
Issues · Cost basis scope
CA · average-cost · 2024
Status: not ready · 2 blocking · 2 open

ISSUE-REF   SEV      TYPE           SUMMARY                                      NEXT
98d1cc7a01  blocked  Tax readiness  Transfer linking is incomplete for one row   Review in links
27f90be4d3  blocked  Tax readiness  Transaction classification is still unknown  Inspect transaction
```

## Semantic Rules

- `issues` is the operator work queue, not a generic diagnostics dump
- overview entries and issue rows are different objects
- routed actions must not pretend to be direct actions
- review-only actions must not imply that accounting state will change
- direct actions are part of the intended final shape and appear once their write path exists
