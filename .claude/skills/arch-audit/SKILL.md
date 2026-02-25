---
skillId: arch-audit
name: V2 Architecture Audit
description: Deep codebase audit that evaluates current tools, libraries, patterns, and structure against modern alternatives — as if planning a ground-up rewrite with no backward-compatibility constraints.
version: 1.0.0
user-invocable: true
context: fork
agent: general-purpose
argument-hint: [scope: all|dimension-name|package-name]
---

# V2 Architecture Audit

You are producing a **V2 rewrite brief** for this codebase. The goal: identify what
should change if the project were rebuilt from scratch with no backward-compatibility
constraints and unlimited time.

This is NOT a consistency audit (that's `/drift-audit`) or an internal cleanup
review (that's `/architect`). This audit **challenges the choices themselves** —
the libraries, the runtime, the data layer, the monorepo tooling, the patterns.

────────────────────────────────────────

## FOUR NON-NEGOTIABLE RULES

────────────────────────────────────────

1. **Needs inventory before every suggestion.** Before proposing an alternative
   to anything, enumerate the concrete capabilities the current solution provides.
   Then show the proposed replacement covers all of them — or explicitly call out
   gaps. No "just use X" without this proof.

2. **Evidence over opinion.** Every finding must reference specific files, usage
   patterns, or dependency call-sites you observed. No generic advice.

3. **Quantify the surface.** When flagging something for replacement, estimate
   how many files / call-sites / modules are affected so the reader can gauge
   migration effort.

4. **Rank by leverage.** Order findings by (impact on correctness + DX +
   maintenance burden), not by how easy they are to spot.

────────────────────────────────────────

## ANALYSIS DIMENSIONS

────────────────────────────────────────

Work through each dimension in order. For each, produce findings or write
"No material issues found." Do NOT skip dimensions.

### 1. Dependency Audit

Examine `package.json` files across all packages. For each finding:

**a) Hand-rolled code duplicating a community package**

- Identify application code that reimplements functionality available in a
  mature, actively maintained package.
- "Mature" means: >1k GitHub stars, meaningful release in last 12 months,
  TypeScript-first or high-quality types.
- Show the specific files containing the hand-rolled code and what package
  would replace them.

**b) Over-dependency**

- Packages where the project uses <20% of the API surface.
- Packages that are unmaintained (no release in 18+ months) or have known CVEs.
- Heavy dependencies that could be replaced with lighter alternatives.

**c) Missing ecosystem leverage**

- Places where a well-known package would eliminate an entire category of bugs
  or boilerplate that the project currently manages manually.

### 2. Architectural Seams

**a) Package boundary fitness**

- Are package boundaries drawn at the right places?
- Look for: circular deps, packages always changed together (shotgun surgery),
  packages with a single consumer that add indirection without reuse.
- Would a different decomposition reduce cross-package churn?

**b) Dependency graph direction**

- Does the graph flow cleanly (core -> data -> domain -> app)?
- Are there layering violations or unnecessary coupling?

**c) Domain concept placement**

- Are there domain concepts split across packages in confusing ways?
- Are there concepts that deserve their own boundary but are currently buried?

### 3. Pattern Re-evaluation

For each major pattern in the codebase (Result types, Zod schemas, repository
pattern, factory pattern, registry/decorator pattern, etc.):

**a) Is this the right pattern for the job?**

- Does it carry its weight, or does it add ceremony without proportional safety?
- Is there a simpler pattern that achieves the same guarantee?
- Are there modern alternatives that didn't exist when the pattern was adopted?

**b) Is it applied uniformly?**

- If not, is the inconsistency justified or accidental?

**c) Pattern interactions**

- Do patterns compose well together, or do they create friction at boundaries?

### 4. Data Layer

**a) ORM / query builder fit**

- Evaluate the current choice against actual query complexity.
- Is the project fighting the tool or using it naturally?
- Would a different tool (e.g., Drizzle, Prisma, raw SQL, different DB) be a
  better fit for the access patterns?

**b) Schema strategy**

- Is the current migration approach appropriate for the project's stage?
- Are there data-integrity invariants enforced only in application code that
  the database could enforce natively?

**c) Storage architecture**

- Is SQLite the right choice for the data volume, concurrency, and query
  patterns? Would a different storage engine be materially better?

### 5. Toolchain & Infrastructure

**a) Build system**

- Monorepo tool, bundler, TypeScript compilation strategy.
- Are there newer alternatives that would meaningfully reduce config surface,
  improve speed, or simplify the DX?

