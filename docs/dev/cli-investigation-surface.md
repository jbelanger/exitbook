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
7. Wallet-boundary evidence should start from profiles and `accounts`, unless
   later work proves that boundary too narrow.
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
- low-value priced one-sided blockchain gaps now surface a `likely dust` cue
  instead of staying completely patternless
- same-wallet paired inflow/outflow patterns can now surface a `likely receive
then forward` cue with an exact counterpart transaction
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
- the family-wallet mistake proved we need better wallet-boundary evidence, but
  the cheapest useful route is:
  - owned by the active profile
  - belongs to another local profile
  - unknown
- normal `Account` rows are still the wrong persistence model for non-owned
  wallets inside the active profile

Decision:

- use cross-profile ownership evidence first
- the user action is:
  - create another profile
  - add/import those wallets there
- investigation surfaces should then project:
  - `owned`
  - `other profile`
  - `unknown`
- defer any broader `known external wallet` feature unless real pain remains
  after cross-profile evidence lands

What shipped:

- `transactions view` and `transactions explore` now project endpoint ownership
  as:
  - `owned`
  - `other-profile`
  - `unknown`
- `links gaps view` and `links gaps explore` now project the same ownership
  cues in transaction snapshots
- the implementation uses local profile/account data only; it does not create a
  new counterparty registry or account-like external model

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
- cross-profile ownership evidence is the cheapest route to prevent the
  family-wallet misclassification churn in the current database scenarios

## What Is Not Justified

These ideas were considered and rejected for now:

- a new top-level CLI investigation family
- a separate provider-data screen
- treating external wallets as normal owned accounts inside the active profile
- parsing provider payloads into custom CLI interpretations

## Remaining Work

### Next bounded model decision

1. Use cross-profile ownership evidence to resolve the current repeated gap
   cases through the CLI.
   - a cross-profile route is enough to treat the wallet as not owned by the
     active profile
   - broader external-wallet modeling stays deferred unless gaps remain hard

### Discussion-heavy work after that

2. Decide whether bridge pairs and receive-then-forward groups need explicit
   pair/group actions under `links gaps`.
   - keep this inside `links gaps` if possible
   - only add a new subcommand if the rewrite becomes awkward

3. Move tiny dust and similar mechanical one-way receipts out of permanent
   operator debt.
   - likely linking-policy work, not just CLI work

## Immediate Discussion Topics

These are the remaining decisions that still deserve explicit discussion before
implementation:

1. Mutation semantics for bridge-pair and receive-then-forward review
2. Suppression policy for tiny dust and similar mechanical one-way receipts
