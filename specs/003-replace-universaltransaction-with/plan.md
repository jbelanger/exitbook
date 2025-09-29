# Implementation Plan: Replace UniversalTransaction with ProcessedTransaction + Purpose Classifier (MVP)

**Branch**: `003-replace-universaltransaction-with` | **Date**: 2025-09-24 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/Users/joel/Dev/crypto-portfolio-before-nestjs/specs/003-replace-universaltransaction-with/spec.md`

## Resume Instructions

**Last Session**: 2025-09-25 - Phase 3.1 alignment completed, ready for contract tests
**Current Phase**: Phase 3.1 Implementation (Foundation Complete, Tests Ready)
**Next Task**: Execute contract tests (T005-T016) - all import/interface issues resolved
**Completed Artifacts**: research.md, data-model.md, contracts/, quickstart.md, tasks.md, CLAUDE.md updated, contracts aligned with implementation
**Implementation Progress**: Core types (T001-T004, T017-T024), database migration, schemas, contract alignment all implemented

## Execution Flow (/plan command scope)

```
1. If scope is not specified, STOP and ask for Phase 0, 1 or 2
1. Load feature spec from Input path
   → If not found: ERROR "No feature spec at {path}"
2. Fill Technical Context (scan for NEEDS CLARIFICATION)
3. Fill the Constitution Check section based on the content of the constitution document.
4. Evaluate Constitution Check section below
   → If violations exist: Document in Complexity Tracking
   → If no justification possible: ERROR "Simplify approach first"
   → Update Progress Tracking: Initial Constitution Check
5. If scope = Phase 0, execute Phase 0 → research.md, and STOP
   → If NEEDS CLARIFICATION remain: ERROR "Resolve unknowns"
   → Update Progress Tracking: Phase Status
6. If scope = Phase 1, execute Phase 1 → contracts, data-model.md, quickstart.md, agent-specific template file (e.g., `CLAUDE.md` for Claude Code, `.github/copilot-instructions.md` for GitHub Copilot, `GEMINI.md` for Gemini CLI, `QWEN.md` for Qwen Code or `AGENTS.md` for opencode), and STOP.
   → Update Progress Tracking: Phase Status
7. Re-evaluate Constitution Check section
   → If new violations: Refactor design, return to Phase 1
   → Update Progress Tracking: Post-Design Constitution Check
