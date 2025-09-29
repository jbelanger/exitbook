# Implementation Plan: [FEATURE]

**Branch**: `[###-feature-name]` | **Date**: [DATE] | **Spec**: [link]
**Input**: Feature specification from `/specs/[###-feature-name]/spec.md`

## Resume Instructions

**Last Session**: [timestamp - updated each run]
**Current Phase**: [auto-detected from existing artifacts]
**Next Task**: [specific next step to execute]
**Completed Artifacts**: [list of files that exist]

## Execution Flow (/plan command scope)

```
1. If scope is not specified, STOP and ask for Phase 0, 1, 2, resume, or continue
2. Load feature spec from Input path
   → If not found: ERROR "No feature spec at {path}"
3. Detect existing artifacts and determine resume point:
   → If research.md exists: Phase 0 complete
   → If data-model.md exists: Phase 1 step 1 complete
   → If contracts/ exists: Phase 1 step 2 complete
   → If quickstart.md exists: Phase 1 step 4 complete
   → If agent file updated: Phase 1 step 5 complete
4. Fill Technical Context (scan for NEEDS CLARIFICATION)
   → Skip if research.md exists and no new NEEDS CLARIFICATION
5. Fill the Constitution Check section based on the content of the constitution document
6. Evaluate Constitution Check section below
   → If violations exist: Document in Complexity Tracking
   → If no justification possible: ERROR "Simplify approach first"
   → Update Progress Tracking: Initial Constitution Check
7. Execute based on scope:
   → If scope = "Phase 0": Execute Phase 0 → research.md, and STOP
   → If scope = "Phase 1": Execute Phase 1 → contracts, data-model.md, quickstart.md, agent file, and STOP
   → If scope = "resume": Auto-detect current phase and continue from next incomplete step
   → If scope = "continue": Continue from last incomplete step in current phase
8. Phase 0 execution (if not complete):
   → If NEEDS CLARIFICATION remain: ERROR "Resolve unknowns"
   → Update Progress Tracking: Phase Status
9. Phase 1 execution (if Phase 0 complete):
   → Check each Phase 1 artifact before creating
   → Skip completed steps, execute remaining steps
   → Update Progress Tracking: Phase Status
10. Re-evaluate Constitution Check section after Phase 1
    → If new violations: Refactor design, return to Phase 1
    → Update Progress Tracking: Post-Design Constitution Check
11. Plan Phase 2 → Describe task generation approach (DO NOT create tasks.md)
12. Update Resume Instructions section with current status
13. STOP - Ready for /tasks command
```

**IMPORTANT**: The /plan command supports multiple execution modes:

**Scope Options**:

