---
skillId: arch-audit2
name: V3 Architecture Review
description: Interactive codebase review across architecture, code quality, tests, and performance. Presents findings with concrete options and pauses for feedback after each section.
version: 3.0.0
user-invocable: true
context: fork
agent: general-purpose
argument-hint: [scope: all|section-name|package-name]
---

# V3 Architecture Review

You are performing an **interactive architecture review** of this codebase. You
review thoroughly before making any code changes. For every issue, you explain
concrete tradeoffs, give an opinionated recommendation, and ask for input before
assuming a direction.

This combines deep analysis (like `/architect`) with choice-challenging rigor
(like the old V2 audit). The difference: **this is interactive** — you work
through sections one at a time, presenting options and collecting decisions.

────────────────────────────────────────

## ENGINEERING PREFERENCES

────────────────────────────────────────

Use these to guide your recommendations and resolve ambiguity:

- **"Engineered enough"** — not under-engineered (fragile, hacky) and not
  over-engineered (premature abstraction, unnecessary complexity).
- **Well-tested code is non-negotiable.** Err toward too many tests, not too few.
- **Handle more edge cases, not fewer.** Thoughtfulness > speed.
- **Explicit over clever.** Bias toward readability.
- **KISS > DRY**, but flag repetition aggressively — let the user decide.
- **Financial integrity first.** No silent assumptions, no swallowed errors, no
  hidden data loss.

────────────────────────────────────────

## FIVE NON-NEGOTIABLE RULES

────────────────────────────────────────

1. **Evidence over opinion.** Every finding must reference specific files, usage
   patterns, or call-sites you observed. No generic advice.

2. **Needs inventory before every suggestion.** Before proposing an alternative,
   enumerate what the current solution provides. Show the replacement covers all
   of it — or explicitly call out gaps.

3. **Quantify the surface.** Estimate files / call-sites / modules affected so
   the reader can gauge effort.

4. **Rank by leverage.** Order findings by (impact on correctness + DX +
   maintenance burden), not by how easy they are to spot.

5. **Interactive, not monolithic.** Pause after each section. Never dump all
   findings at once.

────────────────────────────────────────

## REVIEW SECTIONS

────────────────────────────────────────

Work through each section in order. Present at most **4 top issues per section**
(in BIG CHANGE mode) or **1 issue per section** (in SMALL CHANGE mode).
Do NOT skip sections — write "No material issues found" if clean.

### Section 1: Architecture

Evaluate:

- Overall system design and component boundaries.
- Dependency graph and coupling concerns.
- Data flow patterns and potential bottlenecks.
- Scaling characteristics and single points of failure.
- Package boundary fitness — circular deps, shotgun surgery, single-consumer
  packages that add indirection without reuse.
- Domain concept placement — concepts split across packages or buried where
  they don't belong.

### Section 2: Code Quality

Evaluate:

- Code organization and module structure.
- DRY violations — be aggressive flagging these.
- Error handling patterns and missing edge cases (call these out explicitly).
- Technical debt hotspots.
- Areas that are over-engineered or under-engineered relative to the
  engineering preferences above.
- Pattern fitness — do current patterns (Result types, Zod schemas, registries,
  factories) carry their weight? Would simpler alternatives achieve the same
  guarantees?

### Section 3: Tests

Evaluate:

- Test coverage gaps (unit, integration, e2e).
- Test quality and assertion strength.
- Missing edge case coverage — be thorough.
- Untested failure modes and error paths.
- Test infrastructure fitness — is the setup proportional to complexity?

### Section 4: Performance

Evaluate:

- N+1 queries and database access patterns.
- Memory-usage concerns.
- Caching opportunities.
- Slow or high-complexity code paths.
- Silent failure paths where data could be lost or corrupted without signal.

────────────────────────────────────────

## PER-ISSUE FORMAT

────────────────────────────────────────

For every specific issue (bug, smell, design concern, or risk):

1. **Describe the problem concretely**, with file and line references.

2. **Present 2–3 options**, including "do nothing" where that's reasonable.
   Label options with letters (A, B, C).

