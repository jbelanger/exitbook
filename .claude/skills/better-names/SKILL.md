---
skillId: better-names
name: Better Names Audit
description: Deep naming audit that identifies unclear, misleading, overloaded, or low-signal names across the codebase and proposes better alternatives with rationale and evidence.
version: 1.0.0
user-invocable: true
context: fork
agent: general-purpose
argument-hint: [scope: all|package-name|path|symbol-type]
---

# Better Names Audit

You are producing a **naming improvement brief** for this codebase.

The goal is to identify **concepts that should be renamed** to improve clarity,
maintainability, and developer comprehension — **without changing behavior** and
without performing the rename automatically.

The user will perform the renames in their IDE. Your job is to find the best
rename candidates, explain why they matter, and propose stronger names.

This is NOT a style-only lint pass. It is a **semantic naming audit**:
you are evaluating whether names accurately reflect purpose, scope, and domain meaning.

────────────────────────────────────────

## FOUR NON-NEGOTIABLE RULES

────────────────────────────────────────

1. **Evidence over vibes.** Every rename recommendation must cite specific files,
   symbols, and usage patterns. No generic “this could be clearer.”

2. **Name from behavior, not guesswork.** Infer intent from implementation and
   call-sites before proposing a rename. Do not rename based only on the symbol’s current spelling.

3. **Preserve domain meaning.** Prefer names that reflect business/domain concepts
   over technical placeholders (`manager`, `helper`, `util`, `data`, `info`, etc.).

4. **Quantify blast radius.** For every rename candidate, estimate affected files
   and call-sites so the user can prioritize safely.

────────────────────────────────────────

## WHAT COUNTS AS A HIGH-VALUE RENAME

────────────────────────────────────────

Prioritize names that create real confusion or slow down understanding:

- **Misleading names** (name implies behavior A, code does B)
- **Overloaded names** (same word used for different concepts)
- **Low-signal names** (`data`, `value`, `item`, `handler`, `manager`, `service`)
- **Scope mismatch** (name sounds local but is global, or vice versa)
- **Abbreviations / acronyms** that are non-obvious in context
- **Temporal ambiguity** (`new`, `old`, `next`, `current`) without stable meaning
- **Boolean names** that don’t read as predicates (`valid`, `enabled` vs `isValid`, `isEnabled`)
- **Collections named as singular** (and vice versa)
- **DTO / schema / entity confusion** where names collapse distinct layers
- **Function names that hide side effects** (sounds pure but mutates / writes / sends)
- **Names that duplicate implementation detail** instead of intent
- **“Utility gravity” files** where generic names hide multiple unrelated concerns

Low priority:

- Minor stylistic preferences with no semantic improvement
- Cosmetic changes that don’t improve comprehension
- Renames that churn public API names unless the confusion is significant

────────────────────────────────────────

## ANALYSIS DIMENSIONS

────────────────────────────────────────

Work through each dimension in order. For each, produce findings or write
"No material issues found." Do NOT skip dimensions.

### 1. Domain Concepts & Ubiquitous Language

Audit names of core domain entities, value objects, and workflows.

**a) Domain alignment**

- Do names match the business concept they represent?
- Are internal terms leaking where domain terms would be clearer?

**b) Concept collisions**

- Is the same term used to mean multiple things across packages/modules?
- Are there near-synonyms (`record`, `entry`, `item`) used inconsistently?

**c) Boundary clarity**

- Are domain terms clearly distinguished from transport/storage terms
  (`Order` vs `OrderRow` vs `OrderDto` vs `OrderPayload`)?

### 2. Types, Interfaces, Schemas, and Models

Audit type names and shape definitions.

**a) Type intent**

- Do type/interface names communicate role (input/output/config/result/state)?
- Are generic names (`Props`, `Data`, `Response`) used where a specific name is needed?

**b) Layer suffix correctness**

- Are suffixes like `Dto`, `Entity`, `Model`, `Schema`, `Payload`, `Input`, `Output`
  used consistently and accurately?

**c) Boolean / enum semantics**

- Are enum values and boolean fields self-explanatory at call-sites?
- Do names require the reader to open the definition to understand them?

### 3. Functions & Methods

Audit callable names by behavior and side effects.

**a) Verb accuracy**

- Does the verb match what the function actually does (`get` vs `load` vs `compute` vs `create`)?
- Are “getter”-sounding names doing I/O, caching, mutation, or retries?

**b) Side-effect transparency**

- Do names reveal writes, network calls, logging, event emission, or mutation?
- Are “ensure”/“handle”/“process” names hiding multiple actions?

**c) Input/output clarity**

- Can you tell what the function consumes/returns from the name and signature together?
- Are there overloaded names repeated across modules with different semantics?

### 4. Variables, Parameters, and Local Names

Audit high-frequency locals and parameters in core paths.

**a) Contextual clarity**

- Are locals named by actual role instead of type (`result`, `obj`, `data`, `x`)?
- Are loop variables meaningful in complex logic?

**b) Shadowing and ambiguity**

- Do local names shadow imports or outer scope names in confusing ways?
- Are repeated names (`value`, `item`) used for different concepts within one function?

**c) Derived values**

- Are transformed values clearly named (`rawUser`, `parsedUser`, `normalizedUser`)?

### 5. Files, Modules, and Directories

Audit structural naming.

**a) File purpose clarity**

- Does the filename tell you what’s inside?
- Are generic buckets (`utils.ts`, `helpers.ts`, `common.ts`, `misc.ts`) hiding specific concerns?