- `Phase 0` - Execute research phase only, create research.md
- `Phase 1` - Execute design phase only, create data-model.md, contracts/, quickstart.md, agent file
- `Phase 2` - Plan task generation approach only (describe, don't create tasks.md)
- `resume` - Auto-detect current phase from existing artifacts and continue
- `continue` - Continue from last incomplete step within current phase

**Command Flow**:

- Phase 2: /tasks command creates tasks.md (not created by /plan)
- Phase 3-4: Implementation execution (manual or via tools)

**Multi-Session Support**: Each run updates Resume Instructions section with current state for next session

## Summary

[Extract from feature spec: primary requirement + technical approach from research]

## Technical Context

**Language/Version**: [e.g., Python 3.11, Swift 5.9, Rust 1.75 or NEEDS CLARIFICATION]  
**Primary Dependencies**: [e.g., FastAPI, UIKit, LLVM or NEEDS CLARIFICATION]  
**Storage**: [if applicable, e.g., PostgreSQL, CoreData, files or N/A]  
**Testing**: [e.g., pytest, XCTest, cargo test or NEEDS CLARIFICATION]  
**Target Platform**: [e.g., Linux server, iOS 15+, WASM or NEEDS CLARIFICATION]
**Project Type**: [single/web/mobile - determines source structure]  
**Performance Goals**: [domain-specific, e.g., 1000 req/s, 10k lines/sec, 60 fps or NEEDS CLARIFICATION]  
**Constraints**: [domain-specific, e.g., <200ms p95, <100MB memory, offline-capable or NEEDS CLARIFICATION]  
**Scale/Scope**: [domain-specific, e.g., 10k users, 1M LOC, 50 screens or NEEDS CLARIFICATION]

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

[Gates determined based on constitution file]

## Project Structure

### Documentation (this feature)

```
specs/[###-feature]/
├── plan.md              # This file (/plan command output)
├── research.md          # Phase 0 output (/plan command)
├── data-model.md        # Phase 1 output (/plan command)
├── quickstart.md        # Phase 1 output (/plan command)
├── contracts/           # Phase 1 output (/plan command)
└── tasks.md             # Phase 2 output (/tasks command - NOT created by /plan)
```

### Source Code (repository root)

```
# Single project monorepo (DEFAULT)
apps/
├── cli/
├── api/
└── web/

packages/
├── core/   # Shared Kernel, Core domain types, entities, and universal schemas
├── <bounded-context-1>/
│   ├── src/
│   │   ├── app/
│   │   │   ├── commands/
│   │   │   │   └── __tests__/
│   │   │   ├── queries/
│   │   │   └── sagas/
│   │   ├── domain/
│   │   │   ├── aggregates/
│   │   │   ├── entities/
│   │   │   ├── value-objects/
│   │   │   └── services/
│   │   └── infrastructure/
│   └── tests/ # Integration tests
├── <bounded-context-2>/
├── <bounded-context-3>/
├── platform/ # Platform-specific code (e.g., DB, auth, storage)
│   ├── data/
│   ├── observability/
│   ├── security/
│   └── cache/
└── shared/ # Common utilities and helper functions or tooling
    ├── logging/
    ├── config/
    ├── ui/
    └── utils/

Note: Unit tests are colocated with source files in a __tests__ folder.
```

## Phase 0: Outline & Research

1. **Extract unknowns from Technical Context** above:
   - For each NEEDS CLARIFICATION → research task
   - For each dependency → best practices task
   - For each integration → patterns task

2. **Generate and dispatch research agents**:

   ```
   For each unknown in Technical Context:
     Task: "Research {unknown} for {feature context}"
   For each technology choice:
     Task: "Find best practices for {tech} in {domain}"
   ```

3. **Consolidate findings** in `research.md` using format:
   - Decision: [what was chosen]
   - Rationale: [why chosen]
   - Alternatives considered: [what else evaluated]

**Output**: research.md with all NEEDS CLARIFICATION resolved

## Phase 1: Design & Contracts

_Prerequisites: research.md complete_

**Checkpoint Validation** (before starting Phase 1):

- ✅ Check if research.md exists → Skip to Phase 1
- ✅ Check if data-model.md exists → Skip step 1
- ✅ Check if contracts/ directory exists → Skip steps 2-3
- ✅ Check if quickstart.md exists → Skip step 4
- ✅ Check if agent file recently updated → Skip step 5

1. **Extract aggregates/entities/value objects from feature spec** → `data-model.md`:
   - **Skip if**: data-model.md already exists
   - Entity name, fields, relationships
   - Use standard DDD patterns
   - Validation rules from requirements
   - State transitions if applicable
   - **Update Progress**: Mark data-model.md creation complete

2. **Generate CQRS command and query definitions**, from functional requirements:
   - **Skip if**: contracts/ directory already exists and is populated
   - Purpose: Brief description of what the command accomplishes
   - Input Parameters
   - Validation Rules
   - Business Rules
   - Events Produced (optional, if applicable)
   - Use standard basic CQRS patterns
   - Use Result objects for success/failure (recommended) or Exceptions if mentioned in spec
   - Output to `/contracts/`
   - **Update Progress**: Mark CQRS definitions complete

3. **Generate contract tests** from contracts:
   - **Skip if**: Contract tests already exist in test directories
   - One test file per contract
   - Tests must fail (no implementation yet)
   - **Update Progress**: Mark contract tests complete

4. **Extract test scenarios** from user stories:
   - **Skip if**: quickstart.md already exists
   - Each story → integration test scenario
   - Quickstart test = story validation steps
   - **Update Progress**: Mark quickstart.md creation complete

5. **Update agent file incrementally** (O(1) operation):
   - **Skip if**: Agent file modification timestamp is after plan.md creation
   - Run `.specify/scripts/bash/update-agent-context.sh claude`
     **IMPORTANT**: Execute it exactly as specified above. Do not add or remove any arguments.
   - If exists: Add only NEW tech from current plan
   - Preserve manual additions between markers
   - Update recent changes (keep last 3)
   - Keep under 150 lines for token efficiency
   - Output to repository root
   - **Update Progress**: Mark agent file update complete

**Output**: data-model.md, /contracts/\*, failing tests, quickstart.md, agent-specific file

## Phase 2: Task Planning Approach

_This section describes what the /tasks command will do - DO NOT execute during /plan_

**Task Generation Strategy**:

- Load `.specify/templates/tasks-template.md` as base
- Generate tasks from Phase 1 design docs (contracts, data model, quickstart)
- Each contract → contract test task [P]
- Each entity → model creation task [P]
- Each user story → integration test task
- Implementation tasks to make tests pass

**Ordering Strategy**:

- TDD order: Tests before implementation
- Dependency order: Models before services before UI
- Mark [P] for parallel execution (independent files)

**Estimated Output**: 25-30 numbered, ordered tasks in tasks.md

**IMPORTANT**: This phase is executed by the /tasks command, NOT by /plan

## Phase 3+: Future Implementation

_These phases are beyond the scope of the /plan command_

**Phase 3**: Task execution (/tasks command creates tasks.md)  
**Phase 4**: Implementation (execute tasks.md following constitutional principles)  
**Phase 5**: Validation (run tests, execute quickstart.md, performance validation)

## Complexity Tracking

_Fill ONLY if Constitution Check has violations that must be justified_

| Violation                  | Why Needed         | Simpler Alternative Rejected Because |
| -------------------------- | ------------------ | ------------------------------------ |
| [e.g., 4th project]        | [current need]     | [why 3 projects insufficient]        |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient]  |

