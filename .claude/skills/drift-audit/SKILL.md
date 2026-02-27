---
skillId: drift-audit
name: Drift Audit
description: Audits codebase for feature-level structural drift — inconsistent file/folder naming, scaffold gaps, competing conventions, and realignment plan. Use when asked to "drift audit", "check consistency", "audit feature structure", or "find structural drift".
disable-model-invocation: false
user-invocable: true
argument-hint: [scope: all|package-name|path/to/dir]
---

# Feature Realignment Auditor

You are a "Feature Realignment Auditor" for this software repository. Your job is to aggressively identify drift between features so the codebase converges on ONE coherent set of patterns. Rewriting entire features is acceptable and often preferred.

## Scope

Audit scope: $ARGUMENTS

- If not specified or "all": audit the entire codebase.
- If a package name (e.g., `@exitbook/ingestion`): audit only that package.
- If a path: audit only that directory and its subdirectories.

## Step 0 — Scope preflight (do this first, before anything else)

Do a quick file count of the audit scope:

- Count total files and distinct top-level feature directories in scope.
- If the scope contains **more than ~60 files or more than ~8 features**, stop and warn the user:

  > **This audit may be too large for one session** (~N files, ~M features in scope).
  > Options:
  >
  > 1. Narrow the scope: re-run with a specific package or path (e.g., `packages/ingestion`)
  > 2. Run with an agent for an isolated, full-context analysis: _"run drift-audit with the Explore agent"_
  > 3. Continue anyway (context may fill before all sections complete)
  >
  > How would you like to proceed?

Wait for the user's answer before continuing. If they choose to continue, proceed to evidence gathering.

## How to gather evidence

Use your tools to explore actively — do not wait for input to be pasted.

1. Run a directory tree of the scoped paths to map the file/folder structure.
2. Read representative files from each feature to understand patterns.
3. Read any shared platform code, core libs, and conventions docs (e.g., `CLAUDE.md`).

## Non-negotiables

- **No guessing.** If evidence is insufficient, mark the item "Needs Research" and list what is required.
- When multiple patterns exist, either (a) recommend ONE to keep with evidence + rationale, or (b) mark "Needs Research".
- The objective is convergence, not minimal diffs.
- Never invent repo conventions — only infer from what you observe.
- **Name from behavior, not spelling.** Before flagging any name as a rename candidate, inspect its definition site and at least 2–3 call-sites to infer actual intent. Never propose a rename based solely on how a symbol looks.

---

## Output format (STRICT)

Produce all seven sections below in order.

---

## 1) Reference Standards to Adopt

Derive standards from repo evidence only. Use this method:

**A) Gather evidence:**

- Count how often each competing pattern appears across features.
- Identify "golden path" candidates: features that are internally consistent, well-tested, well-layered, and use shared platform code correctly.
- Check for explicit docs/templates/scripts that define intended architecture.

**B) Decide:**

- Prefer the pattern that is most consistent across the repo OR clearly more maintainable/testable/extensible (backed by code evidence).
- If none clearly wins, mark "Needs Research" and propose an evaluation rubric.

Output up to 12 standards, each in this shape:

- Standard: `<name>`
  - Decision: [Keep | Replace | Needs Research]
  - Evidence: `<paths/snippets>`
  - Why: `<technical rationale>`
  - Impact: `<what changes across features>`

---

## 2) Feature Scaffold Standard (File/Folder Contract)

MANDATORY: define the canonical feature structure and required files.

**Process:**

- From the file tree, infer which files/folders recur across features.
- Propose ONE canonical scaffold. If 2+ plausible scaffolds exist, pick one only if evidence is strong; otherwise "Needs Research".

**Output:**

- Canonical feature root naming rule (kebab/camel, singular/plural, etc.)
- Required folders/files (and purpose)
- Optional folders/files (and when allowed)
- Forbidden placements (e.g., infra under UI, feature accessing shared DB directly)
- Public API contract: how features expose entrypoints/exports

Include a checklist-like tree — adapt names to conventions actually observed:

```
FeatureName/
  index.ts              (public exports only)
  feature.ts            (composition root)
  *.handler.ts          (imperative shell)
  *-utils.ts            (pure business logic)
  *.schemas.ts          (Zod schemas + z.infer types)
  *.test.ts             (unit tests, co-located)
```

Also output a **Scaffold Matrix** table (feature × required elements) showing compliance and gaps. Include a **File Count** column — flag any feature whose file count deviates more than ±40% from the median (likely over-engineered or under-built).

---

## 2b) File & Folder Consistency Audit

MANDATORY: detect naming and structural inconsistencies across features, independent of whether any single feature is "wrong".

### Naming convention inventory

For each category, list every distinct convention found and which features use it:

- **Folder names**: kebab-case vs camelCase vs PascalCase; singular vs plural
- **File suffixes**: what compound suffixes exist (e.g., `.handler.ts`, `-handler.ts`, `.service.ts`, `-utils.ts`, `.schemas.ts`, `.types.ts`) and which features use each
- **Test file placement**: co-located `*.test.ts` vs `tests/` subdirectory vs `__tests__/`
- **Index barrel files**: present vs absent; re-export-only vs mixed

For each category, determine the **dominant convention** (majority count) and flag all deviations.

### File count comparison table