**b) Module export naming**

- Do exported symbols align with file/module names?
- Are `index.ts` barrels masking confusing or duplicated names?

**c) Directory semantics**

- Do folder names reflect domain boundaries or just technical categories?

### 6. Cross-Package / Cross-Layer Consistency

Audit naming consistency across boundaries.

**a) Same concept, same name**

- Is one concept renamed at every layer (`Customer` / `Client` / `AccountHolder`)?

**b) Same name, same meaning**

- Does a shared term preserve meaning across packages/services?

**c) Translation seams**

- Are explicit translations named clearly (`dbUserRow -> userRecord -> userDto`)?

### 7. Naming Risk & Migration Priority

Prioritize rename candidates by leverage and safety.

**a) High-leverage confusion**

- Names that cause repeated cognitive overhead in many files

**b) Bug-prone names**

- Names likely to cause misuse (wrong unit, wrong ID type, wrong lifecycle state)

**c) Churn risk**

- Public API names, serialized fields, DB columns, env vars — flag separately
  and note migration caution even if a rename is recommended

────────────────────────────────────────

## EXECUTION PROCESS

────────────────────────────────────────

1. **Read CLAUDE.md** to understand project terminology and conventions.
2. **Map major modules/packages** and identify core domain concepts.
3. **Sample usage before proposing names**:
   - definition site
   - 2–5 call-sites
   - adjacent types/schemas
4. **Infer actual intent** from behavior, not just comments.
5. **Propose names with rationale** tied to observed usage.
6. **Estimate blast radius** (files/call-sites/imports/tests).
7. **Rank by leverage** after all dimensions are analyzed.

────────────────────────────────────────

## NAMING QUALITY CRITERIA

────────────────────────────────────────

Prefer names that are:

- **Specific** (says what it is, not just that it exists)
- **Stable** (won’t become wrong after small refactors)
- **Searchable** (distinct enough to grep reliably)
- **Composable** (works well in related symbols, e.g. `parseX`, `validateX`, `XSchema`)
- **Consistent** with project/domain vocabulary
- **Honest about side effects** for functions

Avoid names that are:

- Generic (`util`, `helper`, `manager`, `service`, `data`, `info`)
- Ambiguous (`state`, `context`, `payload`) without qualifier
- Misleading verbs (`get*` for async network writes, `build*` that mutates)
- Temporary labels baked into code (`new*`, `temp*`, `old*`)
- Over-abbreviated unless industry-standard and obvious in context

────────────────────────────────────────

## OUTPUT FORMAT

────────────────────────────────────────

For each finding, use this structure:

```

### [Dimension Number] Finding Title

**What exists:**
[Current symbol/file names, where they appear, and how they are used]

**Why the current name hurts:**
[Concrete confusion, misuse risk, or cognitive overhead observed]

**Proposed rename(s):**

* `OldName` → `BetterName`
* [Optional alternates if tradeoffs exist]

**Why this is better:**
[How the new name better matches behavior, scope, and domain meaning]

**Evidence:**

* `path/to/file.ts` — [definition / key usage]
* `path/to/other-file.ts` — [call-site pattern]
* `...`

**Surface:** ~N files, ~M call-sites/imports affected

**Risk:** Low / Medium / High
[Call out if public API / DB / serialized field / env var]

**Leverage:** High / Medium / Low

```

────────────────────────────────────────

## RENAME DECISION SUMMARY

────────────────────────────────────────

End the audit with a ranked table of top rename candidates:

```md
## Rename Decision Summary

| Rank | Rename | Dimension | Leverage | Risk | One-line Rationale |
| ---- | ------ | --------- | -------- | ---- | ------------------ |
| 1    | A → B  | ...       | High     | Low  | ...                |
| 2    | C → D  | ...       | High     | Med  | ...                |
| ...  | ...    | ...       | ...      | ...  | ...                |
```

Follow with:

### Names That Should Stay

List names that are already excellent (clear, domain-accurate, consistent) so the
audit is not purely negative and preserves strong existing vocabulary.

────────────────────────────────────────

## ANTI-DRIFT RULES

────────────────────────────────────────

| Drift Pattern                             | Countermeasure                                                 |
| ----------------------------------------- | -------------------------------------------------------------- |
| Renaming based on personal style          | Must tie recommendation to observed confusion or misuse risk   |
| Generic “use clearer names” advice        | Must cite concrete symbols and call-sites                      |
| Suggesting names without reading behavior | Definition + call-site sampling is mandatory                   |
| Ignoring migration cost                   | Surface + Risk fields are mandatory                            |
| Over-renaming stable public interfaces    | Flag public/serialized names separately with migration caution |
| Confusing naming with formatting          | Focus on semantics, not lint/style trivia                      |

**Self-check before output:** _"Did I inspect how each symbol is used before renaming it?
Did I quantify surface and risk? Are the proposed names more precise and more honest?"_

────────────────────────────────────────

## SCOPE

────────────────────────────────────────

Audit scope: $ARGUMENTS

- If scope is "all" or not specified: audit the entire codebase across all dimensions.
- If scope is a package name: audit that package across all dimensions.
- If scope is a path (file/folder): audit only that area in depth.
- If scope is a symbol type (`functions`, `types`, `files`, `variables`):
  audit that naming dimension across the codebase.

Begin the audit now, starting with reading CLAUDE.md and identifying the project's
core domain vocabulary before proposing any renames.
