---
last_verified: 2026-04-13
status: reference
---

# Accounting Issue Operations Plan

Owner: Codex + Joel
Related plans:

- [movement-semantics-implementation-plan.md](/Users/joel/Dev/exitbook/docs/dev/movement-semantics-implementation-plan.md)
- [linking-pattern-investigation-plan.md](/Users/joel/Dev/exitbook/docs/dev/linking-pattern-investigation-plan.md)
- [accounting-issue-implementation-plan.md](/Users/joel/Dev/exitbook/docs/dev/accounting-issue-implementation-plan.md)

## Goal

Design the operator-facing CLI workflow for accounting issues that the system cannot resolve deterministically.

This plan is intentionally not a solution doc yet.

It exists to:

1. inventory the user-facing operations we actually need
2. keep those operations separate from processor/linker heuristics
3. give us a clean basis for later phase-based implementation

Current document mode:

- frozen discovery log
- superseded as the primary execution tracker by [accounting-issue-implementation-plan.md](/Users/joel/Dev/exitbook/docs/dev/accounting-issue-implementation-plan.md)
- concrete Phase 1A domain/storage rules now live in [accounting-issues.md](/Users/joel/Dev/exitbook/docs/specs/accounting-issues.md)
- concrete Phase 1A CLI read-surface rules now live in [issues-view-spec.md](/Users/joel/Dev/exitbook/docs/specs/cli/issues/issues-view-spec.md)
- no longer authoritative for current phase execution
- finding numbers are historical and intentionally non-contiguous after refactors

Once the direction stabilizes, this doc should be rewritten into a shorter execution-oriented plan that keeps only:

- decisions
- chosen model boundaries
- phase order
- open follow-up questions that still block implementation

## Current Stable Decisions

These are the current conclusions that now look stable enough to design around.

- The correct direction is a persisted **issue projection**, not only an ad hoc derived read view.
- Canonical issue identity must stay **derived by family**. Persisted rows are not the source of truth.
- The persisted model should distinguish:
  - **scope rows** for overview/readiness
  - **issue rows** for the current and historical work queue
- Phase 1A should use one lifecycle table for both open and closed issue rows.
- Review-only issue actions should be durable, but separate from domain-changing overrides.
- Domain-changing accounting corrections must stay in **narrow domain override families**, not a generic issue action system.
- Bare `issues` should behave like an **overview/work queue**, not only a flat list.
- The domain model must keep **scope** explicit:
  - `profile`
  - `cost-basis`
- Acknowledged blockers must **not** make a scope appear ready.

## Current Open Design Questions

These still need an explicit decision before the doc becomes an implementation plan.

- What is the cleanest read seam for discovering known scoped accounting lenses?
- How much scoped-lens freshness and staleness detail should bare `issues` show in Phase 1A?

## Chosen Phase Strategy

These decisions are now strong enough to treat as the working implementation direction.

### Phase Order

1. **Phase 1A: profile-global issue projection**
   - persisted scope rows
   - persisted issue occurrence rows
   - profile-global issue families only:
     - transfer gaps
     - asset-review blockers
   - `issues` overview and current profile issue reading
2. **Phase 1B: scoped cost-basis issue projection**
   - add scoped cost-basis lens materialization
   - add tax-readiness issue rows on the same persisted model
   - make known scoped lenses discoverable from the `issues` overview
3. **Phase 2: issue review-state actions**
   - `acknowledge`
   - `reopen` acknowledgement
   - durable review-state persistence shape, chosen in that phase
4. **Phase 3+: domain corrective actions**
   - grouped transfer confirmation
   - explained residual declaration
   - movement-role override
   - other family-specific corrections

### Chosen CLI Lean

The current best-fit CLI direction is:

- `issues`
  - overview / work queue
- `issues view <ISSUE-REF>`
  - current issue detail
- `issues cost-basis ...`
  - scoped cost-basis lens entry and browsing

Reason:

- bare `issues` stays simple
- scoped accounting remains explicit
- we avoid pushing the read model back into `cost-basis`
- we avoid a flag-heavy entry path for the default operator flow

## Why This Exists

Recent work improved the system truth path:

- deterministic `movementRole`
- exact explained residual handling
- cleaner transfer validation
- cleaner tax/portfolio alignment

What is still missing is the operator path.

Today, when accounting still reports a real issue, the user often has no good corrective action besides:

- changing code
- reprocessing after a code change
- or hiding a review row without changing the underlying accounting state

That is not acceptable as the long-term UX.

## Operator Job Story

The target user mindset is not:

- "I want to browse a taxonomy of accounting issue families."

It is:

- "I need correct accounting and tax reporting."
- "Show me what is left to fix."
- "Tell me how to fix it."
- "Let me make progress without guessing."
- "When I am done, the system should clearly tell me I am done."

The intended operator flow is closer to:

1. open the issue overview
2. see what is blocking trustworthy accounting right now
3. understand which issues are actionable vs informational
4. take the next recommended action without hunting for the right command family
5. return to the overview and see the remaining count go down
6. finish the remaining issues for the relevant accounting scope
7. get a clear "ready" outcome and proceed to the final reporting command

This matters because a technically correct issue surface can still fail the user if it behaves like:

- a bag of unrelated issues
- a collection of low-signal warnings
- or a command tree that requires too much prior model knowledge

The real UX bar is:

- issue handling must feel like progressing toward a completed accounting/reporting outcome

not merely:

- inspecting one more diagnostics surface

## Non-Negotiable Rules

1. Deterministic system fixes still come first.
2. User actions must be typed, auditable, and reversible.
3. No free-form notes as machine state.
4. No user action may silently rewrite raw transaction amounts or fake provenance.
5. Every corrective action must validate against current movement identity and semantics.
6. If the system cannot support a correction safely, the issue must remain review-only.
7. Final implementation must land in canonical specs, not remain in `docs/dev`.

## Working Concepts

These names are provisional and may change after design review.

- `AccountingIssue`
- `AccountingOverride`

The point is the separation, not the exact names:

- an issue is something the system surfaced
- an override is a typed user assertion that changes how accounting interprets it

## Surfaces That Need One Review Language

The same operator should not have to learn a different correction model for each surface.

Current surfaces that report accounting problems:

- `links gaps`
- `cost-basis` failures
- `portfolio` failures
- tax export / readiness blockers
- transaction-level diagnostics that imply accounting uncertainty

## Design Rule Before Any Command Work

We should not start with write commands.

The first thing the operator needs is a trustworthy read path:

- what the issue is
- which transactions and movements are involved
- what evidence the system already has
- what corrective actions are even allowed
- what the accounting impact of each action would be

So the first implementation phase will almost certainly need to be read-only issue surfacing, not mutation.

## Outcome Requirements

Whatever CLI surface we design must support these user-facing outcomes.

### Requirement 1: The User Must Be Able To See Remaining Work Clearly

The overview must answer:

- how many actionable issues are left
- which accounting/reporting scope they affect
- which ones are the next best candidates to fix

The user should be able to say:

- "I only have 3 left"

without manually reconciling:

- gaps
- asset blockers
- readiness warnings
- and execution state

### Requirement 2: Every Actionable Issue Must Carry Clear Handling Guidance

The user should not need to infer:

- which command family owns the fix
- whether the issue is review-only or accounting-changing
- whether the system already has a suggested action

For every actionable issue, the surface should make clear:

- what the issue means
- what the allowed next action is
- where that action lives
- what outcome that action is expected to change

### Requirement 3: Completion Must Be Visible

The system should make a clear distinction between:

- unresolved work
- known but non-blocking information
- and "ready" status

If a user has addressed all blocking issues for a relevant accounting scope, the surface should make it obvious that:

- the scope is ready
- and the user can now run the reporting/export command with confidence

### Requirement 4: The UX Must Prefer Progress Over Taxonomy

Category and scope filters are useful, but they should support progress, not replace it.

The user should first see:

- what matters now

and only then narrow into:

- one family
- one scope
- one issue

This means:

- overview first
- category/scope refinement second

not:

- taxonomy first
- progress reconstruction later

## User-Facing Operations To Investigate

### Read-Only Operations

These are prerequisites for every corrective action.

| Working operation       | Purpose                                                                   | Likely scope                | Why it is needed                                                                                | Open questions                                                                      |
| ----------------------- | ------------------------------------------------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `issues list`           | Show unresolved accounting issues from all relevant surfaces in one place | issue keys                  | Current problems are fragmented across `links gaps`, `portfolio`, and `cost-basis`              | Do we expose one unified issue list first, or thin adapters over existing surfaces? |
| `issues view`           | Show the full evidence for one issue                                      | one issue                   | The operator must see movements, diagnostics, links, and residual math before changing anything | What is the canonical issue payload?                                                |
| `issues explain`        | Show why the system reached its current conclusion                        | one issue                   | Needed for trust and for later preview/diff UX                                                  | Is this a separate command or part of `view`?                                       |
| `issues preview-action` | Show the accounting effect of a candidate action before persistence       | one issue + proposed action | Prevents blind writes and lowers rollback pressure                                              | Do we need explicit preview commands, or should every write path preview first?     |
| `issues history`        | Show prior overrides, reversals, and replays for one issue                | issue or override id        | Auditability is mandatory once accounting changes are user-driven                               | Do we need this in phase 1 or later?                                                |

Current disposition:

- `issues explain` is folded into `issues view` for the current plan
- `issues preview-action` is deferred until direct corrective actions exist
- `issues history` is deferred until later review-state / history phases

### Corrective Operations

These are the missing write paths we need to investigate.