**b) Runtime**

- Node.js version requirements, native dependencies, startup time.
- Are there friction points that a different runtime or packaging strategy
  would eliminate?

**c) Test infrastructure**

- Test runner, assertion style, mocking approach.
- Is the test setup proportional to project complexity?

**d) CI / developer workflow**

- Lint, format, pre-commit hooks, scripts.
- Are there tools that would collapse multiple config files into one?

### 6. File & Code Organization

**a) Directory structure clarity**

- Does the structure make it obvious where new code goes?
- Are there structural patterns that would reduce "where does this go?" friction?

**b) Naming conventions**

- Are file naming, export naming, and variable naming conventions consistent
  and self-documenting?

**c) Module size**

- Files >400 LOC with multiple concerns.
- Modules that are doing too little (unnecessary fragmentation).

### 7. Error Handling & Observability

**a) Error strategy fitness**

- Is the current approach (neverthrow Result types) the right tool, or would
  a different error model (Effect, typed exceptions, error boundaries) be
  a better fit for the project's needs?
- Does the strategy preserve enough context for debugging?

**b) Silent failure paths**

- Are there paths where data could be lost or corrupted without signal?

**c) Observability readiness**

- Would current logging/tracing be sufficient to diagnose a production issue?
- Would structured tracing (OpenTelemetry) provide material value?

────────────────────────────────────────

## EXECUTION PROCESS

────────────────────────────────────────

1. **Read CLAUDE.md** to understand stated conventions and project context.
2. **Map the dependency graph** — read all `package.json` files, understand
   what each package does and what it depends on.
3. **Sample each package** — read key files (index, main entry, largest files)
   to understand usage patterns, not just declared dependencies.
4. **Work through each dimension** systematically. Do not skip ahead.
5. **For every proposed replacement**, complete the needs-coverage checklist
   before including it in the output.
6. **Rank and prioritize** after all dimensions are analyzed.

────────────────────────────────────────

## OUTPUT FORMAT

────────────────────────────────────────

For each finding, use this structure:

```
### [Dimension Number] Finding Title

**What exists:**
[Current state with file references and usage patterns observed]

**Why it's a problem:**
[Concrete pain — maintenance burden, bug risk, DX friction, performance.
Not aesthetic preference.]

**What V2 should do:**
[Proposed change with specific alternative named]

**Needs coverage:**
| Current capability | Covered by replacement? | Notes |
|--------------------|------------------------|-------|
| ...                | Yes / No / Partial     | ...   |

**Surface:** ~N files, ~M call-sites affected

**Leverage:** High / Medium / Low
```

────────────────────────────────────────

## V2 DECISION SUMMARY

────────────────────────────────────────

End the audit with a ranked table of the top changes by leverage:

```
## V2 Decision Summary

| Rank | Change | Dimension | Leverage | One-line Rationale |
|------|--------|-----------|----------|--------------------|
| 1    | ...    | ...       | High     | ...                |
| 2    | ...    | ...       | High     | ...                |
| ...  | ...    | ...       | ...      | ...                |
```

Follow with a short **"What V2 keeps"** section — patterns and tools that
earned their place and should carry forward unchanged.

────────────────────────────────────────

## ANTI-DRIFT RULES

────────────────────────────────────────

| Drift Pattern                           | Countermeasure                                           |
| --------------------------------------- | -------------------------------------------------------- |
| Suggesting trendy tools without need    | Needs-coverage table is mandatory                        |
| Generic "use X instead of Y"            | Must cite specific files and pain points                 |
| Ignoring what works well                | "What V2 keeps" section is required                      |
| Recommending everything be rewritten    | Rank by leverage; low-leverage items are noise           |
| Confusing this with a consistency audit | This challenges choices, not adherence to them           |
| Hallucinating package capabilities      | State what the replacement provides, not what you assume |

**Self-check before output:** _"Did I complete the needs-coverage table for
every suggestion? Can I point to files for every finding? Did I include what
should stay?"_

────────────────────────────────────────

## SCOPE

────────────────────────────────────────

Audit scope: $ARGUMENTS

- If scope is "all" or not specified: audit the entire codebase across all dimensions.
- If scope is a dimension name (e.g., "data-layer", "dependencies", "toolchain"):
  audit only that dimension in depth.
- If scope is a package name (e.g., "ingestion", "@exitbook/data"): audit only
  that package but across all dimensions.

Begin the audit now, starting with reading CLAUDE.md and mapping the dependency graph.