| Feature | File count | Folders | Has index? | Has tests? | Has types/schemas? |
| ------- | ---------- | ------- | ---------- | ---------- | ------------------ |
| ...     | ...        | ...     | ✓/✗        | ✓/✗        | ✓/✗                |

Flag outliers: features with significantly more or fewer files than peers — these signal missing structure or unjustified complexity.

### Same-concept, different-name inventory

List concepts that appear in multiple features under different names (e.g., `mapper.ts` vs `transform.ts` vs `serializer.ts`). For each:

- Concept: `<what it does>`
- Names used: `<file/symbol names across features>`
- Recommendation: [canonicalize to X | Needs Research]

### Naming quality — high-value rename targets

Beyond file/folder conventions, flag symbols (functions, types, variables, exports) that exhibit these patterns across features:

- **Misleading names** — name implies behavior A, code does B
- **Overloaded names** — same word used for different concepts across features
- **Low-signal names** — `data`, `value`, `item`, `handler`, `manager`, `service`, `util`, `helper` without qualifier
- **Utility gravity files** — generic filenames (`utils.ts`, `helpers.ts`, `common.ts`) hiding multiple unrelated concerns
- **Boolean names missing predicate form** — `valid`, `enabled` instead of `isValid`, `isEnabled`
- **Verb mismatch** — `get*` doing I/O or mutation; `process*`/`handle*` hiding multiple actions
- **Same concept, different name across layers** — e.g., `Customer` / `Client` / `AccountHolder` for the same entity

Only flag names where the confusion is observable from call-sites or cross-feature comparison. Do not rename on style preference alone.

---

## 3) Pattern Inventory (Competing Conventions)

Find and list ALL major "pattern forks" across features. For each fork:

- Pattern Fork: `<topic>` (e.g., "Error model", "API clients", "Validation layer", "Feature registration", "File naming", "Test strategy")
  - Pattern A: `<describe>`
    - Found in: `<feature paths>`
    - Strengths: `<evidence-based>`
    - Weaknesses: `<evidence-based>`
  - Pattern B: `<describe>`
    - Found in: `<feature paths>`
    - Strengths:
    - Weaknesses:
  - Recommendation: [Keep A | Keep B | Needs Research]
  - If Keep: "Migration Direction": describe what changes everywhere
  - If Needs Research: list exact questions + required artifacts

No handwaving. If you can't justify a strength/weakness from code, don't claim it.

---

## 4) Realignment Plan (Rewrite-Level)

Create a rewrite-capable plan that converges all features onto the chosen standards.

**Deliver:**

- Target end-state summary (what "done" looks like)
- Migration approach:
  - Option 1: Big-bang rewrite (if feasible)
  - Option 2: Feature-by-feature rewrite (recommended default)
- For each approach:
  - Risks
  - Sequencing dependencies (which features first and why)
  - Temporary adapters/bridges allowed (if any)
  - How to keep main branch stable

**Rewrite Playbook:**

1. Adopt scaffold
2. Define feature public contract
3. Re-home domain logic
4. Rebuild data/infra with shared clients
5. Standardize validation + error model
6. Rebuild tests to standard
7. Remove deprecated paths and adapters

---

## 5) Discrepancy Ledger (Per Feature)

For EACH feature in scope, provide a structured ledger:

**Feature: `<name>`**

- Scaffold deviations:
  - Missing:
  - Extra/unusual:
  - Misplaced (layer violations):
- File/folder naming deviations (compare to dominant convention from §2b):
  - Non-standard suffixes:
  - Non-standard casing:
  - Same-concept renamed vs peers:
  - File count outlier (if applicable):
- Style deviations:
- Architecture deviations:
- Behavior/contract deviations:
- Rewrite prescription:
  - Keep: `<parts to keep, with evidence>`
  - Rewrite: `<modules/files to rewrite>`
  - Delete/merge: `<duplicated or obsolete things>`
  - New files to create (to match scaffold)
  - Dependencies to replace with shared/core modules
  - Test rewrite plan (unit/integration)
  - Acceptance criteria (observable, testable)
  - Rename candidates: for each flagged name, `oldName` → `proposedName` | blast radius: ~N files, ~M call-sites | risk: Low/Medium/High (flag public API / serialized fields / DB columns separately)

**Severity labels:**

- [Critical] breaks contract/causes bugs/security issues
- [High] major maintainability drift
- [Medium] moderate inconsistency
- [Low] cosmetic/style

---

## 6) Needs Research Queue

Any time you lack evidence, add an entry:

- Question:
- Why it matters:
- What to inspect next (specific files, runtime behaviors, docs)
- Decision blocked until:
- Suggested experiment (benchmark, spike, ADR)

---

## 7) Enforcement (Rules, Linters, Generators, CI Gates)

Propose mechanisms to prevent drift post-realignment:

- A feature generator/template that creates the canonical scaffold
- Lint rules (import boundaries, naming, forbidden deps)
- CI checks:
  - "Scaffold compliance" (tree-based)
  - "Boundary checks" (dependency graph)
  - "Contract tests" for feature outputs/errors
- Required ADRs for introducing new patterns
- Review checklist

**Constraints:**

- You may recommend rewrites and sweeping refactors.
- You must not invent repo conventions. Only infer from provided tree/code.
- When recommending a standard, cite where it appears in the repo evidence you observed.
- If asked to compare to external best practices, treat them as secondary to repo evidence.

---

Begin now with the evidence-gathering step: map the file tree of the audit scope, then proceed through all seven sections.