| Working operation                  | User assertion                                                                                      | Likely scope                    | Primary use case                                                                    | Why current UX is insufficient                                                               | Key open questions                                                                                          |
| ---------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `confirm_grouped_transfer`         | These source movements and target movements form one real transfer, even if the shape is N:1 or 1:N | selected movement set           | batched deposits, grouped sends, partial target matching                            | `links create` is still exact 1:1 and cannot express grouped transfer intent                 | How do we select movement groups safely? Do we allow partial quantities, or only exact movement selections? |
| `declare_explained_residual`       | This exact unmatched quantity on a target is real, non-transfer, and of a specific role             | one target movement residual    | Cardano-style staking residuals when system detection misses                        | The system can now consume exact explained residuals, but the user has no way to supply one  | Which roles are allowed? Must the amount be exact? Does this hang off a link group or stand alone?          |
| `override_movement_role`           | This movement should carry a different generic role                                                 | one movement fingerprint        | missed staking reward, refund, protocol overhead, non-principal leg                 | Today the only fallback is processor code changes                                            | Do we allow `principal_transfer` overrides, or only non-principal roles?                                    |
| `exclude_from_transfer_matching`   | This movement or transaction must not participate in transfer matching                              | one movement or transaction     | ambiguous setup legs, non-transfer inflows/outflows that still look transfer-shaped | Current fallback is usually issue dismissal, which does not always change matching semantics | Is this redundant once `override_movement_role` exists?                                                     |
| `acknowledge_issue`                | This issue is understood and does not require an accounting-state change                            | issue key                       | non-actionable but known review items                                               | Current `resolve` flows are too tied to one feature surface                                  | Is acknowledgement purely review state, or does it affect warnings/output?                                  |
| `reopen_issue` / `revoke_override` | Undo a prior user assertion                                                                         | issue or override id            | operator mistakes, changed semantics after reprocess                                | Reversibility must be first-class, not ad hoc                                                | Do we reverse by issue key, override id, or both?                                                           |
| `attach_user_note`                 | Add human context without changing machine interpretation                                           | issue, transaction, or movement | analyst context, audit trail, handoff notes                                         | User notes exist, but not yet as a coherent accounting-issue workflow                        | Which scope is canonical for operator notes?                                                                |

## Operations We Should Avoid Unless Forced

These are tempting, but they are likely too blunt or too dangerous.

| Candidate operation                                       | Why it is risky                                                                                          |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `fix_transaction_amounts`                                 | Rewrites truth instead of interpretation                                                                 |
| `mark_as_spam` as a free-form transaction toggle          | Too broad unless it is modeled as a typed diagnostic override with clear downstream rules                |
| generic `issues fix`                                      | Hides important differences between transfer confirmation, semantic override, and review acknowledgement |
| synthetic transaction creation as the default user action | Too easy to abuse when the real need is interpretation, not raw data invention                           |

## Investigation Order

We should investigate operations in the same order the operator would need them.

1. Read-only issue inventory and evidence view
2. Grouped transfer confirmation
3. Exact explained residual declaration
4. Movement-role override
5. Review-only acknowledgement and history
6. Reopen / revoke flows

This order keeps us away from building write commands before we have a stable issue model.

## Questions We Need To Answer Before Phasing

1. What is the canonical issue identity across `links gaps`, `portfolio`, and `cost-basis`?
2. Are issue keys purely derived, or do some issue types need persisted identity?
3. Which corrective actions change accounting truth, and which only change review state?
4. Which actions should be movement-scoped versus issue-scoped?
5. Do we store one generic `AccountingOverride` stream, or separate typed override families?
6. Which actions must preview a diff before confirmation?
7. Which actions are allowed only when the user supplies exact quantities and exact selected movements?
8. Should unresolved asset review appear as first-class issue rows, or as routed blockers that stay owned by `assets`?
9. Are latest failure snapshots first-class issues, supporting evidence, or a separate execution-failure family?
10. Is a future top-level `issues` command allowed to aggregate only read paths at first, while writes remain domain-native?
11. If bare `issues` should show "all issues", how does it discover which cost-basis scopes are relevant without forcing the user to supply flags first?

## Current Surface Inventory

This section records what the codebase actually exposes today, before we design anything new.

### Surface 1: `links gaps`

Current state:

- owned by the accounting/linking gap analysis path
- issue identity is already explicit and derived:
  - `txFingerprint + assetId + direction`
  - see [gap-model.ts](/Users/joel/Dev/exitbook/packages/accounting/src/linking/gaps/gap-model.ts)
- read path exists:
  - list
  - detail
  - JSON browse output
- review-only mutation exists:
  - `resolve`
  - `reopen`
  - override-backed latest-event-wins replay
  - see [links-gap-resolution-handler.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/links/command/gaps/links-gap-resolution-handler.ts)
  - and [link-gap-resolution-replay.ts](/Users/joel/Dev/exitbook/packages/data/src/overrides/link-gap-resolution-replay.ts)

Strengths:

- clean derived issue key
- clean replay model
- good example of issue-scoped review state that does not mutate accounting truth

Limitations:

- it is still a transfer-gap surface, not a general accounting-issue surface
- `resolve` and `reopen` are review-state actions only
- it already carries more accounting review burden than it should

### Surface 2: tax-package export / readiness

Current state:

- this is the richest typed issue model in the repo today
- issue shape already exists in [tax-package-types.ts](/Users/joel/Dev/exitbook/packages/accounting/src/cost-basis/export/tax-package-types.ts):
  - `code`
  - `severity`
  - `summary`
  - `details`
  - `affectedArtifact`
  - `affectedRowRef`
  - `recommendedAction`
- readiness metadata also carries typed per-row details for some cases:
  - unknown classification
  - uncertain proceeds allocation
  - incomplete transfer linking
  - see [tax-package-readiness-metadata.ts](/Users/joel/Dev/exitbook/packages/accounting/src/cost-basis/export/tax-package-readiness-metadata.ts)
- review gate converts those into typed issues in [tax-package-review-gate.ts](/Users/joel/Dev/exitbook/packages/accounting/src/cost-basis/export/tax-package-review-gate.ts)

Strengths:

- typed issue codes already exist
- affected row refs already exist
- recommended actions already exist
- best current example of an accounting issue contract

Limitations:

- currently framed around export readiness, not interactive review
- some issue identity is still row-ref-centric, not clearly canonical across consumers
- interactive `cost-basis` does not reuse this shape directly

### Surface 3: interactive `cost-basis`

Current state:

- interactive and JSON `cost-basis` do not expose full tax-package issue rows
- they now narrow into `CostBasisIssueNotice` in [cost-basis-issue-notices.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/cost-basis/cost-basis-issue-notices.ts)
- current warning shape is much smaller:
  - `code`
  - `severity`
  - `count`
  - optional single `detail`
  - optional `recommendedAction`
  - optional `commandHint`

Strengths:

- already user-facing
- already attaches command hints in some cases

Limitations:

- lossy compared with the richer tax-package issue model
- currently supports only a narrow subset of issue codes
- does not preserve per-issue identity or affected row refs cleanly

### Surface 4: `portfolio`

Current state:

- successful portfolio output exposes only `warnings: string[]`
- failures persist a latest-only failure snapshot keyed by `(scopeKey, consumer)`
- see [portfolio-handler.ts](/Users/joel/Dev/exitbook/packages/accounting/src/portfolio/portfolio-handler.ts)
- failure snapshot persistence exists in [failure-snapshot-service.ts](/Users/joel/Dev/exitbook/packages/accounting/src/cost-basis/artifacts/failure-snapshot-service.ts)
- persistence exists in [cost-basis-failure-snapshot-repository.ts](/Users/joel/Dev/exitbook/packages/data/src/repositories/cost-basis-failure-snapshot-repository.ts)

Strengths:

- failures are at least durably recorded
- snapshot captures scope, consumer, dependency watermark, and error payload

Limitations:

- there is no typed interactive issue model
- warnings are plain strings
- failure snapshots are effectively write-only today:
  - replace
  - count
  - delete
  - but no read-side query contract for operator inspection

### Surface 5: transaction diagnostics

Current state:

- transactions can render diagnostics and user notes cleanly
- see [transaction-view-projection.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/transactions/transaction-view-projection.ts)
- diagnostics are attached to the transaction detail surface, not promoted into issue objects

Strengths:

- good evidence surface
- already separated from user notes

Limitations:

- diagnostics do not have a first-class issue identity
- current identity is effectively only:
  - transaction fingerprint
  - diagnostic code
  - maybe metadata
- there is no replay/action model tied directly to diagnostics

## Selector And Identity Findings

### Existing CLI Ref Patterns

Current browse surfaces already follow a consistent ref pattern:

- `TX-REF` for transaction fingerprint prefixes
  - see [transaction-selector.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/transactions/transaction-selector.ts)
- `LINK-REF` for proposal-group selectors
  - see [link-selector.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/links/link-selector.ts)
- `GAP-REF` for derived link-gap issue selectors
  - see [link-selector.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/links/link-selector.ts)

This is useful because it means a future accounting-issues CLI does not need a brand-new selector philosophy.

### Likely Direction

The current evidence suggests:

- individual evidence surfaces should keep their own refs:
  - `TX-REF`
  - `GAP-REF`
  - existing link refs
- a unified issue surface should likely get its own top-level selector:
  - working name: `ISSUE-REF`

Why:

- an accounting issue may aggregate multiple transactions or one transaction plus diagnostics plus link state
- overloading `TX-REF` or `GAP-REF` as the primary issue selector would blur issue identity with one piece of evidence

This is not a final decision yet, but it is the cleanest current direction.

## Analysis Findings

### Finding 1: We Already Have Two Good Building Blocks, Not Zero

The repo is not missing all the pieces.

The best current building blocks are:

- `links gaps` for derived issue identity plus review-state replay
- tax-package issues for typed issue payloads and recommended actions

The new accounting-issue surface should start by reusing those ideas, not replacing them.

### Finding 2: `cost-basis` Interactive Is Currently Lossy

The interactive `cost-basis` surface throws away detail that the tax-package path already knows.

That means a future `issues list` should not be based on current `CostBasisIssueNotice` as the canonical model.

It is useful as a presentation shape, but too lossy as a domain issue contract.

### Finding 3: `portfolio` Is The Weakest Current Surface

`portfolio` has:

- string warnings on success
- persisted failure snapshots on failure

but no typed issue model in between.

This makes it the worst current source for an operator workflow, and it is the strongest argument for a new read-only issue projection.

### Finding 4: Failure Snapshots Need A Read Contract Before They Can Join A Unified Issue Surface

Failure snapshots are persisted, but there is no query/read model for them yet.

So if we want `portfolio` and `cost-basis` failures to appear in a future issue list, we first need:

- a read port
- a projection shape
- and likely a deliberate choice about whether latest failure snapshots are issue rows, supporting evidence, or both

### Finding 5: Diagnostics Are Better Treated As Evidence Than As Standalone Issues

At least with the current model, transaction diagnostics look more like:

- issue evidence
- or issue context hints

than like the canonical issue object itself.

That is especially true because diagnostics do not yet have durable standalone identity.

### Finding 6: A Single Generic `AccountingOverride` Stream Is Probably Too Abstract Too Early

Current override design is narrow, typed, and scope-specific in [override.ts](/Users/joel/Dev/exitbook/packages/core/src/override/override.ts).

That argues for:

