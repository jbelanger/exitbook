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

## Pass Results

### Pass 1: Surface Inventory

Findings:

- `issues` is correctly acting as the work queue and route surface. It should
  not absorb more investigation depth.
- the live command-hopping burden lands in three places:
  - `transactions`: exact inspection and related-context lookup
  - `links gaps`: transfer-gap review and no-link exception workflow
  - `accounts`: wallet-boundary and ownership decisions
- the highest-confidence missing capabilities are not new screens:
  - address/account search
  - richer related-context blocks
  - repeated-pattern guidance inside existing detail views

Decision:

- keep the redesign inside `accounts`, `transactions`, and `links gaps`
- do not add a new top-level investigation family

### Pass 2: Wallet Classification Model

Findings:

- the current binary model is insufficient:
  - owned account
  - everything else
- the live family-wallet mistake proved we need a first-class distinction
  between:
  - owned
  - known external
  - unknown
- the current `Account` model is owned/importable by design:
  - provider
  - refresh
  - balance snapshot
  - sessions
- overloading `Account` rows to represent non-owned wallets would leak the
  wrong semantics into refresh, balances, and imports.

Decision:

- `known external wallet` should be a first-class concept
- the owning CLI family should still be `accounts`
- but it should **not** be stored as a normal `Account`
- the clean direction is:
  - keep `accounts` as the operator entrypoint
  - add a profile-owned wallet-classification record behind it
  - project `owned` / `known external` / `unknown` into `transactions` and
    `links gaps`

Implementation consequence:

- this is not a new screen problem
- it is a model and command-shape decision inside the `accounts` family

### Pass 3: Transaction Evidence and Related-Context Model

Findings:

- `transactions view` is already the best single-transaction inspection surface
- the easy wins are related-context and search, not raw provider payloads
- current transaction querying is still weak for investigation because it lacks
  address-centered lookup
- current transaction detail still makes the user hop to other commands to
  answer:
  - where else did this address appear?
  - which other gaps involve this route?
  - what same-hash siblings exist?
- provider/source data is desirable, but it is not yet a trivial read-path
  addition:
  - the current processed transaction schema does not carry a direct
    `raw_transaction_id`
  - the `transactions` family spec currently says browse reads processed
    transactions only

Decision:

- related-context inspection belongs in `transactions`
- address/account search also belongs in `transactions`, not in a separate
  search family
- provider/source data should still land in `transactions view`, but only after
  we add a trustworthy processed-to-raw provenance binding

Implementation consequence:

- address-centered filters and related-context blocks are ready now
- raw/provider evidence is a second-step design item, not the first rewrite

### Pass 4: Grouped Review Shape

Findings:

- the remaining hard transfer-gap cases are not row-shaped in human terms:
  - bridge-like pairs
  - receive-then-forward patterns
  - repeated-address clusters
- `links gaps` already owns the right workflow, and it now carries enough cue
  data to keep growing there:
  - counterpart transaction refs
  - same-hash context
  - endpoint ownership
- the current weakness is mutation shape, not command-family ownership

Decision:

- keep rewriting `links gaps`
- do not create a new top-level grouped review surface
- if we need pair/group actions later, they should be narrow additions under
  `links gaps`, not a separate family

Implementation consequence:

- grouped context belongs in `links gaps view/explore`
- pair/group mutation remains an open design discussion after the simpler
  rewrites land

### Pass 5: Batch and Policy Boundary

Findings:

- repeated manual gap resolution is not one problem; it splits into three
  different classes:
  - known external wallet routes
  - repeated unsolicited receipts
  - tiny dust deposits
- these do **not** all deserve the same answer:
  - known external wallet routes want stored classification plus batch backfill
  - unsolicited receipts likely want batch handling first and policy later
  - tiny dust deposits want linking-policy suppression, not permanent queue debt

Decision:

- do not solve every repetitive case with one generic batch feature
- separate the answers:
  - classification-backed batch resolution for known external wallets
  - explicit batch resolution for repeated operator-confirmed patterns
  - policy suppression for mechanical dust/noise cases

Implementation consequence:

- `links gaps` may earn a narrow batch action under the existing family
- dust suppression belongs to linking policy, not just CLI UX

### Pass 6: Synthesis and Ranked Delivery Order

Conclusion:

- no new top-level CLI investigation surface is justified
- the work should start with existing-surface rewrites that are already clean,
  then move to the model changes that still need discussion

## Ranked Implementation Order

### Completed Quick Wins

1. Strengthen address-centered search inside existing families.
   - done: address / from / to filters in `transactions`
   - done: `accounts view <selector>` and `accounts explore <selector>` now
     resolve exact owned account identifiers, not just account name/fingerprint
2. Rewrite `transactions view` to carry richer related context from existing
   processed data.
   - done: related gaps
   - done: same-hash siblings
   - done: other recent transactions involving the same endpoints
   - done: owned account matches for visible identifiers
3. Rewrite `links gaps view/explore` to consume the same related-context model
   more consistently.
   - done: static, JSON, and TUI gap detail now reuse the same related-context
     investigation model
   - still open: clearer grouped impact preview for bridge-like and
     receive-then-forward patterns

### After One Bounded Model Decision

4. Add wallet classification under `accounts`.
   - first-class `known external wallet`
   - stored as profile-owned classification, not as full `Account`
5. Project that classification into investigation surfaces.
   - replace the current binary `tracked` / `untracked` story with
     `owned` / `known external` / `unknown`
   - make `links gaps` and `transactions view` reflect that state directly
6. Add classification-backed batch resolution inside `links gaps`.
   - batch backfill existing gaps for one known external wallet
   - prevent repeated manual resolves for the same pattern

### Discussion-Heavy Work After The Above

7. Add provider/source data inspection to `transactions view`.
   - requires a trustworthy processed-to-raw provenance binding first
   - should not ship as fuzzy raw lookup
8. Decide whether bridge pairs and receive-then-forward groups need explicit
   pair/group actions under `links gaps`.
   - keep this inside `links gaps` if possible
   - only add a new subcommand if the rewrite becomes awkward
9. Move tiny dust and similar mechanical one-way receipts out of permanent
   operator debt.
   - likely linking-policy work, not just CLI work

## Immediate Discussion Topics

These are the items that still deserve explicit discussion before
implementation starts on them:

1. exact command shape for `accounts`-owned wallet classification
2. provenance-binding design for trustworthy provider/source evidence
3. mutation semantics for bridge-pair and receive-then-forward review

## Phase 0 Recommendation

Start implementation with the `Ready Now` rewrites.

Those give immediate operator value, reduce command-hopping, and do not depend
on unresolved model choices.

Only after those land should we take the three discussion-heavy items above,
because those are the places where the current codebase still has genuine model
and correctness questions.
