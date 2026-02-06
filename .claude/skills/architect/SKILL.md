---
skillId: architect
name: Architectural Cleanup
description: Deep architecture cleanup pass focused on simple, readable, high-integrity code. Identifies complexity hotspots and proposes simplification strategies.
version: 1.0.0
---

# Instructions

You are performing an **architectural cleanup review and refactor plan** for the ExitBook monorepo.

## Mission

Find where architecture and code structure have become unnecessarily complex, propose simpler alternatives, and produce a prioritized refactor plan that can justify large/long refactors when they materially improve maintainability and correctness.

## Non-Negotiables

- Financial integrity first: no silent assumptions, no swallowed errors, no hidden data loss.
- Keep strict `Result<T, E>` style error propagation (`neverthrow`) for fallible paths.
- Preserve runtime validation boundaries (Zod).
- Respect `exactOptionalPropertyTypes`.
- Favor **vertical slices** (feature-oriented) over technical-layer sprawl.
- Prefer simple, readable code over heavy abstractions (KISS > DRY).
- Keep dynamic registries/metadata-driven behavior; avoid hardcoded lists when registries exist.
- If behavior is uncertain, log warnings explicitly.

## Scope

Review all major packages:

- `apps/cli`
- `packages/core`
- `packages/data`
- `packages/ingestion`
- `packages/blockchain-providers`
- `packages/exchange-providers`
- `packages/price-providers`
- `packages/accounting`
- `packages/http`
- `packages/logger`
- `packages/env`
- `packages/events`

## What To Deliver

Produce output in this exact structure:

### 1. Architecture Strengths To Keep

- Concrete patterns that are working well today.
- Explain why each should remain.

### 2. Complexity Hotspots (Ranked by impact)

- File-level findings with short evidence.
- Why each hotspot is costly (maintenance, defect risk, onboarding friction, coupling).

### 3. Simplification Opportunities

- For each hotspot, propose the simplest viable design.
- Include expected tradeoffs.

### 4. Refactor Program (30/60/90 day)

- **30-day**: low-risk structural wins.
- **60-day**: medium-depth module decomposition.
- **90-day**: high-impact architecture reshaping.
- Include sequencing dependencies.

### 5. Rules for Future Contributions

- 8-12 concise guardrails to prevent regressions into over-abstraction.

### 6. Naming Clarity Improvements

- List unclear names (functions/variables/modules) and better alternatives.

### 7. Stop/Start/Continue

- **Stop**: patterns to phase out.
- **Start**: patterns to adopt.
- **Continue**: patterns to preserve.

## Review Heuristics

Use these heuristics while analyzing:

- File too large if it has multiple unrelated reasons to change.
- Service too broad if orchestration + business logic + formatting + persistence live together.
- Prefer handler maps/composed modules over giant switches once event/mode count grows.
- Keep pure transformations separate from side-effect orchestration.
- Optimize for "can a new maintainer safely edit this in 15 minutes?"

## Output Quality Bar

- Be opinionated and specific, not generic.
- Use concrete file references and practical examples.
- Suggest bold refactors when justified, but include migration-safe sequencing.
- Prioritize readability and correctness over architectural novelty.

## Execution Process

1. **Read the codebase**: Use Glob and Read tools to explore the packages listed in scope
2. **Identify patterns**: Look for recurring patterns, both good and bad
3. **Analyze complexity**: Find files/modules with excessive responsibility or coupling
4. **Propose solutions**: For each issue, suggest the simplest fix that maintains correctness
5. **Prioritize impact**: Order findings by maintenance burden and defect risk
6. **Create actionable plan**: Break refactors into phased work with clear sequencing

## Optional Add-On

If the user requests it, also produce a **"first refactor PR plan"** with exact files to touch and expected test coverage additions.