- one shared issue read model
- but likely separate typed override families for materially different actions

rather than one giant generic override payload from the start.

### Finding 7: A Unified Read Model Is More Urgent Than A Unified Write Model

The repo already has enough local selector and identity conventions to support a coherent read path.

It does **not** yet have enough clarity to safely unify writes under one override abstraction.

So the first CLI phase should standardize:

- issue listing
- issue detail
- issue refs
- issue evidence rendering

before it standardizes write actions.

### Finding 8: `assets` Already Owns One Review Domain Well

Unresolved asset review is already:

- typed
- evidence-backed
- explicitly blocked for accounting
- and paired with clear commands:
  - `assets explore`
  - `assets confirm`
  - `assets exclude`

That makes it different from `portfolio` and interactive `cost-basis`, which barely expose issues at all.

The likely implication is:

- a future accounting-issue surface may list unresolved asset review as a blocker
- but the owning write workflow should probably remain in `assets`

So the new issue surface should unify **visibility** first, not absorb every existing review command.

### Finding 9: Failure Snapshots Look Like Execution-Failure Issues, Not Review Issues

Latest failure snapshots are:

- consumer-scoped
- latest-only
- and shaped around execution failure context rather than row-level accounting review

That means they likely belong in the same read surface, but not in the same family as:

- transfer gaps
- readiness blockers
- movement-interpretation issues

They probably need their own explicit family boundary, such as:

- `execution_failure`

otherwise the issue list will mix:

- things the user can correct by assertion
- and things the system failed to compute at all

That distinction matters for both copy and allowed actions.

### Finding 10: A New Unified Issue Surface Is Likely, But The Final Command Boundary Is Still Open

The analysis now points toward a unified read surface.

But it is still too early to lock the final CLI boundary as:

- top-level `issues`

because there are still two viable shapes:

1. a new top-level `issues` namespace for cross-surface issue reading
2. an accounting-focused namespace that later grows into a broader issue surface

What is clear already:

- the first phase wants one issue list and one issue detail path
- those paths need to aggregate across `links gaps`, readiness blockers, and execution failures
- existing write flows such as `assets confirm` should not be forcibly absorbed just to make the command tree look symmetrical

This was the earlier fork.

Current direction:

- the unified issue surface is now the chosen read-path direction
- the working CLI lean is top-level `issues` with scoped drill-in under the same namespace

### Finding 11: If It Becomes `issues`, It Must Behave Like A Real Browse Namespace

The CLI design language already distinguishes:

- goal commands
- domain namespaces with a default landing surface

If we create top-level `issues`, it cannot just be:

- a bucket of unrelated subcommands
- or a place where every unresolved problem in the product gets dumped

It would need to behave like a proper browse namespace:

- bare `issues` should be useful
- `issues list` and `issues view <issue-ref>` should be stable
- any future explorer path should still feel like the same domain object at greater depth

This raises the quality bar in a good way:

- if we cannot define one coherent issue object, we should not ship top-level `issues` yet
- if we can define one coherent issue object, a top-level browse namespace becomes justified

### Finding 12: Domain-Native `... issues` Subcommands Are A Real Alternative, But Not Symmetric Across The CLI

The alternative is:

- `links issues`
- `cost-basis issues`
- `portfolio issues`

instead of one cross-domain top-level surface.

This has real advantages:

- issue ownership stays near the domain workflow
- it avoids building a premature cross-product queue
- it is consistent with existing domain-specific review families like:
  - `links gaps`
  - `assets explore`

But the fit is uneven across current command types.

It fits naturally under noun namespaces:

- `links`
- `assets`

It fits less naturally under goal commands:

- `cost-basis`
- `portfolio`

because those commands are currently:

- outcome-oriented entry points
- not domain browse namespaces

`cost-basis export` already exists and proves goal commands can have subcommands.
But `cost-basis issues` and especially `portfolio issues` would still feel different from:

- bare `links`
- bare `assets`

and would likely create different mental models for the same underlying issue concept.

So this is a real option, but not a free consistency win.

## Command Boundary Alternatives

At this stage there are two serious CLI boundary options.

### Option A: Unified Read Surface

Working shape:

- `issues`
- `issues list`
- `issues view <issue-ref>`

Characteristics:

- one issue object
- one selector family
- one place to see cross-surface blockers
- domain-native write commands can still remain where they are

Strengths:

- best fit if the core problem is fragmented visibility
- cleanest path for `portfolio` and interactive `cost-basis`, which currently lack strong issue surfaces
- aligns with the idea that the operator is trying to answer one question:
  - what is blocking trustworthy accounting right now?

Risks:

- can become a dumping ground
- may compete with mature workflows like `assets`
- requires a coherent issue object before it deserves top-level status

### Option B: Domain-Native Issue Subcommands

Working shape:

- `links issues`
- `cost-basis issues`
- `portfolio issues`

Characteristics:

- issue reading stays attached to the owning command family
- correction flows stay close to the relevant domain

Strengths:

- ownership is obvious
- avoids forcing a single cross-domain queue too early
- easier to ship incrementally inside one domain

Risks:

- duplicates issue concepts across command families
- makes cross-surface accounting blockers harder to inspect in one place
- creates an awkward asymmetry between noun namespaces and goal commands
- may require the user to know where a problem belongs before they can even inspect it

## Current Lean

The current evidence suggests:

- Option A is stronger for the **read path**
- Option B is stronger for many **write paths**

That points toward a likely hybrid design:

- one unified read-only issue surface
- domain-native corrective actions where ownership is already clear

This is still provisional, but it currently fits the codebase better than either extreme:

- not one giant command that owns everything
- not a scattered set of unrelated `... issues` views with no shared issue identity

### Finding 13: Issue Identity Is Already Split Between Item-Backed Issues And Scope-Backed Issues

Current surfaces do not all identify issues at the same granularity.

Item-backed today:

- gap issues:
  - `txFingerprint + assetId + direction`
- tax readiness details with row refs:
  - unknown classification
  - uncertain proceeds allocation
  - incomplete transfer linking
- asset review blockers:
  - naturally keyed by `assetId`

Scope-backed today:

- missing price coverage:
  - only count-level metadata exists today
- unresolved asset review in tax-package export:
  - currently emitted as a count-level readiness issue, even though underlying asset rows exist
- latest failure snapshots:
  - keyed by `(scopeKey, consumer)`

This matters because a future issue surface should not pretend every issue is naturally one row per user-actionable unit.

The likely rule is:

- prefer item-backed issue rows when the codebase already knows the actionable unit
- keep scope-backed issue rows only when no finer-grained safe identity exists yet

### Finding 14: A Good Issue List Must Prefer Actionable Units Over Summary Counts

The current repo already shows one recurring problem:

- rich per-item data exists
- but some user-facing surfaces collapse it back into aggregate warning counts

Examples:

- interactive `cost-basis` now narrows scoped issue review into `CostBasisIssueNotice`
- tax-package export emits a single `UNRESOLVED_ASSET_REVIEW` issue row even though the actual actionable units are assets

If we build an issue list, it should not inherit that coarseness by default.

The likely rule for a future unified read model is:

- one issue row per actionable unit when that unit is already known
- summary rows only when the current system truly lacks safe per-item detail

That suggests:

- unresolved asset review should likely project as one issue row per blocked asset, not as one count row
- missing price coverage may remain summary-only until accounting exposes row-level missing-price detail

### Finding 15: Failure Snapshot Read Support Is A Deliberate Architecture Expansion

The current canonical storage spec explicitly lists this as a non-goal:

- a shared read API for failure snapshots

So bringing execution failures into a future issue surface is not just CLI work.

It is a deliberate architecture change that needs:

- a read port in accounting
- a repository read/query contract in data
- and a spec update in canonical docs

That is fine, but it means execution-failure issues should not quietly slip into an MVP if the read seam is not ready.

### Finding 16: A First Issue Surface Should Start As Static List + Static Detail

The CLI browse rules already give us a clean ladder:

- bare noun
- `list`
- `view <selector>`
- `explore`

If we build a new issue surface too early with a TUI explorer, we risk:

- designing interaction around an issue model that is still moving
- over-investing in explorer chrome before family boundaries settle
- and hiding unresolved projection ambiguity behind navigation polish

So the clean MVP shape is:

- static list
- static detail
- JSON parity for both

and only later, if the collection proves stable:

- `explore`

This applies especially if the first phase includes:

- routed asset-review blockers
- item-backed tax-readiness issues
- transfer gaps

because those are enough to justify a durable browse surface, but not yet enough to prove a shared explorer interaction model.

### Finding 21: Missing-Price Detail Exists Elsewhere, But Not On The Accounting Seam We Need

Accounting currently exposes only:

- `missingPricesCount`
- and, in soft-exclude flows, the retained transaction set after price validation

That is enough for:

- blocking tax export
- warning portfolio that unrealized P&L is incomplete

But it is not enough for a good item-backed issue row.

The repo does have richer missing-price inspection elsewhere:

- `prices view`
- movement-level price coverage and missing-price browse surfaces

But that is a different seam:

- price-coverage inspection
- not accounting-scoped issue projection

So the right current conclusion is:

- missing-price issues are feasible later
- but Phase 1 should not fake itemized rows from count-only accounting data

If we want item-backed missing-price issues later, we will likely need an explicit bridge from:

- accounting-scoped missing-price results

to:

- price-coverage movement detail and owning `prices` workflows

### Finding 22: Canonical Issue Identity Should Stay Derived Even If We Persist Issues

There are two different questions here:

1. what makes an issue the same issue?
2. should the system persist surfaced issues?

The canonical identity should still stay derived:

- each issue family defines its own canonical key
- `ISSUE-REF` is only a selector-friendly digest of that canonical family key

This is consistent with what already works elsewhere:

- `TX-REF` is derived from `txFingerprint`
- `GAP-REF` is derived from canonical gap identity

So even if we persist issue projections, the source of identity should remain:

- family-specific derived keys

not:

- opaque database ids

### Finding 23: Family-Specific Identity Inputs Are Better Than One Universal Key Recipe

The current likely derived keys are:

- `transfer_gap`
  - existing `buildLinkGapIssueKey(...)`
- `asset_review_blocker`
  - likely `assetId + evidenceFingerprint`
- `tax_readiness / UNKNOWN_TRANSACTION_CLASSIFICATION`
  - likely `code + txFingerprint`
- `tax_readiness / UNCERTAIN_PROCEEDS_ALLOCATION`
  - likely `code + txFingerprint`
