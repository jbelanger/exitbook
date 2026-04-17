---
last_verified: 2026-04-17
status: active
---

# CLI Investigation Surface Phase 0

Owner: Codex + Joel
Primary evidence:

- [cli-issue-investigation-log.md](/Users/joel/Dev/exitbook/docs/dev/cli-issue-investigation-log.md)
- [links-view-spec.md](/Users/joel/Dev/exitbook/docs/specs/cli/links/links-view-spec.md)
- [transactions-view-spec.md](/Users/joel/Dev/exitbook/docs/specs/cli/transactions/transactions-view-spec.md)
- [issues-view-spec.md](/Users/joel/Dev/exitbook/docs/specs/cli/issues/issues-view-spec.md)
- [cli-surface-v3-tracker.md](/Users/joel/Dev/exitbook/docs/dev/cli-surface-v3-tracker.md)

## Goal

Redesign the CLI investigation workflow so real issue resolution can continue
through the shipped command surface without repetitive guesswork.

This phase is not about adding a lot of new screens.

It is about deciding how far the existing surfaces should be rewritten before
we keep grinding the remaining live issue queue.

## Why This Phase Exists

The issue investigation passes established two things:

1. The CLI is already strong enough to solve obvious cases.
2. The remaining queue is now dominated by workflow shape problems, not missing
   syntax.

The main friction is no longer:

- "which command do I run?"

It is now:

- "how do I classify this counterparty cleanly?"
- "how do I inspect the exact evidence without bouncing between commands?"
- "how do I handle a repeated pattern without resolving rows one by one?"

## Non-Negotiable Rules

1. Prefer rewriting existing surfaces over adding new screens.
2. A new surface needs a strong case that the existing command family cannot
   carry the workflow cleanly.
3. `issues` remains the work queue, not the place where deep investigation
   happens.
4. `links gaps` remains the transfer-gap workflow, but it does not need to stay
   row-shaped if the real workflow is grouped or paired.
5. `transactions view` should become the deepest single-transaction inspection
   surface before we invent another inspection family.
6. Wallet-boundary classification should start from `accounts`, not `links`,
   unless a later pass proves that boundary too narrow.
7. Provider/source evidence must be viewable from the CLI for hard
   investigations.

## Current Surface Map

### `issues`

Current role:

- work queue
- route into the owning workflow

Current limit:

- good at triage
- weak at investigation

Decision:

- keep it lean
- do not turn `issues view` into the full forensic surface

### `links gaps`

Current role:

- transfer-gap review
- explicit gap exception workflow

Current limits:

- too row-by-row for grouped patterns
- too weak for bridge-pair review
- no first-class notion of known external wallets
- repetitive resolve flow for repeated one-way receipt patterns

### `transactions view`

Current role:

- best single-transaction inspection surface

Current limits:

- still does not expose provider/source data
- still requires too much command-hopping for related context

### `accounts`

Current role:

- owned-account management
- add/remove/update/refresh

Current limits:

- binary model: either owned account or nothing
- no first-class concept for "known external wallet"

## Phase 0 Questions

### 1. Wallet Classification

We need a clean operator model for:

- owned wallet
- known external wallet
- unknown counterparty

The live family-wallet mistake proved this is not optional.

Open design question:

- does this belong as:
  - richer `accounts` state,
  - a separate counterparty registry,
  - or a narrower address-classification seam?

Current lean:

- start from `accounts` and related address classification
- avoid inventing a whole new screen unless the workflow truly needs it

### 2. Provider Data Visibility

The CLI currently makes hard investigations too inference-heavy.

We need a way to inspect provider/source data for one transaction.

Working bias:

- add this to `transactions view`
- likely as an explicit option such as:
  - `transactions view <TX-REF> --provider-data`
  - or `transactions view <TX-REF> --source`

Do not create a separate provider-data screen unless the current transaction
view cannot hold it cleanly.

### 3. Grouped and Paired Review

Two live classes now justify non-row-shaped review:

- bridge-like pairs
- receive-then-forward patterns