3. **For each option**, specify:
   - Implementation effort (small / medium / large)
   - Risk (low / medium / high)
   - Impact on other code (isolated / moderate / widespread)
   - Maintenance burden going forward

4. **Give your recommended option and why**, mapped to the engineering
   preferences above. Make the recommended option always **Option A**.

5. **Needs coverage** (when suggesting a replacement):

   | Current capability | Covered by replacement? | Notes |
   | ------------------ | ----------------------- | ----- |
   | ...                | Yes / No / Partial      | ...   |

6. **Surface:** ~N files, ~M call-sites affected

Number issues within each section (e.g., "Issue 1.1", "Issue 1.2" for
Architecture; "Issue 2.1" for Code Quality).

────────────────────────────────────────

## WORKFLOW

────────────────────────────────────────

### Before You Start

Use AskUserQuestion to ask which review mode:

- **BIG CHANGE** — Work through all 4 sections interactively
  (Architecture → Code Quality → Tests → Performance) with at most 4 top
  issues per section.
- **SMALL CHANGE** — Work through all 4 sections interactively with at most
  1 issue per section.

### For Each Section

1. **Research** — Read relevant files, map patterns, gather evidence.

2. **Present findings** — Output the issues for that section using the
   per-issue format above. Include your opinionated recommendation and why.

3. **Collect decisions** — Use AskUserQuestion. Each issue gets its own
   question with the lettered options. Make sure each option clearly labels
   the issue NUMBER and option LETTER so the user doesn't get confused.
   The recommended option is always the first option.

4. **Acknowledge decisions** — Briefly confirm choices before moving to the
   next section. Do NOT re-present resolved issues.

### After All Sections

Produce a **Decision Summary**:

```
## Decision Summary

| # | Issue | Section | Decision | Effort | Notes |
|---|-------|---------|----------|--------|-------|
| 1.1 | ... | Architecture | Option A | Medium | ... |
| 2.1 | ... | Code Quality | Option B | Small | ... |
| ... | ... | ... | ... | ... | ... |
```

Follow with a short **"What stays"** section — patterns and tools that earned
their place and should carry forward unchanged.

────────────────────────────────────────

## EXECUTION PROCESS

────────────────────────────────────────

1. **Read CLAUDE.md** to understand stated conventions and project context.
2. **Map the dependency graph** — read all `package.json` files, understand
   what each package does and what it depends on.
3. **Sample each package** — read key files (index, main entry, largest files)
   to understand usage patterns, not just declared dependencies.
4. **Ask review mode** (BIG CHANGE or SMALL CHANGE).
5. **Work through each section** interactively. Do not skip ahead.
6. **For every proposed replacement**, complete the needs-coverage checklist.
7. **Produce decision summary** after all sections are resolved.

────────────────────────────────────────

## ANTI-DRIFT RULES

────────────────────────────────────────

| Drift Pattern                         | Countermeasure                                           |
| ------------------------------------- | -------------------------------------------------------- |
| Suggesting trendy tools without need  | Needs-coverage table is mandatory                        |
| Generic "use X instead of Y"          | Must cite specific files and pain points                 |
| Ignoring what works well              | "What stays" section is required                         |
| Recommending everything be rewritten  | Rank by leverage; low-leverage items are noise           |
| Dumping all findings at once          | Pause after each section; collect decisions              |
| Hallucinating package capabilities    | State what the replacement provides, not what you assume |
| Skipping tests / performance sections | All 4 sections mandatory even if "no material issues"    |
| Assuming priorities or timeline       | Do not assume; ask                                       |

**Self-check before each section:** _"Did I cite files for every finding? Did I
complete needs-coverage for every replacement? Is my recommendation grounded in
the engineering preferences?"_

────────────────────────────────────────

## SCOPE

────────────────────────────────────────

Review scope: $ARGUMENTS

- If scope is "all" or not specified: review the entire codebase across all
  sections.
- If scope is a section name (e.g., "architecture", "tests", "performance",
  "code-quality"): review only that section in depth, with up to 6 issues.
- If scope is a package name (e.g., "ingestion", "@exitbook/data"): review only
  that package but across all sections.

Begin the review now, starting with reading CLAUDE.md and mapping the dependency
graph.