- `tax_readiness / INCOMPLETE_TRANSFER_LINKING`
  - likely `code + rowId`

Important nuance:

- asset-review blocker identity should likely include `evidenceFingerprint`, not just `assetId`
  - otherwise changed evidence could silently inherit stale issue state later
- incomplete transfer linking should not use a presentation row number
  - current `rowId` appears to be a semantic transfer/report id, not a display index
  - that is acceptable if we keep verifying it stays deterministic

So the issue system should standardize:

- one selector format

but not:

- one universal identity recipe

### Finding 24: `ISSUE-REF` Should Be A Convenience Layer, Not Canonical Identity

The canonical identity should stay:

- family-specific
- verbose if needed
- stable enough for replay and diff reasoning

`ISSUE-REF` should then be:

- a short digest for CLI selection

This matters because the moment we try to make the short ref itself canonical, we lose:

- explainability
- family-specific validation
- and the ability to reconstruct the underlying issue key cleanly in code and tests

### Finding 24A: Persisted Issue Projection Now Looks Justified By The UX Goals

Earlier analysis leaned toward a purely derived Phase 1 read model.

That is no longer the best current fit for the UX goals.

If we want:

- a stable work queue
- remaining counts
- explicit resolved vs open state
- discoverable scoped accounting lenses
- and later history / acknowledgement without re-deriving everything ad hoc

then a persisted issue projection now looks justified.

Important boundary:

- persist issues as a projection/state model
- not as the canonical source of accounting truth

The underlying domain evidence still remains:

- transactions
- links
- asset review
- tax-readiness derivation
- failure snapshots

The issue layer should describe and track surfaced problems, not replace the underlying accounting model.

### Finding 24B: Producers Should Not Write Issue Rows Directly

The user intuition that "issue producers could just save them" is directionally useful, but the clean architecture is narrower.

We should avoid a model where:

- each producer writes arbitrary issue rows straight to persistence

That would create:

- duplicated write logic
- inconsistent lifecycle handling
- and host-level coordination smells

The cleaner shape is:

- producers derive issue sets in accounting
- one issue projection/orchestration layer persists the current set for a given scope

That keeps:

- identity rules
- lifecycle rules
- and status transitions

in one place.

### Finding 24C: Replace-By-Scope Persistence Is The Most Natural Fit

The issue families already cluster by scope:

- profile-global current-state issues
- cost-basis-scoped issues

So the natural persistence pattern is likely:

- derive the full current issue set for one scope
- replace the stored current set for that scope
- mark previously known but now-absent issues as closed/resolved by disappearance

This would make it much easier to support:

- "3 left"
- overview counts
- known-scope discovery
- and later issue history

without requiring each issue family to invent its own persistence semantics.

### Finding 24D: Persisted Issue Status Must Distinguish "Closed" From "Acknowledged"

If issues are persisted, one generic `resolved` status will be too fuzzy.

We need to keep separate concepts for at least:

- open current issue
- closed because the issue no longer appears in the current derived set

Otherwise the UX will blur together:

- "the underlying accounting problem is gone"
- and later, whether user review-state changed queue presentation

That distinction matters for both:

- progress counts
- and later audit/history views

Phase 1A simplification:

- Phase 1A only needs:
  - open
  - closed
- acknowledgement and richer closure semantics arrive later

### Finding 25: Asset-Review Identity Is Stronger Than It First Looked

`evidenceFingerprint` is not just a UI convenience.

It is already:

- canonical in the asset-review summary model
- derived from evidence plus reference status
- and part of existing asset-review replay semantics

That makes the likely asset-review issue key:

- `assetId + evidenceFingerprint`

a strong Phase 1 candidate.

This is good news because it means routed asset-review blocker rows can be:

- derived
- specific to the current evidence set
- and naturally invalidated when the evidence changes

without introducing new persistence.

### Finding 26: Incomplete-Transfer-Link Identity Looks Semantic, But Its Stability Is Family-Local

The current incomplete-transfer-link detail uses `rowId = transfer.id`.

For Canada transfer rows, that id is currently built from semantic transfer construction:

- `link:${linkId}:transfer` for paired linked transfers
- or a transfer event id for single-sided / unlinked transfer rows

That is much better than a display index.

But it is still a family-local identity, not a universal transaction identity.

So the safe current stance is:

- it is strong enough for a derived Phase 1 issue key
- but it should remain clearly owned by the `tax_readiness` family
- and we should avoid over-promising cross-workflow stability beyond that family until more evidence exists

### Finding 27: Summary Rows Can Be Shared More Easily Than Detail Payloads

The provisional Phase 1 summary item can stay reasonably flat:

- family
- code
- severity
- summary
- evidence refs
- route target

But detail starts diverging faster:

- gap issues want gap math and context hints
- asset review wants evidence rows and review/exclusion context
- tax readiness wants transaction-facing detail and family-specific reasons

That suggests a likely split:

- one shared summary row contract for list output
- one family-specific detail payload union for `view`

This matters because otherwise we will be tempted to overuse:

- `details: string`

as a dumping field for structure that should remain typed.

### Finding 28: Some Route Targets Will Be Purely Family-Level In Phase 1

Not every route target will have a precise selector on day one.

Examples:

- asset-review blocker can route very precisely to an asset selector
- transfer-gap issue can route precisely to `GAP-REF`
- incomplete transfer linking may initially route only to the `links` family or to issue detail guidance rather than to one exact `LINK-REF`

So the route model should allow:

- route family only
- or route family plus precise selector

That is another reason `routeTarget` should stay semantic instead of collapsing immediately into one command string.

### Finding 29: Phase 1 List Filters Should Probably Stay Minimal

If the first read-only issue surface ships, its filter model should likely stay narrow:

- family
- severity

Maybe later:

- source surface
- route target family

This follows the same discipline as the rest of the plan:

- get the issue object right first
- avoid overbuilding browse controls before the families are stable

### Finding 30: Issue Families Do Not All Live At The Same Scope

This is the first major constraint that can change the Phase 1 surface.

Profile-wide today:

- `transfer_gap`
- `asset_review_blocker`

Calculation-scope-dependent today:

- `tax_readiness`

Why this matters:

- link gaps are derived from the profile's current processed transactions and links
- asset review is derived from the profile's current processed transactions and review projection
- tax readiness depends on:
  - jurisdiction
  - method
  - tax year
  - date scope
  - and sometimes filing-scope rules such as full-year validation

So a unified issue list cannot safely pretend every issue family belongs to one profile-global queue.

### Finding 31: Tax-Readiness Inclusion Changes The Command Contract

If Phase 1 includes tax-readiness rows, the issue surface will need one of these designs:

1. explicit accounting-scope flags
   - like `--jurisdiction`, `--tax-year`, `--method`
2. a dependency on latest scope-specific artifact/readiness state
3. a clear family split where profile-global issues are available without scope, but tax-readiness requires entering a scoped mode

What we should avoid:

- silently showing tax-readiness issues for some implicit stale scope
- pretending tax-readiness is globally meaningful without telling the user which filing scope it came from

### Finding 32: This Strengthens The Case For A Hybrid Entry Strategy

Because of the scope split, the likely command story becomes:

- one shared issue projection model
- but possibly more than one entry path into it

Examples:

- profile-global issue view for:
  - gaps
  - asset-review blockers
- scope-aware issue view for:
  - tax-readiness rows

This does not kill the unified issue idea.

But it does mean the first CLI entry point may need to be more deliberate than just:

- `exitbook issues`

with no scope story.

### Finding 33: Scoped Tax-Readiness Is Also A Freshness And Execution Problem

Tax-readiness is not only different in identity scope.

It is also different in how the data is obtained.

To surface tax-readiness rows today, the system may need to:

- prepare priced consumer prerequisites
- read or rebuild a scope-specific cost-basis artifact
- derive readiness metadata from that workflow result

That is materially heavier than:

- reading current gap issues
- reading current asset-review blockers

So including tax-readiness in an issue surface is not just a filtering choice.

It is a product contract about whether the read path may:

- trigger or depend on cost-basis execution
- reuse latest scoped artifacts
- or require explicit freshness semantics

This strengthens the case that:

- profile-global issue reading and scoped tax-readiness reading may need to arrive in different phases, even if they share one eventual issue model

### Finding 34: `severity` Alone Probably Does Not Tell The User Enough

Current families affect different kinds of outcomes:

- gap issues affect transfer-review completeness
- asset-review blockers affect accounting eligibility
- tax-readiness issues affect filing/export confidence
- execution failures affect whether a result was computed at all

If we only expose:

- `severity`

the list may still be hard to scan because the user cannot quickly tell:

- what this issue is blocking

So the future read model may need an additional concept such as:

- `impactScope`
- or `affects`

Examples:

- `review`
- `accounting`
- `filing`
- `execution`

This should stay separate from `family`:

- `family` says what kind of issue it is
- `impact` says what user outcome it threatens

Phase 1A simplification:

- do **not** add a separate `impact` field yet
- current families already imply the affected outcome strongly enough
- if a later family breaks that mapping, add `impact` then

## Source-To-Issue Mapping

This is the current best mapping from existing surfaces into the provisional read-only issue model.

| Source                                         | Likely family          | Likely actionable unit                        | Evidence refs                    | Likely route target                          | MVP readiness              |
| ---------------------------------------------- | ---------------------- | --------------------------------------------- | -------------------------------- | -------------------------------------------- | -------------------------- |
| `links gaps`                                   | `transfer_gap`         | one gap issue                                 | `GAP-REF`, `TX-REF`              | `links gaps`                                 | ready now                  |
| tax readiness: unknown classification          | `tax_readiness`        | one transaction row                           | `TX-REF`                         | likely `transactions` or future issue detail | ready now                  |
| tax readiness: uncertain proceeds allocation   | `tax_readiness`        | one transaction row                           | `TX-REF`                         | likely `transactions` or future issue detail | ready now                  |
| tax readiness: incomplete transfer linking     | `tax_readiness`        | one transfer row                              | `TX-REF`, maybe `LINK-REF` later | `links`                                      | ready now                  |
| asset review blockers                          | `asset_review_blocker` | one blocked asset                             | asset selector / asset id        | `assets`                                     | ready now                  |
| missing price coverage                         | `tax_readiness`        | currently scope summary only                  | none yet                         | probably `prices` or issue detail            | not ready for itemized MVP |
| latest cost-basis / portfolio failure snapshot | `execution_failure`    | one latest failure per `(scopeKey, consumer)` | future failure-snapshot ref      | likely issue detail only                     | blocked on new read port   |