8. Plan Phase 2 → Describe task generation approach (DO NOT create tasks.md)
9. STOP - Ready for /tasks command
```

**IMPORTANT**: The /plan command STOPS at step 7 (Phase 1). Phases 2-4 are executed by other commands:

- Phase 2: /tasks command creates tasks.md
- Phase 3-4: Implementation execution (manual or via tools)

## Summary

Replace the ambiguous `UniversalTransaction` with a cleaner `ProcessedTransaction` + Purpose Classifier architecture. This MVP focuses on deterministic processing of Kraken spot trades and Ethereum transfers, introducing clear separation between "what happened" (money flows) vs "why it happened" (purposes: PRINCIPAL, FEE, GAS) vs "how to book it" (accounting). The system must produce identical classification results across runs while maintaining financial precision using Decimal.js.

**Current Status**: Implementation phase 3.1 foundation completed with contracts successfully aligned to match actual implementation.

**RESOLVED**: Contract/implementation alignment completed successfully:

- ✅ Updated contracts to use `Money2` interface matching implementation
- ✅ Fixed import paths from relative to `@crypto/core` package imports
- ✅ Aligned data-model.md with actual type definitions and schemas
- ✅ All interface mismatches resolved between contracts and implementation
- ⏳ CQRS handlers still need implementation but contracts are now accurate

**Next Priority**: Execute contract tests (T005-T016) to validate the aligned contracts, then implement CQRS handlers.

**Arguments from user**: Successfully resolved discrepancies using Option 1 - updated contracts to match implementation.

## Technical Context

**Language/Version**: TypeScript (Node.js 23.0.0+, existing codebase)
**Primary Dependencies**: Decimal.js (financial precision), Zod (validation), neverthrow (Result types for error handling), Vitest (testing), existing monorepo packages
**Storage**: SQLite3 (existing transactions.db with ACID compliance)
**Testing**: Vitest unit tests, existing E2E test infrastructure with provider integration tests
**Target Platform**: CLI application (existing crypto portfolio platform)
**Project Type**: Monorepo package (extending existing packages/core, packages/import, packages/data)
**Performance Goals**: Deterministic processing, consistent results across runs, maintain existing ~2s test execution
**Constraints**: MVP scope covers all existing blockchains and exchanges in codebase, no legacy migration needed, preserve financial precision (18+ digits)
**Scale/Scope**: Replace core transaction processing for all existing providers (6 blockchains, multiple exchanges), ~5-10 new types/interfaces, extend existing validation pipeline

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

**I. Multi-Provider Resilience Architecture**: ✅ PASS

- Feature maintains existing resilience patterns through ProcessedTransaction architecture
- No changes to circuit breaker or failover mechanisms
- Preserves provider-agnostic data processing

**II. Registry-Based Auto-Discovery**: ✅ PASS

- Feature does not modify existing @RegisterApiClient decorator pattern
- ProcessedTransaction works within existing auto-discovery framework
- No changes to provider registration mechanisms

**III. Two-Stage ETL Pipeline**: ✅ PASS

- Feature enhances Stage 2 (Process) with better transaction processing
- Raw data preservation maintained in Stage 1 (Import)
- Clear separation between import and processing stages preserved

**IV. Financial Precision and Validation**: ✅ PASS

- Explicitly requires Decimal.js for all financial calculations
- Zod schemas maintained for validation pipeline
- Mathematical constraints enforced through ProcessedTransaction design

**V. Domain-Driven Monorepo Structure**: ✅ PASS

- Feature extends packages/core and packages/import appropriately
- Dependencies flow from applications to domains
- No cross-domain dependencies introduced

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

1. **Extract aggregates/entities/value objects from feature spec** → `data-model.md`:
   - Entity name, fields, relationships
   - Use standard DDD patterns
   - Validation rules from requirements
   - State transitions if applicable

2. **Generate CQRS command and query definitions**, from functional requirements:
   - Purpose: Brief description of what the command accomplishes
   - Input Parameters
   - Validation Rules
   - Business Rules
   - Events Produced (optional, if applicable)
   - Use standard basic CQRS patterns
   - Use Result objects for success/failure (recommended) or Exceptions if mentioned in spec
   - Output to `/contracts/`

3. **Generate contract tests** from contracts:
   - One test file per contract
   - Tests must fail (no implementation yet)

4. **Extract test scenarios** from user stories:
   - Each story → integration test scenario
   - Quickstart test = story validation steps

5. **Update agent file incrementally** (O(1) operation):
   - Run `.specify/scripts/bash/update-agent-context.sh claude`
     **IMPORTANT**: Execute it exactly as specified above. Do not add or remove any arguments.
   - If exists: Add only NEW tech from current plan
   - Preserve manual additions between markers
   - Update recent changes (keep last 3)
   - Keep under 150 lines for token efficiency
   - Output to repository root

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

_This checklist is updated during execution flow_

**Phase Status**:

- [x] Phase 0: Research complete (/plan command)
  - [x] Technical Context NEEDS CLARIFICATION identified
  - [x] Research tasks dispatched for each unknown
  - [x] research.md created with decisions and rationale
  - [x] All NEEDS CLARIFICATION resolved
- [x] Phase 1: Design complete (/plan command)
  - [x] data-model.md created (aggregates/entities/value objects)
  - [x] CQRS command and query definitions generated
  - [x] contracts/ directory created with contract files
  - [x] Contract tests generated (failing tests)
  - [x] Integration test scenarios extracted
  - [x] quickstart.md created from user stories
  - [x] Agent-specific file updated incrementally
- [x] Phase 2: Task planning complete (/plan command - describe approach only)
- [x] Phase 3: Tasks generated (/tasks command)
- [⚡] Phase 4: Implementation in progress (Phase 3.1 Foundation Complete)
  - [x] T001-T004: Setup tasks (types, migration, schemas, golden data)
  - [x] T017-T024: Core types and entities implemented
  - [x] **Contract Alignment**: Fixed import paths and interface mismatches
  - [🚀] T005-T016: Contract and integration tests (ready to execute)
  - [ ] T025-T040: Services, handlers, repositories
  - [ ] T041-T050: Unit tests, validation, cleanup
- [ ] Phase 5: Validation passed

**Artifact Status** (auto-detected for resume):

**Planning Artifacts:**

- [x] `/specs/003-replace-universaltransaction-with/research.md` exists
- [x] `/specs/003-replace-universaltransaction-with/data-model.md` exists
- [x] `/specs/003-replace-universaltransaction-with/contracts/` directory exists
- [x] `/specs/003-replace-universaltransaction-with/quickstart.md` exists
- [x] `/specs/003-replace-universaltransaction-with/tasks.md` exists
- [x] Agent file (CLAUDE.md) updated

**Implementation Artifacts (Phase 3.1 - Foundation Complete):**

- [x] Core types: `ProcessedTransaction`, `ClassifiedTransaction`, `Money2`, `MovementUnclassified`, `MovementClassified`, `SourceDetails`, `ClassificationInfo`, `primitives`
- [x] Error hierarchy: `packages/core/src/errors/index.ts` with structured domain errors
- [x] Validation schemas: `packages/core/src/schemas/processed-transaction-schemas.ts` with comprehensive Zod schemas
- [x] Database migration: `packages/data/src/migrations/003-processed-transactions.ts` with full schema
- [x] Utility functions: `packages/core/src/utils/zod-utils.ts`
- [x] Golden test data files: `specs/003-replace-universaltransaction-with/golden/`
- [x] **Contract alignment**: Updated all contracts to match implementation (`Money2`, package imports)
- [x] **Data model sync**: Updated `data-model.md` to reflect actual implementation
- [🚀] Contract tests: Ready to execute (T005-T016) - all import/interface issues resolved

**Gate Status**:

- [x] Initial Constitution Check: PASS
- [x] Post-Design Constitution Check: PASS
- [x] All NEEDS CLARIFICATION resolved
- [x] Complexity deviations documented (none required)
- [x] Resume state detected and validated
- [x] **Contract/Implementation Alignment**: RESOLVED - All import paths and interface mismatches fixed
- [🚀] **Ready for Contract Test Execution**: Phase 3.1 foundation complete

---

_Based on Constitution v2.1.1 - See `/memory/constitution.md`_