Open question:

- can `links gaps view/explore` be rewritten to show pair/group context cleanly,
  or do we need one narrow grouped review entrypoint?

Strong default:

- rewrite `links gaps` first
- only add a new review command if the pair/group workflow becomes awkward or
  overloaded there

### 4. Repetitive Gap Exceptions

Some patterns should not require repeated manual resolves forever:

- known external wallet routes
- one-way unsolicited receipts
- tiny dust deposits

Open question:

- do we need:
  - batch resolve by address or pattern,
  - stored classification that suppresses future rows,
  - or stronger linking policy that prevents those rows from surfacing at all?

### 5. Search and Related Context

The current CLI still makes it too hard to answer:

- where else did this address appear?
- what other gaps involve this counterparty?
- what nearby transactions share this route?

This likely belongs in:

- better search/filter on `transactions`
- better related-context blocks in `links gaps view`

not in a separate search family.

## Evidence Already Established

The investigation log already proved:

- tiny one-way deposits should not become permanent transfer-gap debt
- bridge-like pairs are still a real command-surface gap
- receive-then-forward patterns need better grouping and guidance
- account and address search in the CLI is still too weak for this kind of
  investigation
- a first-class "known external wallet" concept would have prevented the family
  wallet misclassification churn

## Preferred Rewrite Direction

### Rewrite `transactions view`

Add enough depth that one command can answer:

- what the processor/provider said
- how the transaction was materialized
- who the endpoints appear to be
- which nearby related transactions or gaps matter

### Rewrite `links gaps view`

Make it capable of:

- address-level context
- pair/group context
- stronger next-step guidance
- showing when a gap is likely:
  - external-wallet route
  - bridge candidate
  - one-way receipt
  - dust/noise

### Rewrite `accounts`

Make it clearer how to say:

- this is mine
- this is not mine
- this is known, but external

without forcing a mistaken import as an owned account.

## Strong Cases That Might Justify New Commands

These are the only cases that currently look strong enough to earn a new
surface if rewriting the existing one becomes too awkward:

1. paired bridge review as one explicit workflow
2. batch gap resolution by address/pattern

Everything else should try to land inside existing surfaces first.

## Planned Phase 0 Passes

### Pass 1: Surface Inventory

- map every investigation step that currently requires command-hopping
- classify whether it belongs to `issues`, `links gaps`, `transactions`, or
  `accounts`

### Pass 2: Wallet Classification Model

- decide the right CLI owner for:
  - owned
  - known external
  - unknown

### Pass 3: Transaction Evidence and Related-Context Model

- decide how provider/source data should appear in `transactions view`
- decide whether related-gap and related-transaction context also belongs there
- decide where address/account search should live without creating a separate
  search family

### Pass 4: Grouped Review Shape

- evaluate whether `links gaps` can cleanly absorb:
  - bridge pairs
  - receive-then-forward groups
  - repeated-address review

### Pass 5: Batch and Policy Boundary

- decide which repeated manual resolutions should become:
  - batch actions
  - stored classifications
  - linking-policy suppression
- decide how the CLI should prevent permanent queue debt for cases that are:
  - tiny one-way deposits
  - repeated one-way receipts
  - known external-wallet routes

### Pass 6: Synthesis and Ranked Delivery Order

- combine the Phase 0 decisions into one ranked implementation order
- state which rewrites happen first inside:
  - `accounts`
  - `transactions view`
  - `links gaps`
- state explicitly which concerns still justify a new command, if any

## Acceptance Criteria

This Phase 0 is complete when:

1. We have a clear decision on whether "known external wallet" is a first-class
   concept and where it lives.
2. We have a decided home for provider/source data inspection.
3. We know which grouped-review problems can be absorbed by rewriting existing
   surfaces and which ones truly require a new command.
4. We have a clear decision on where search and related-context inspection
   belongs.
5. We have a ranked implementation order for the redesign.
6. We can resume live issue resolution with less repetitive guesswork than the
   current workflow.