## First Read-Only Phase Lean

The fork is now closed.

The first read-only phase should be **profile-global first**, then scoped tax-readiness on the same model.

### Phase 1A Includes

- gap issues
- per-asset asset-review blockers, routed back to `assets`
- persisted issue scope rows for overview/readiness
- persisted issue occurrence rows for the current profile-global queue

### Phase 1A Defers

- tax-readiness issue rows until scoped entry is explicit
- missing price coverage until row-level detail exists
- latest execution failures until failure snapshots have a read port
- any explorer/TUI surface until the read model proves stable in static list/detail form

### Why This Is The Right First Cut

- it keeps the first overview honest
- it avoids hidden calculation-scope assumptions
- it gives us the real issue/work-queue seam before adding heavier scoped materialization
- it still leads cleanly into Phase 1B instead of forcing a separate model later

## Correct-Model Direction

The current analysis is strong enough to state the correct model direction and the current CLI lean.

### Finding 35: The Correct Domain Model Needs First-Class Issue Scope

The current family split is not an incidental CLI problem.

It is a real domain property:

- some accounting issues are profile-global current-state issues
- some accounting issues are calculation-scope issues tied to filing configuration and artifact freshness

So the correct model is not:

- one flat issue queue with implicit assumptions

It is:

- one accounting-owned issue projection
- plus an explicit issue-read scope in the request contract

Working shape:

- `profile` scope
  - current-state, profile-global issues
  - gaps
  - asset-review blockers
- `cost-basis` scope
  - filing/configuration-dependent issues
  - tax-readiness rows
  - later, possibly latest execution failures for the same scope

This keeps the issue model honest without forcing separate domain models for every surface.

### Finding 36: A Bare Unified `issues` Command Is Only Honest If Scope Entry Is Explicit

If we eventually ship a top-level issue surface, bare `issues` cannot silently mix:

- cheap current-state profile issues
- stale or implicit cost-basis readiness rows from some unknown scope

So one of these must be true:

1. bare `issues` shows only profile-global issues
2. bare `issues` requires explicit scope flags before scoped families appear
3. scoped families are entered through a distinct scoped path, even if they still reuse the same underlying issue model

This means the command-boundary question is downstream of the scope-model question, not the other way around.

### Finding 37: The Shared Issue Reader Should Take Scope As Input, Not Hide It Internally

The accounting-owned read model should not expose a magical `listIssues()` that silently decides whether to:

- read profile projections
- reuse a scoped artifact
- or trigger cost-basis execution

The request contract should force that choice.

Working direction:

- `listAccountingIssues({ scope, filters })`
- `getAccountingIssue({ scope, issueKey })`

Where `scope` is a small explicit union, not a bag of optional flags.

This keeps later CLI shapes flexible while preventing the domain seam from baking in accidental defaults.

### Finding 38: The Cleanest Phase Plan Is 1A Then 1B, Not One Overloaded MVP

If we optimize for the correct model while keeping implementation simple, the likely read-path phases are:

1. Phase 1A
   - profile-global issue projection only
   - gaps
   - asset-review blockers
2. Phase 1B
   - add scoped tax-readiness issue projection on the same issue model
   - require explicit cost-basis scope and freshness semantics
3. Later
   - execution failures after failure-snapshot read support exists
   - missing-price rows after row-level accounting detail exists

This is the chosen phase direction because it is cleaner than one overloaded first command:

- no dishonest implicit scope
- no early distortion of the domain model
- no need to design the final cross-surface queue before the scope contract is settled

### Finding 39: The Correct Model Still Supports A Future Unified Read Surface

Making scope explicit does not kill the unified issue idea.

It actually gives it a sounder foundation:

- one issue object family
- one selector family
- one accounting-owned read seam
- multiple honest entry modes if needed

So the current correct-model lean is:

- unify the domain read model
- keep scope first-class
- use a top-level `issues` overview with explicit scoped drill-in under the same namespace

That is a better long-term foundation than either:

- a fake simple top-level queue with hidden scope assumptions
- permanently fragmented per-command issue models

### Finding 40: After Scope Is Explicit, There Were Three Honest CLI Shapes

Once scope is treated as first-class, the real CLI options narrow to:

1. top-level issue namespace with scoped subpaths
   - `issues`
   - `issues view <issue-ref>`
   - `issues cost-basis --jurisdiction CA --tax-year 2024 --method average-cost`
2. top-level issue namespace with explicit scope flags
   - `issues --scope profile`
   - `issues --scope cost-basis --jurisdiction CA --tax-year 2024 --method average-cost`
3. split entry paths
   - `issues` for profile-global rows
   - `cost-basis issues --jurisdiction ...` for scoped rows

All three can be honest.

The important constraint is simply that scoped families must never appear without an explicit scope story.

### Finding 41: Scoped Subpaths Look Cleaner Than A Generic `--scope` Flag

If we want one eventual browse namespace, the cleanest current shape is likely:

- `issues` for profile-global issue reading
- `issues cost-basis ...` for scoped filing/configuration issue reading

Why this looks stronger than a generic `--scope` flag:

- it keeps the main browse surface simple
- it makes the heavier scoped mode visible in the command shape itself
- it avoids pretending all scopes are interchangeable runtime knobs
- it still keeps one top-level issue domain rather than pushing scoped issue reading back into `cost-basis`

This is now the chosen CLI lean because it is the cleanest fit between:

- domain honesty
- CLI readability
- and the browse-namespace design language

### Finding 42: The Main Thing To Avoid Is Reusing `cost-basis` As The Read Namespace

`cost-basis issues` is still viable, but it has a subtle downside:

- it makes issue reading look owned by the execution command rather than by the issue domain

That would be acceptable if we were only exposing readiness warnings near one workflow.

But the current direction is broader:

- one accounting issue model
- one selector family
- multiple issue families that happen to include a cost-basis-scoped subset

So the cleaner current lean is:

- keep scoped read entry attached to the issue domain
- keep corrective writes attached to the owning domain where needed

That is simpler than mixing:

- top-level issue reading for some families
- but `cost-basis issues` only for others

### Finding 43: Overview-First UX Is The Right Goal

The user expectation is reasonable:

- bare `issues` should feel like a trustworthy overview
- users should not have to think in raw scope flags before they can even see what is wrong

So the UX target should be:

- overview first
- narrowing second
- explicit scope only when the user drills into a scoped family or scoped lens

That is a better operator experience than starting with:

- `issues --scope ...`

even if the underlying domain seam still needs first-class scope.

### Finding 44: A True "All Issues" Overview Needs Discoverable Scoped Lenses

There is a real architectural constraint under the UX preference.

Profile-global issues are easy to discover:

- current gaps
- current asset-review blockers

But scoped cost-basis issues are not currently discoverable in the same way.

Today, the repository layer supports:

- read latest snapshot by exact `scopeKey`
- write latest failure snapshot by exact `(scopeKey, consumer)`

It does **not** support:

- list known cost-basis scopes
- list recent snapshots across scopes
- list latest failure snapshots across scopes

So a bare `issues` overview cannot honestly show "all scoped issues" unless we add a scope-discovery seam.

### Finding 45: This Points To A Two-Layer UX, Not A Flag-First UX

The cleanest current direction is:

1. bare `issues` is an overview
   - current profile-global open issues
   - plus scoped issue lenses or scoped summaries when discoverable
2. drill-in commands narrow into one lens
   - one issue
   - or one scoped issue family / accounting scope

That keeps the user model simple:

- first see everything important
- then narrow by category or scope only when needed

This is different from pretending the domain itself is scope-free.

### Finding 46: The Missing Architecture Piece Is A Scope Catalog, Not More Flags

If we want bare `issues` to show:

- current profile issues
- and relevant cost-basis-scoped issue summaries

then the missing capability is not a better flag set.

It is a way to discover scoped issue lenses, for example:

- latest known cost-basis snapshots
- latest known failure snapshots
- or a curated set of recent/relevant accounting scopes

Without that, the CLI can only do one of two dishonest things:

- silently pick arbitrary scopes
- or claim to show "all issues" while omitting scoped ones

So the correct model may require one more read-side concept:

- a discoverable catalog of scoped accounting runs

### Finding 47: This Makes Bare `issues` More Like An Overview Dashboard Than A Flat List

If the overview eventually includes both:

- live profile-global issue rows
- and discoverable scoped issue lenses

then bare `issues` should likely behave like an overview surface with sections, not a single undifferentiated flat list.

Likely structure:

- `Current Issues`
  - live profile-global rows
- `Scoped Accounting Lenses`
  - recent or relevant cost-basis scopes
  - each with status / counts / staleness hints

Then drill-ins can stay more precise:

- `issues view <issue-ref>`
- scoped issue browsing under the issue namespace

That matches the UX goal better than a flat mixed queue.

### Finding 48: The Scope Catalog May Not Need A New Table First

The current storage is weaker than we need for overview browsing, but stronger than "nothing exists".

Latest cost-basis snapshot rows already persist:

- `scopeKey`
- jurisdiction
- method
- tax year
- date range
- update timestamps

Latest failure snapshot rows already persist:

- `scopeKey`
- consumer
- jurisdiction
- method
- tax year
- date range
- update timestamps

So the likely first gap is:

- list/read contracts over existing latest snapshot tables

not necessarily:

- a brand-new scope-catalog table

This is important because it means a future overview could plausibly show:

- all current profile-global issues
- all known recent scoped accounting lenses

without inventing a new persistence model first.

### Finding 49: "All Issues" Still Means "All Current Profile Issues + All Known Scoped Lenses"

Even with a scope-catalog read seam, bare `issues` still cannot honestly mean:

- all possible filing scopes that a user might care about

It can only honestly mean:

- all current profile-global issues
- plus all known scoped issue lenses that the system has already seen or persisted

That is still a good UX, as long as the overview says so clearly.

The dishonest alternative would be to imply:

- full scoped coverage

when the user has never run or persisted that scope.

So the overview copy and spec must stay explicit about this boundary.

### Finding 50: Overview Entries And Issue Rows Should Stay Different Concepts

If bare `issues` becomes an overview surface with sections, then not every row on that screen should be forced into the `AccountingIssue` shape.

In particular:

- profile-global issue rows are actual issue objects
- scoped accounting lenses are overview entries that lead to a scoped issue view

That distinction matters because a scoped lens summary may represent:

- zero or more actual issues
- scope freshness state
- snapshot recency
- or a stored execution failure

