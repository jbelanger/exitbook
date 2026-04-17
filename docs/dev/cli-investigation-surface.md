---
last_verified: 2026-04-17
status: active
---

# CLI Investigation Surface

Owner: Codex + Joel

Primary references:

- [links-view-spec.md](/Users/joel/Dev/exitbook/docs/specs/cli/links/links-view-spec.md)
- [transactions-view-spec.md](/Users/joel/Dev/exitbook/docs/specs/cli/transactions/transactions-view-spec.md)
- [issues-view-spec.md](/Users/joel/Dev/exitbook/docs/specs/cli/issues/issues-view-spec.md)
- [cli-surface-v3-tracker.md](/Users/joel/Dev/exitbook/docs/dev/cli-surface-v3-tracker.md)

## Goal

Keep real issue resolution possible through the shipped CLI without repetitive
guesswork, while rewriting existing surfaces instead of inventing unnecessary
new ones.

## Why This Exists

Live CLI issue investigation established two things:

1. The command surface is already strong enough to solve obvious cases.
2. The remaining queue is now dominated by workflow-shape problems, not missing
   syntax.

The main friction is no longer:

- which command do I run?

It is now:

- how do I classify this counterparty cleanly?
- how do I inspect the exact evidence without bouncing between commands?
- how do I handle repeated patterns without resolving rows one by one?

## Durable Rules

1. Prefer rewriting existing surfaces over adding new screens.
2. `issues` is the work queue and routing surface, not the forensic surface.
3. `links gaps` owns transfer-gap review and gap exceptions, even when the
   eventual workflow becomes pair- or group-shaped.
4. `transactions view` is the deepest single-transaction inspection surface.
5. Provider/source evidence must be viewable from the CLI.
6. Do not parse provider payloads into ad-hoc summaries. Show a full dump or
   nothing.
7. Wallet-boundary classification should start from `accounts`, unless later
   work proves that boundary too narrow.
8. No new top-level CLI investigation family is justified today.

## Decisions

### `issues`

Role:

- work queue
- route into the owning workflow

Decision:

- keep it lean
- do not turn `issues view` into the full investigation surface

### `transactions`

Role:

- best single-transaction investigation surface

What shipped:

- address-centered filters: `--address`, `--from`, `--to`
- richer related context on selector detail:
  - owned account matches
  - open gap refs
  - same-hash sibling transactions
  - nearby transactions sharing the same endpoints
- source evidence on selector detail:
  - lightweight source lineage by default
  - full raw payload dumps behind `--source-data`

Decision:

- keep transaction evidence, related context, and address-centered lookup in
  `transactions`
- do not create a separate provider-data or investigation screen

### `links gaps`

Role:

- transfer-gap review
- explicit no-link / gap-exception workflow

What shipped:

- clearer gap-specific language instead of generic queue language
- better transaction snapshot and related context in static, JSON, and TUI
- same-hash context and counterpart transaction cues for bridge-like patterns
- exact proposal refs when they are derivable
- immediate profile-issue refresh after profile-owned corrective actions

Decision:

- keep rewriting `links gaps`
- do not create a new top-level grouped review family
- if pair/group actions are needed later, they should be narrow additions under
  `links gaps`

### `accounts`

Role:

- owned-account management

What we learned:

- the binary model is insufficient:
  - owned
  - everything else
- the family-wallet mistake proved we need a first-class distinction between:
  - owned
  - known external
  - unknown
- normal `Account` rows are the wrong persistence model for non-owned wallets

Decision:

- `known external wallet` should become a first-class concept
- the owning command family should still be `accounts`
- it should not be stored as a normal `Account`

## What This Work Unlocked

The shipped rewrites already improved real CLI-only investigation materially:

- obvious asset-review blockers can be resolved without command guessing
- obvious transfer gaps can be resolved through the CLI with immediate issue
  refresh
- transaction detail can now answer:
  - what related gaps matter?
  - what same-hash siblings exist?
  - which owned accounts match the visible endpoints?
  - what raw lineage exists for this processed transaction?
- `links gaps view` is now strong enough to investigate one gap without
  constant hopping to unrelated commands

In short:

- real issue resolution can continue through the CLI
- the remaining problems are now mostly product/workflow design problems, not
  missing debugging access

## Proven Patterns From Live Use

These conclusions are now strong enough to treat as real design input:

- tiny one-way deposits should not become permanent transfer-gap debt
- bridge-like pairs are still a real command-surface gap
- receive-then-forward patterns need better grouping and guidance
- account/address search was a real weakness and is now better, but repeated
  route investigation is still not smooth enough
- a first-class known-external-wallet concept would have prevented the
  family-wallet misclassification churn

## What Is Not Justified

These ideas were considered and rejected for now:

- a new top-level CLI investigation family
- a separate provider-data screen
- treating known external wallets as normal owned accounts
- parsing provider payloads into custom CLI interpretations

## Remaining Work

### Next bounded model decision

1. Add wallet classification under `accounts`.
   - first-class `known external wallet`
   - stored as a profile-owned classification, not as a full `Account`

2. Project that classification into investigation surfaces.
   - replace the current binary `tracked` / `untracked` story with:
     - `owned`
     - `known external`
     - `unknown`

3. Add classification-backed batch resolution inside `links gaps`.
   - batch backfill existing gaps for one known external wallet
   - prevent repeated manual resolves for the same pattern

### Discussion-heavy work after that

4. Decide whether bridge pairs and receive-then-forward groups need explicit
   pair/group actions under `links gaps`.
   - keep this inside `links gaps` if possible
   - only add a new subcommand if the rewrite becomes awkward

5. Move tiny dust and similar mechanical one-way receipts out of permanent
   operator debt.
   - likely linking-policy work, not just CLI work

## Immediate Discussion Topics

These are the remaining decisions that still deserve explicit discussion before
implementation:

1. Exact command shape for `accounts`-owned wallet classification
2. Mutation semantics for bridge-pair and receive-then-forward review
3. Suppression policy for tiny dust and similar mechanical one-way receipts