## Progress Tracking

_This checklist is updated during execution flow - enables resumable sessions_

**Phase Status**:

- [ ] Phase 0: Research complete (/plan command)
  - [ ] Technical Context NEEDS CLARIFICATION identified
  - [ ] Research tasks dispatched for each unknown
  - [ ] research.md created with decisions and rationale
  - [ ] All NEEDS CLARIFICATION resolved
- [ ] Phase 1: Design complete (/plan command)
  - [ ] data-model.md created (aggregates/entities/value objects)
  - [ ] CQRS command and query definitions generated
  - [ ] contracts/ directory created with contract files
  - [ ] Contract tests generated (failing tests)
  - [ ] Integration test scenarios extracted
  - [ ] quickstart.md created from user stories
  - [ ] Agent-specific file updated incrementally
- [ ] Phase 2: Task planning complete (/plan command - describe approach only)
- [ ] Phase 3: Tasks generated (/tasks command)
- [ ] Phase 4: Implementation complete
- [ ] Phase 5: Validation passed

**Artifact Status** (auto-detected for resume):

- [ ] `/specs/[###-feature]/research.md` exists
- [ ] `/specs/[###-feature]/data-model.md` exists
- [ ] `/specs/[###-feature]/contracts/` directory exists
- [ ] `/specs/[###-feature]/quickstart.md` exists
- [ ] Agent file (CLAUDE.md/GEMINI.md/etc.) updated
- [ ] Contract tests created and failing

**Gate Status**:

- [ ] Initial Constitution Check: PASS
- [ ] Post-Design Constitution Check: PASS
- [ ] All NEEDS CLARIFICATION resolved
- [ ] Complexity deviations documented
- [ ] Resume state detected and validated

---

_Based on Constitution v2.1.1 - See `/memory/constitution.md`_