Trying to flatten those into one issue-row model would blur:

- issues
- scope summaries
- and execution state

So the likely correct shape is:

- one `AccountingIssue` model
- plus one higher-level overview model that can mix:
  - current issue rows
  - scoped lens summaries

### Finding 51: This Makes `issues` More Naturally An Overview Command Than A Flat `list`

If the landing surface mixes:

- issue rows
- and scoped lens summaries

then the CLI ladder likely becomes:

- `issues`
  - overview
- `issues list`
  - earlier candidate: flat issue rows for the current lens
- `issues view <issue-ref>`
  - one concrete issue

Current canonical direction is simpler:

- `issues list` remains an alias of the same overview surface

That was chosen to keep Phase 1A simpler and avoid introducing a second read shape too early.

### Finding 52: The Overview Must Behave Like A Work Queue, Not Just A Browser

The operator job story implies that bare `issues` is not just:

- a place to inspect unresolved facts

It is also:

- the place where the user measures remaining work

So the overview should likely prioritize:

- blocking issues first
- clear remaining counts
- clear separation between actionable rows and informational context
- route guidance toward the next fix

This is a stronger requirement than "nice browse output".

It means the overview should help the user say:

- "I had 7, now I have 3 left"

without doing mental bookkeeping across multiple command families.

### Finding 53: "Ready" Is A First-Class Outcome, Not Just Zero Rows

For a user trying to reach trustworthy tax reporting, the key output is not only:

- a list of open issues

It is also:

- a clear statement that a relevant scope is ready

That suggests the issue UX should eventually expose a first-class readiness outcome for a scope, not merely:

- an empty filtered list

This matters especially for scoped accounting lenses:

- a user should be able to fix issues for `CA / average-cost / 2024`
- then see an explicit ready state for that scoped lens
- and get a clear next step toward report/export generation

### Finding 54: Route Guidance Is Necessary But Not Sufficient

The existing ideas of:

- `routeTarget`
- renderer-level command hints

are useful, but still too weak on their own if the UX goal is completion.

They tell the user:

- where to go next

But they do not yet tell the user:

- whether this issue is blocking the final outcome
- how much work remains after this one
- whether resolving it should make a scope ready

So the overview/read model likely also needs explicit notions of:

- blocking vs non-blocking impact
- remaining blockers by scope
- and the difference between issue rows and scope readiness state

### Finding 55: Family Taxonomy Should Stay Secondary To "What Do I Do Next?"

Family and category filters are still useful.

But the operator journey suggests they should be subordinate to a more practical progression model:

- what is blocking me now
- what can I act on next
- what will become ready after I fix these

So even if the underlying model stays family-based, the default presentation order should likely be:

1. blocking work
2. actionable-but-non-blocking work
3. informational context

not:

1. links
2. assets
3. tax readiness

That is a more useful operational queue for the user.

## Implementation Seam Findings

This section is about where the first read-only phase should live technically, not what the final CLI spelling will be.

### Finding 17: The Read-Only Issue Projection Should Be Accounting-Owned, Not CLI-Owned

The inputs for the first viable issue phase already cluster around accounting concerns:

- cost-basis context:
  - transactions
  - confirmed links
  - accounts
- link-gap analysis
- tax-readiness issue derivation
- accounting-blocking asset review summaries

If we compose all of that only in `apps/cli`, we will recreate the same host-layer smell that previously existed around gap analysis.

The cleaner boundary is:

- `@exitbook/accounting` owns the issue projection and issue-family rules
- `@exitbook/data` provides narrow read ports and adapters
- `apps/cli` owns only:
  - selector parsing
  - list/detail rendering
  - command wiring

This keeps the CLI from becoming the de facto domain owner of accounting review state.

### Finding 18: Phase 1 Can Reuse Existing Read Inputs More Than It First Appeared

A first item-backed read-only phase can mostly reuse existing seams:

- `ICostBasisContextReader`
  - already loads transactions, confirmed links, and accounts
- asset-review summary reads
  - already exist via the asset-review projection store
- link-gap analysis
  - already lives in accounting
- tax-package readiness issue derivation
  - already lives in accounting

That means the first big missing seam is **not** the core data itself.

The first missing seam is a shared issue projection contract that assembles these existing accounting-adjacent inputs into one read model.

### Finding 18A: If We Persist Issues, The Persistence Boundary Should Still Be Accounting-Owned

Persisting issues does not change the ownership conclusion.

The clean boundary is still:

- `@exitbook/accounting` derives issue sets and owns issue lifecycle rules
- `@exitbook/data` stores latest issue projections and history/state
- `apps/cli` only reads and renders

The wrong boundary would be:

- CLI commands persisting issue rows directly
- or each feature surface inventing its own issue store

### Finding 18B: A Persisted Issue Projection Also Solves Scope Discovery Cleanly

If we introduce persisted issue projection by scope, then the same seam can likely support:

- list current issues for a scope
- list known scopes/lenses
- read per-scope counts and latest update timestamps

That is a cleaner answer to the overview problem than building:

- one issue model
- and a separate ad hoc scope catalog

So persistence is now pulling double duty:

- stable issue/work-queue UX
- honest scoped overview discovery

### Finding 18C: This Suggests A Small Issue Projection Repository, Not Just More Read Adapters

Earlier analysis leaned toward pure in-memory projection over existing surfaces.

With the new UX goals, the likely missing seam is now larger:

- not only read adapters for existing sources
- but also a small issue projection repository with replace-by-scope semantics

That repository would likely need to support at least:

- replace current issues for one scope
- list current issues for one scope
- list known scopes
- read one issue by canonical key / selector
- later, read closed or acknowledged history

That is a real architecture addition, but it is now easier to justify.

### Finding 18D: The Existing Repo Patterns Favor "Current Rows Per Scope", Not An Issue Event Store

The closest existing persistence patterns are:

- `asset_review_state` + `asset_review_evidence`
- `balance_snapshots` + `balance_snapshot_assets`
- latest cost-basis success/failure snapshots by scope

Those all share the same bias:

- persist current derived state
- replace it wholesale per scope
- keep lifecycle/freshness separately

That suggests the first persisted issue model should likely follow the same rule:

- current issue projection rows by scope

not:

- a first-class append-only issue event store

This keeps the model aligned with the rest of the repo and avoids inventing a second lifecycle philosophy.

### Finding 18E: The Likely Minimal Persisted Shape Is Scope Row + Current Issue Rows

The current clean minimum looks like:

1. one scope-level row
   - identifies the issue lens
   - stores summary counts, readiness, updated timestamps
2. many current issue rows for that scope
   - one row per current issue occurrence

This is likely enough to support:

- overview counts
- scope discovery
- current issue list/detail
- explicit ready/not-ready state

without needing a full history table on day one.

### Finding 18F: Heterogeneous Issue Detail Likely Belongs In Validated JSON, Not Fully Normalized Side Tables

Unlike balances or asset review, issue families diverge quickly in detail shape.

Examples:

- gaps want gap math and context hints
- tax readiness wants transaction-facing detail payloads
- execution failures want error/debug payloads

That makes a fully normalized issue-evidence schema less attractive for the first version.

The likely cleaner first shape is:

- common indexed columns for list/query needs
- validated JSON columns for:
  - family-specific detail
  - evidence refs
  - route/recommended-action metadata

This keeps the DB shape small while preserving typed contracts at the accounting boundary.

### Finding 18G: Mutable Current Rows Are Fine, But User Actions Still Need An Audit Trail

Persisted current issue rows are good for:

- what exists now
- what is ready now
- what is closed now

They are **not** sufficient by themselves for auditable user actions.

So if we later add:

- acknowledge
- reopen
- issue-local review state

those actions should still follow an auditable event/replay model rather than silently mutating the current row only.

The current row can cache derived status for convenience, but it should not become the only record of user intent.

### Finding 18H: "Resolved" Should Probably Be Modeled As Closure Metadata, Not A Primary Status Name

For persisted issue rows, the more precise lifecycle is likely:

- open current
- closed

with closure metadata such as:

- `closedAt`
- `closedReason`

This is cleaner than centering the model on a vague `resolved` status, because the closure reason matters:

- disappeared after deterministic system improvement

Phase 1A simplification:

- keep `closedReason='disappeared'` only
- add richer closure semantics only when a later phase needs them

### Finding 18I: Issues Differ From Balance And Asset-Review Projection Because Closed Rows Matter

Balance and asset-review projections can safely:

- delete all current rows for a scope
- and replace them from scratch

Issues are different if we want:

- progress tracking
- "I had 7, now I have 3 left"
- acknowledgement
- and later history

That means issue persistence likely needs **logical replace**, not just physical replace:

- upsert current derived rows
- mark absent previously-open rows as closed

This is still scope-based replacement in spirit, but it is not the same repository behavior as:

- `replaceSnapshot(...)`
- or `replaceAll(...)`

That distinction is worth preserving early.

### Finding 18J: Issue Persistence Probably Should Not Be Forced Into The Existing Projection Graph Immediately

There is an important asymmetry in the issue families:

- profile-global issue rows behave like a normal derived projection
- cost-basis-scoped issue rows behave more like artifact-derived lenses

The current projection graph only understands:

- `processed-transactions`
- `asset-review`
- `balances`
- `links`

and cost-basis is intentionally outside that graph today.

So if we add persisted issues, the cleanest first move is probably:

- one issue projection storage model
- but not necessarily a new `ProjectionId = 'issues'` on day one

Otherwise we risk forcing:

- profile-global freshness
- and artifact-scoped readiness/failure materialization

into one projection lifecycle that does not match both.

### Finding 18K: The Likely Read/Build Split Is Two Materializers Sharing One Storage Shape

The current best fit is:

- Phase 1A only needs one materializer:
  - profile-global issue scopes
  - gaps
  - asset-review blockers
- Phase 1B may later add a second materializer for cost-basis-scoped issue lenses:
  - tax readiness
  - later, execution failures

Both can still persist into:

- one common issue-scope table
- one common issue-row table

So the storage shape should stay compatible with later scoped materializers, without overbuilding Phase 1A around them.

## Provisional Persisted Model Sketch

This is not a final schema decision.

It is a sketch of the smallest persisted model that currently looks plausible.

### Scope Row

One row per known issue lens / accounting scope.

Working shape:

```ts
interface AccountingIssueScopeRow {
  scopeKind: 'profile' | 'cost-basis';
  scopeKey: string;
  profileId: number;
  title: string;
  status: 'ready' | 'has-open-issues' | 'failed';
  openIssueCount: number;
  blockingIssueCount: number;
  updatedAt: Date;
  metadataJson?: string | undefined;
}
```

Purpose:

- drive bare `issues` overview
- support known-scope discovery
- surface "ready" vs "not ready"

### Issue Row

One row per issue occurrence within one scope.

Working shape:

```ts
interface AccountingIssueRow {
  id: string;
  scopeKey: string;
  issueKey: string;
  family: string;
  code: string;
  severity: string;
  status: 'open' | 'closed';
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

Purpose:

- support current issue list/detail
- keep stable derived identity
- keep one persisted row per occurrence
- preserve enough lifecycle state for progress and later history

Likely invariant:

- at most one non-closed current occurrence per `(scopeKey, issueKey)`

### Why This Looks Simpler Than A Separate History Table For Phase 1A

For the first persisted version, one lifecycle table may be enough if it can answer:

- what is open now?
- what used to exist and is now closed?

That is probably sufficient for:

- overview
- progress counts
- stable selectors
- and initial history/progress needs

If later requirements need:

- immutable status transitions
- audit event playback
- or reopening closed historical rows with precise provenance

then a separate history/event table can be introduced deliberately.

Phase 1A simplification:

- do **not** design review-action storage in the Phase 1A model
- acknowledgement arrives in Phase 2
- if durable acknowledgement is needed, add that persistence seam in Phase 2 rather than carrying it in the first schema sketch

## Future Review-State Actions

Phase 1A does not ship acknowledgement yet, so the review-state persistence design should stay intentionally deferred.

What is already clear:

- domain-changing corrections must stay in narrow domain override families
- generic review-state actions, if added later, should not change accounting readiness or accounting truth
- reappearing issues should require fresh review attention rather than silently carrying forward old acknowledgement

What should stay deferred until Phase 2:

- whether review-state lives in a side event stream or another durable shape
- exact replay rules for acknowledgement / reopen
- whether current rows cache review-state fields directly or only derive them later

This keeps Phase 1A focused on the real first slice:

- persisted issue scopes
- persisted issue rows
- overview/list/detail reading

## Phase 1A Materialization Rules

This section records the current best-fit Phase 1A lifecycle.

### Phase 1A Scope Materialization Rules

For one scope materialization pass:

1. derive the full current issue occurrence set for that scope from accounting-owned sources
2. upsert the scope row with:
   - title
   - current counts
   - readiness / failed status
   - updated timestamp
3. match each derived issue occurrence against the currently open stored row by:
   - `scopeKey`
   - `issueKey`
4. if one open row already exists for the same canonical key:
   - update its summary/detail/evidence cache
   - keep the same row `id`
   - refresh `lastSeenAt`
5. if no open row exists for that canonical key:
   - create a new occurrence row
   - generate a new row `id`
   - set `firstSeenAt = lastSeenAt = now`
6. for any previously open stored row in that scope that is absent from the new derived set:
   - mark it `closed`
   - set `closedAt`
   - set `closedReason='disappeared'`

This is the intended meaning of **logical replace-by-scope**:

- current truth is fully rederived by scope
- persistence preserves occurrence continuity and closure history instead of physically deleting rows

### Phase 1A Occurrence Rules

The current lean is:

- one physical row per occurrence
- one open occurrence at most per `(scopeKey, issueKey)`
- reappearance after closure creates a **new** occurrence row
- row `id` is enough for persisted occurrence identity

This is the smallest model that still keeps reappearance semantics honest.

### Phase 1A Storage Lean

The current Phase 1A storage lean is:

- one `accounting_issue_scopes` table
- one `accounting_issue_rows` table containing both:
  - current open occurrences
  - closed historical occurrences

Reason:

- one lifecycle table is simpler than a current/history split
- it is enough for overview, queue, and basic history
- it preserves room to split current vs history later if query patterns demand it

### Phase 1A Readiness Rules

The current readiness rules should be:

- a scope is `ready` only when it has zero current blocking issues
- overview counts should distinguish:
  - open blockers
  - non-blocking informational issues

This is necessary to preserve trust in the final operator promise:

- if the system says a scope is ready, the user should be able to proceed to reporting with confidence

## Phase 1A Repository And Service Lean

The current architecture now points to a scope-oriented storage and service seam.

### Service Lean

The accounting-owned service layer should likely expose scope-oriented operations, not issue-at-a-time orchestration.

Working direction:

- materialize or refresh one scope
- list overview scopes
- list current issues for one scope
- read one current issue in one scope

This is cleaner than:

- individual producers saving issue rows directly
- or the CLI assembling issue persistence ad hoc

### Repository Lean

The first repository surface should likely stay narrow and scope-oriented.

Working responsibilities:

- upsert one scope row
- reconcile issue occurrences for one scope
- list scope rows for one profile
- list current issue occurrences for one scope
- read one current occurrence by:
  - `scopeKey`
  - `issueKey`
- read prior closed occurrences later when history UX is approved

The important design rule is:

- materializers own derivation
- repositories own persistence and reconciliation
- CLI owns neither

### Scope Catalog Lean

The current best answer to overview discovery is:

- drive it from persisted issue scope rows
- not from a separate ad hoc catalog first

That means the same persisted scope rows should eventually support:

- bare `issues` overview
- known scoped lens discovery
- scope readiness / failed state
- recency / freshness hints

This is simpler than inventing:

- one issue store
- plus a separate scope-catalog store

### Cost-Basis Scope Materialization Lean

For scoped cost-basis issue families, the current likely rule is:

- issue materialization happens only when the user explicitly enters or refreshes that scope
- the latest materialized scope row then becomes discoverable in the overview

This avoids two bad outcomes:

- silently expensive overview reads
- pretending the system knows all cost-basis scopes when it has never materialized them

### Finding 19: Execution Failures And Missing Price Coverage Should Not Distort Phase 1 Architecture

Two tempting additions still require extra domain work:

- latest failure snapshots need a real read port
- missing price coverage needs row-level detail if it is going to be item-backed

Those are valid later phases, but they should not force the first read-only phase into an over-general abstraction.

The Phase 1 design should therefore optimize for:

- item-backed issues already available now

not for:

- every future issue family we might eventually want

### Finding 20: The Shared Reader Should Be Surface-Neutral About Final CLI Placement

Even though the current CLI lean is now:

- top-level `issues`
- with scoped drill-in under the same namespace

the accounting-owned reader should still stay surface-neutral.

So the first accounting-owned reader should not encode CLI naming assumptions.

It should expose something like:

- list issues
- view one issue by derived issue key

with no baked-in commitment to:

- top-level `issues`
- `cost-basis issues`
- or `links issues`

That keeps the domain seam clean even after the current CLI direction has been chosen.

## Likely Phase 1 Architecture

This is still analysis, but it is concrete enough to guide the later phase plan.

### Domain Ownership

Likely home:

- `packages/accounting/src/issues/`

Likely responsibilities:

- define the canonical read-only issue projection type
- derive issue refs / issue identities
- map:
  - gaps
  - tax-readiness rows
  - asset-review blockers
- attach evidence refs and route targets

### Data / Port Ownership

Likely `@exitbook/accounting/ports` additions:

- one narrow read port for issue inputs, or
- one small set of dedicated read ports if reusing `ICostBasisContextReader` would overreach

Likely `@exitbook/data` additions:

- adapters that read:
  - cost-basis context
  - asset-review summaries
- later, a failure-snapshot read adapter once that phase is approved

### CLI Ownership

Likely CLI responsibilities for Phase 1:

- one list command
- one detail command
- selector parsing for `ISSUE-REF` if the unified path wins
- static list rendering
- static detail rendering
- JSON parity

No TUI explorer in Phase 1.

### What Phase 1 Should Explicitly Avoid

- no CLI-only issue projection composition
- no write actions
- no summary-only issue rows unless no safe item-backed unit exists
- no execution-failure issue rows until failure-snapshot reads are real

## Provisional Phase 1 Type Sketch

This is still design analysis, not a committed contract.

The goal is to make the remaining ambiguity visible while the scope is still small.

```ts
type AccountingIssueFamily = 'transfer_gap' | 'asset_review_blocker';

type AccountingIssueSeverity = 'warning' | 'blocked';

type AccountingIssueStatus = 'open';

type AccountingIssueCode = 'LINK_GAP' | 'ASSET_REVIEW_BLOCKER';

type AccountingIssueEvidenceRef =
  | { kind: 'transaction'; ref: string }
  | { kind: 'gap'; ref: string }
  | { kind: 'asset'; selector: string };

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

interface AccountingIssueSummaryItem {
  issueKey: string;
  issueRef: string;
  family: AccountingIssueFamily;
  code: AccountingIssueCode;
  severity: AccountingIssueSeverity;
  status: AccountingIssueStatus;
  summary: string;
  details: string;
  evidenceRefs: readonly AccountingIssueEvidenceRef[];
  nextActions: readonly AccountingIssueNextAction[];
}
```

### Why This Sketch Is Useful

It exposes a few important truths early:

- `status` can stay tiny in Phase 1
- evidence refs are heterogeneous and should stay typed
- possible next actions belong to the issue row, even when correction still lives elsewhere
- the issue object can be coherent without pretending every family has the same mutation semantics
- the core action shape should stay host-agnostic rather than CLI-shaped

### What Is Still Intentionally Missing

This sketch does not yet try to model:

- issue history
- override preview diffs
- acknowledgement state
- execution failures
- missing-price issue rows
- Phase 1B tax-readiness families

Those are later-phase concerns and would only blur the first read-only contract right now.

## Operation Applicability By Issue Family

This is a design guardrail.

One of the biggest risks in this project is inventing generic-looking verbs that do not actually mean the same thing across issue families.

The matrix below records the current likely applicability.

| Operation                      | `transfer_gap` | `tax_readiness`                                         | `asset_review_blocker`                           | `execution_failure` | Notes                                                        |
| ------------------------------ | -------------- | ------------------------------------------------------- | ------------------------------------------------ | ------------------- | ------------------------------------------------------------ |
| read list / detail             | yes            | yes                                                     | yes                                              | later               | shared read surface goal                                     |
| preview action                 | later          | likely                                                  | usually route-only                               | no                  | depends on action support                                    |
| confirm grouped transfer       | yes            | maybe via routed transfer issue                         | no                                               | no                  | primarily a transfer-linking correction                      |
| declare explained residual     | yes            | maybe when surfaced as transfer-derived readiness issue | no                                               | no                  | exact-quantity only                                          |
| override movement role         | maybe          | yes for classification-driven accounting issues         | no                                               | no                  | should stay narrow and typed                                 |
| exclude from transfer matching | maybe          | maybe                                                   | no                                               | no                  | may collapse into movement-role override depending on design |
| acknowledge issue              | yes            | yes                                                     | maybe, but route-first is cleaner                | no                  | review-state only                                            |
| reopen / revoke                | yes            | yes if corrective override exists                       | asset workflow already has clear/reset semantics | no                  | family-specific replay rules still required                  |
| attach user note               | yes            | yes                                                     | yes                                              | likely yes later    | notes are human context, not machine state                   |
| route to owning workflow       | maybe          | maybe                                                   | yes                                              | maybe               | especially important for `assets`                            |

### Family Notes

#### `transfer_gap`

Most likely future actions:

- grouped transfer confirmation
- exact explained residual declaration
- acknowledge / reopen
- attach user note

This family is the strongest candidate for richer operator correction because the repo already has:

- issue identity
- evidence refs
- issue-scoped review replay

#### `tax_readiness`

This family is mixed.

Some rows are likely route-first:

- incomplete transfer linking may route to `links`
- unknown classification may route to transaction/detail review or later role override

So this family should not be assumed to have one universal write path.

#### `asset_review_blocker`

This family already has an owning workflow:

- `assets explore`
- `assets confirm`
- `assets exclude`
- `assets clear-review`

That means the shared issue surface should probably:

- list the blocker
- show evidence
- route the user back to `assets`

rather than duplicate asset-review writes under a new generic issue command.

#### `execution_failure`

This family is qualitatively different.

The likely first actions are:

- inspect failure detail
- inspect captured execution context
- rerun the owning workflow

This is another reason to avoid pretending every issue family supports the same verbs.

## Provisional Read-Only Issue Projection

This is still analysis, not a committed contract.

But the current repo shape is strong enough to sketch the first plausible read model.

### Candidate Canonical Fields

Every issue row likely needs:

- `issueRef`
- `family`
- `code`
- `severity`
- `status`
- `summary`
- `details`
- `evidenceRefs`
- `nextActions`

### Field Intent

| Field          | Purpose                                                                                                            | Current strongest source                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| `issueRef`     | Stable operator selector for one surfaced issue                                                                    | new derived identity, likely `ISSUE-REF`            |
| `family`       | Keeps execution failures, transfer gaps, readiness blockers, and asset review from collapsing into one flat bucket | new projection concern                              |
| `code`         | Machine-readable issue kind                                                                                        | tax-package issues are strongest here               |
| `severity`     | warning vs blocked vs error-style signal                                                                           | tax-package issues / gap severity mapping           |
| `status`       | active workflow state for the current phase                                                                        | partly new; Phase 1A keeps this tiny                |
| `summary`      | one-line operator-facing issue label                                                                               | tax-package issues are strongest here               |
| `details`      | full explanation for `view`                                                                                        | tax-package issues are strongest here               |
| `evidenceRefs` | transaction, gap, asset, link, or snapshot refs tied to the issue                                                  | gaps and tx refs already provide good evidence refs |
| `nextActions`  | typed possible next actions for the user                                                                           | new projection concern                              |

### Status Rules We Should Keep Minimal

`status` should not try to encode everything.

At least three concepts need to stay separate:

- `severity`
  - how much this blocks trustworthy output
- `status`
  - whether the issue is still active in the review workflow
- `nextActions`
  - what the user can do next for this issue

If we collapse those together, we will quickly get muddy states like:

- "blocked" meaning both severity and workflow state
- "review in assets" being inferred from prose instead of modeled as an action

The likely clean rule for an MVP is:

- keep `status` minimal:
  - `open`
  - later maybe `acknowledged`
  - later maybe `overridden`
- keep blocking semantics in `severity`
- keep next-step guidance in typed `nextActions`

That is especially important because current source surfaces already mix these concepts differently:

- gap issues have issue-scoped review visibility
- tax-package issues have severity but no review state
- asset review has `reviewStatus` and `accountingBlocked`

### `nextActions` Should Carry Semantic Route Targets

Some issue actions will be direct later, but Phase 1A will likely be dominated by routed and review-only actions.

When a next action routes to another workflow, its route target should not just be:

- a preformatted command string

The core action shape should describe:

- what the user can do next
- where that action routes

not:

- how the CLI happens to spell the command today

So the nested route target should stay closer to:

- owning workflow family
- owning selector kind
- maybe an owning selector value

That keeps the read model from getting tightly coupled to one CLI spelling before the command boundary is final.

Implication:

- CLI may derive a `commandHint` from the structured action
- future React Native or web surfaces can render the same action as a button, menu item, or drill-in

Example:

- good: one next action with:
  - `mode='routed'`
  - `label='Review in assets'`
  - semantic route target for the asset selector
- less good: only a prose sentence or only a baked command string

### Likely Families

The current code suggests at least these families:

- `transfer_gap`
- `tax_readiness`
- `asset_review_blocker`
- `execution_failure`

This is important because the same read surface can stay unified while still making it obvious:

- what kind of issue this is
- whether the system computed a result at all
- whether the next step is local correction or routing to another workflow

### Evidence Strategy

Evidence refs should likely stay existing-surface-native:

- `TX-REF`
- `GAP-REF`
- `LINK-REF`
- asset selectors where the asset workflow already owns correction
- a future failure snapshot selector if latest execution failures join the list

This avoids inventing synthetic issue-local evidence ids when good evidence selectors already exist.

### Route-First Cases

Some issue rows may exist mainly to route the user to the owning workflow.

The strongest current example is unresolved asset review:

- it is absolutely an accounting blocker
- but the write path already belongs in `assets`

So an issue row may need to say:

- this issue blocks accounting
- here is the evidence
- the owning next step is `assets explore ...`

That is a cleaner design than forcing every correction into one new command family.

## Current Direction Summary

This is the current best-fit direction after the investigation so far.

### Read Model

- one accounting-owned issue model
- one persisted issue projection/state layer
- canonical issue identity stays derived by family
- bare `issues` should become an overview/work-queue surface, not just a flat list

### Persistence Model

- current issue rows persisted by scope
- one scope row per known issue lens
- one issue row per occurrence in that scope
- replace logically by scope:
  - upsert current rows
  - close rows that disappeared

### Scope Model

- `profile` scopes for current-state issue families
- `cost-basis` scopes for filing/configuration-dependent families
- bare `issues` should show:
  - current profile issues
  - plus known scoped accounting lenses
- not pretend to show all possible scopes

### Action Model

- domain-changing corrections stay in narrow domain-specific override streams
- Phase 2 action set should likely stay tiny:
  - acknowledge
  - reopen acknowledgement
- review-state persistence design is deferred until Phase 2

### Phase Lean

1. persisted read-only issue projection for profile-global families
2. scoped lens discovery and scoped tax-readiness issue projection
3. issue-review actions such as acknowledge / reopen
4. domain-specific corrective actions, one family at a time

### Explicit Non-Goals For The First Phase

- no generic `issues fix`
- no forcing every correction into the issue domain
- no fake all-scopes overview
- no append-only issue event store as the primary persistence model

## Immediate Read-Path Lean

But the current code strongly suggests the first implementation phase should be:

1. build a persisted read-only accounting issue projection
2. derive it from existing strongest sources:
   - link gaps
   - tax-package-style typed readiness issues
   - asset-review blockers
3. keep transaction diagnostics as evidence attached to issues, not automatically as top-level issues

It does **not** yet suggest that we should start by implementing broad write actions.

## Additional Smells Surfaced During Analysis

### Smell: We Already Have Three Different Issue Shapes

Today the repo has:

- gap issues
- tax-package issues
- cost-basis readiness warnings

plus portfolio warning strings and failure snapshots.

That fragmentation is the primary design problem, more than the lack of commands.

### Smell: Failure Persistence Exists Without Failure Inspection

Persisting portfolio and cost-basis failures without a first-class read path is operationally incomplete.

We are storing useful operator state that the operator cannot really inspect through a coherent surface.

### Smell: Recommended Actions Already Exist In One Surface But Not Others

Tax-package issues already know how to say:

- what happened
- what row was affected
- what to do next

That capability should not remain export-only.

### Smell: Existing Refs Identify Evidence Better Than They Identify Issues

`TX-REF` and `GAP-REF` are already good evidence selectors.

But they do not answer the bigger question:

- what is the thing the user is trying to resolve?

That is another reason to keep issue identity separate from evidence identity.

### Smell: A New `issues` Command Could Become A Dumping Ground

If we unify too aggressively, we risk building one command that:

- duplicates `assets`
- duplicates `links`
- mixes execution failures with review items
- and blurs which workflow actually owns correction

The read model can still be unified without collapsing ownership.

That boundary must stay explicit.

## Smells And Findings To Preserve

These are not solutions. They are the design smells surfaced by the recent refactor.

### Smell: `links gaps` Is Carrying Too Much Review Burden

It currently mixes:

- transfer-link review
- semantic uncertainty
- residual explanation
- and some broader accounting friction

That is useful for discovery, but it is not the right final home for all accounting issues.

### Smell: Current Corrective UX Is Too System-First

When the system cannot prove a case, the fallback is too often:

- patch the processor
- patch the linker
- rerun the pipeline

That is acceptable for deterministic system bugs, but not as the general operator workflow.

### Smell: Action Boundaries Can Overlap

`confirm_grouped_transfer`, `declare_explained_residual`, and `override_movement_role` could easily become overlapping escape hatches if we do not keep their contracts narrow.

We should not implement all three at once without explicit separation.

### Smell: Replay Compatibility Will Be Load-Bearing

As soon as operator actions can affect transfer eligibility or acquisition lots, replay validation becomes mandatory.

This must align with the existing movement-semantics replay rules, not bypass them.

### Finding: The Recent ADA Case Changed The Shape Of The Problem

The Cardano ADA issue is no longer mainly:

- “how do we get linking to work?”

It is now:

- “how do we let the user correct or confirm accounting interpretation when the system cannot derive it alone?”

That is a product/UX problem, not just a linker problem.

## Phase Gate

Do not start implementation phases from this doc until:

1. the read-only issue model is clear
2. the first corrective operation is chosen intentionally
3. the storage/replay boundary is understood

Once that is settled, this document should be expanded into explicit implementation phases with:

- command surface
- persistence / replay path
- validation rules
- tests
- canonical spec targets
