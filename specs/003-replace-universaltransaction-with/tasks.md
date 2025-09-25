# Tasks: Replace UniversalTransaction with ProcessedTransaction + Purpose Classifier (MVP)

**Input**: Design documents from `/Users/joel/Dev/crypto-portfolio-before-nestjs/specs/003-replace-universaltransaction-with/`
**Prerequisites**: plan.md ✅, research.md ✅, data-model.md ✅, contracts/ ✅

## Execution Flow (main)

```
1. ✅ Load plan.md from feature directory
   → Tech stack: TypeScript, Decimal.js, neverthrow, Zod, Vitest
   → Structure: Monorepo packages (core, import, data)
2. ✅ Load design documents:
   → data-model.md: 8 entities, 2 services, repository interfaces
   → contracts/: 7 CQRS commands/queries + handlers
   → research.md: MVP scope, validation rules, database schema
   → quickstart.md: 5 integration test scenarios
3. ✅ Generate tasks by category:
   → Setup: TypeScript project, database schema, validation pipeline
   → Tests: 7 contract tests, 5 integration tests (TDD approach)
   → Core: 8 entities, 2 services, 7 CQRS handlers
   → Integration: SQLite repositories, classification rules, validation
   → Polish: Unit tests, performance validation, cleanup
4. ✅ Apply task rules:
   → Different files = [P] parallel execution
   → Same file = sequential dependencies
   → Tests before implementation (TDD mandatory)
5. ✅ Number tasks sequentially (T001, T002...)
6. ✅ Generate dependency graph and parallel examples
```

## Format: `[ID] [P?] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- Include exact file paths in descriptions

## Path Conventions

- **Monorepo structure**: `packages/core/`, `packages/import/`, `packages/data/`
- **Core types**: `packages/core/src/types/`
- **Services**: `packages/import/src/services/` and `packages/data/src/repositories/`
- **Tests**: Colocated in `__tests__/` directories

## Phase 3.1: Setup (Foundation)

- [x] T001 Create TypeScript interfaces and types in packages/core/src/types/
- [x] T002 [P] Add database migration script for ProcessedTransaction tables in packages/data/migrations/
- [x] T003 [P] Configure Zod validation schemas in packages/core/src/schemas/
- [x] T004 [P] Set up test golden data files in specs/003-replace-universaltransaction-with/golden/

## Phase 3.2: Tests First (TDD) ⚠️ MUST COMPLETE BEFORE 3.3

**CRITICAL: These tests MUST be written and MUST FAIL before ANY implementation**

### 🔥 MVP Must-Have Tests (Priority 1)

**These 8 tests are essential - complete these first if time is constrained:**

- T005, T006, T007 (command contracts)
- T011 (CSV shim), T012 (Kraken), T013 (Ethereum)
- T014 (determinism), T015 (fail-fast validation)

### 📋 Additional Coverage (Priority 2)

**Complete if time allows, defer if needed:**

- T008, T009, T010 (query contracts)
- T016 (query operations integration)

### Contract Tests (Commands)

- [x] T005 [P] Contract test ProcessTransactionCommand with idempotency (handlers replay-safe, infra dedup before execution) in packages/import/src/app/commands/**tests**/ProcessTransactionCommand.test.ts
- [x] T006 [P] Contract test ClassifyMovementsCommand (idempotency, handler injects current version when rulesetVersion absent, assert events include version) in packages/import/src/app/commands/**tests**/ClassifyMovementsCommand.test.ts
- [x] T007 [P] Contract test ValidateTransactionCommand with idempotency in packages/import/src/app/commands/**tests**/ValidateTransactionCommand.test.ts

### Contract Tests (Queries)

- [x] T008 [P] Contract test GetClassifiedTransactionQuery (NOT_FOUND returns err(RepositoryError), not ok(undefined)) in packages/import/src/app/queries/**tests**/GetClassifiedTransactionQuery.test.ts
- [x] T009 [P] Contract test GetMovementsByPurposeQuery with pagination in packages/import/src/app/queries/**tests**/GetMovementsByPurposeQuery.test.ts
- [x] T010 [P] Contract test GetTransactionsBySourceQuery with pagination in packages/import/src/app/queries/**tests**/GetTransactionsBySourceQuery.test.ts

### Integration Tests

- [x] T011 [P] Integration test UniversalTransaction-to-ProcessedTransaction conversion bridge for legacy CSV import compatibility in packages/import/src/**tests**/integration/universal-transaction-bridge.test.ts
- [x] T012 [P] Integration test Kraken trade classification with golden fixtures (byte-identical outputs) in packages/import/src/**tests**/integration/kraken-trade-classification.test.ts
- [x] T013 [P] Integration test Ethereum transfer classification with golden fixtures in packages/import/src/**tests**/integration/ethereum-transfer-classification.test.ts
- [x] T014 [P] Integration test deterministic processing (golden fixtures, byte-identical across runs) in packages/import/src/**tests**/integration/deterministic-processing.test.ts
- [x] T015 [P] Integration test validation failure handling (validate classified movements: trade principals balance by currency + fees OUT, transfer principals net zero + gas OUT, full tx rejection on any failure) in packages/import/src/**tests**/integration/validation-failure.test.ts
- [x] T016 [P] Integration test transaction query operations in packages/data/src/**tests**/integration/transaction-queries.test.ts

## Phase 3.3: Core Implementation (ONLY after tests are failing)

### Core Types and Entities

- [x] T017 [P] ProcessedTransaction type in packages/core/src/types/ProcessedTransaction.ts
- [x] T018 [P] ClassifiedTransaction type in packages/core/src/types/ClassifiedTransaction.ts
- [x] T019 [P] MovementUnclassified type in packages/core/src/types/MovementUnclassified.ts
- [x] T020 [P] MovementClassified type in packages/core/src/types/MovementClassified.ts
- [x] T021 [P] Money value object in packages/core/src/types/Money.ts
- [x] T022 [P] SourceDetails type in packages/core/src/types/SourceDetails.ts
- [x] T023 [P] ClassificationInfo type in packages/core/src/types/ClassificationInfo.ts
- [x] T024 [P] Error types hierarchy in packages/core/src/errors/

### CQRS Command Handlers

- [x] T025 [P] ProcessTransactionCommandHandler implementation in packages/import/src/app/commands/ProcessTransactionCommandHandler.ts
- [x] T026 [P] ClassifyMovementsCommandHandler implementation in packages/import/src/app/commands/ClassifyMovementsCommandHandler.ts
- [x] T027 [P] ValidateTransactionCommandHandler implementation in packages/import/src/app/commands/ValidateTransactionCommandHandler.ts

### CQRS Query Handlers

- [ ] T028 [P] GetClassifiedTransactionQueryHandler implementation in packages/import/src/app/queries/GetClassifiedTransactionQueryHandler.ts
- [ ] T029 [P] GetMovementsByPurposeQueryHandler implementation in packages/import/src/app/queries/GetMovementsByPurposeQueryHandler.ts
- [ ] T030 [P] GetTransactionsBySourceQueryHandler implementation in packages/import/src/app/queries/GetTransactionsBySourceQueryHandler.ts

### Core Services

- [ ] T031 PurposeClassifier service with MVP rules in packages/import/src/services/PurposeClassifier.ts
- [ ] T032 TransactionValidator service with balance rules in packages/import/src/services/TransactionValidator.ts

## Phase 3.4: Integration (Database and Validation)

### Repository Implementation

- [ ] T033 ProcessedTransactionRepository implementation in packages/data/src/repositories/ProcessedTransactionRepository.ts
- [ ] T034 ClassifiedTransactionRepository implementation in packages/data/src/repositories/ClassifiedTransactionRepository.ts
- [ ] T035 Database schema creation and migration execution in packages/data/src/migrations/003-processed-transactions.ts

### Classification Rules and Validation

- [ ] T036 [P] MVP classification rules implementation in packages/import/src/services/classification-rules/
- [ ] T037 [P] Balance validation rules implementation in packages/import/src/services/validation-rules/
- [ ] T038 UniversalTransactionBridge implementation for converting legacy CSV imports to ProcessedTransaction format in packages/import/src/bridges/UniversalTransactionBridge.ts

### Processor Integration

- [ ] T039 Update KrakenProcessor to emit ProcessedTransaction (unclassified movements only, NO classifier calls) in packages/import/src/exchanges/kraken/processors/
- [ ] T040 Update EthereumProcessor to emit ProcessedTransaction (unclassified movements only, NO classifier calls) in packages/import/src/blockchains/ethereum/processors/

## Phase 3.5: Polish (Testing and Performance)

### Unit Tests

- [ ] T041 [P] Unit tests for PurposeClassifier rules in packages/import/src/services/**tests**/PurposeClassifier.test.ts
- [ ] T042 [P] Unit tests for TransactionValidator rules in packages/import/src/services/**tests**/TransactionValidator.test.ts
- [ ] T043 [P] Unit tests for Money value object operations in packages/core/src/types/**tests**/Money.test.ts
- [ ] T044 [P] Unit tests for UniversalTransactionBridge conversions in packages/import/src/bridges/**tests**/UniversalTransactionBridge.test.ts
- [ ] T045 [P] Unit tests for event shapes (MovementsClassifiedEvent includes ruleId, confidence for every movement) in packages/import/src/app/commands/**tests**/event-shapes.test.ts

### Validation and Cleanup

- [ ] T046 Run quickstart integration scenarios validation in specs/003-replace-universaltransaction-with/validate-quickstart.ts
- [ ] T047 Validate deterministic processing with golden test data
- [ ] T048 Clean up any remaining UniversalTransaction references in non-MVP scope
- [ ] T049 [P] Integration test: unsupported transaction patterns are rejected with DomainError.UnsupportedTransaction and logged (no partial writes) in packages/import/src/**tests**/integration/unsupported-transaction-rejection.test.ts
- [ ] T050 [P] Processor compliance tests: verify processors never set purposes in packages/import/src/exchanges/kraken/processors/**tests**/kraken-processor-compliance.test.ts and packages/import/src/blockchains/ethereum/processors/**tests**/ethereum-processor-compliance.test.ts (asserts: every emitted movement is UNCLASSIFIED with no purpose/classification fields; optional hint only allowed: GAS on Ethereum L1 fee leg)

## Dependencies

### Critical Path Dependencies

- Setup (T001-T004) → All other tasks
- Tests (T005-T016) → Implementation (T017-T040)
- Core types (T017-T024) → Services and handlers (T025-T032)
- Services (T031-T032) → Integration (T033-T040)
- Implementation complete → Polish (T041-T049)

### Intra-Phase Dependencies

- T017-T024 (types) must complete before T025-T030 (handlers use types)
- T031-T032 (services) before T033-T034 (repositories use services)
- T035 (database) before T033-T034 (repositories need schema)
- T036-T037 (rules) before T031-T032 (services use rules)

### Same-File Conflicts (Sequential Only)

- T039 and T040 may modify similar processor base classes (not [P])
- T033 and T034 may share repository base class patterns (not [P])

## Parallel Execution Examples

### Phase 3.2: Launch all contract tests together

```bash
# Launch T005-T010 together (different files, no dependencies):
Task: "Contract test ProcessTransactionCommand in packages/import/src/app/commands/__tests__/ProcessTransactionCommand.test.ts"
Task: "Contract test ClassifyMovementsCommand in packages/import/src/app/commands/__tests__/ClassifyMovementsCommand.test.ts"
Task: "Contract test ValidateTransactionCommand in packages/import/src/app/commands/__tests__/ValidateTransactionCommand.test.ts"
Task: "Contract test GetClassifiedTransactionQuery in packages/import/src/app/queries/__tests__/GetClassifiedTransactionQuery.test.ts"
Task: "Contract test GetMovementsByPurposeQuery in packages/import/src/app/queries/__tests__/GetMovementsByPurposeQuery.test.ts"
Task: "Contract test GetTransactionsBySourceQuery in packages/import/src/app/queries/__tests__/GetTransactionsBySourceQuery.test.ts"
```

### Phase 3.2: Launch all integration tests together

```bash
# Launch T011-T015 together (different scenarios, independent):
Task: "Integration test Kraken trade classification in packages/import/src/__tests__/integration/kraken-trade-classification.test.ts"
Task: "Integration test Ethereum transfer classification in packages/import/src/__tests__/integration/ethereum-transfer-classification.test.ts"
Task: "Integration test deterministic processing in packages/import/src/__tests__/integration/deterministic-processing.test.ts"
Task: "Integration test validation failure handling in packages/import/src/__tests__/integration/validation-failure.test.ts"
Task: "Integration test transaction query operations in packages/data/src/__tests__/integration/transaction-queries.test.ts"
```

### Phase 3.3: Launch core types together

```bash
# Launch T017-T024 together (different type files, no cross-dependencies):
Task: "ProcessedTransaction type in packages/core/src/types/ProcessedTransaction.ts"
Task: "ClassifiedTransaction type in packages/core/src/types/ClassifiedTransaction.ts"
Task: "MovementUnclassified type in packages/core/src/types/MovementUnclassified.ts"
Task: "MovementClassified type in packages/core/src/types/MovementClassified.ts"
Task: "Money value object in packages/core/src/types/Money.ts"
Task: "SourceDetails type in packages/core/src/types/SourceDetails.ts"
Task: "ClassificationInfo type in packages/core/src/types/ClassificationInfo.ts"
Task: "Error types hierarchy in packages/core/src/errors/"
```

### Phase 3.5: Launch unit tests together

```bash
# Launch T041-T044 together (different test files, independent validation):
Task: "Unit tests for PurposeClassifier rules in packages/import/src/services/__tests__/PurposeClassifier.test.ts"
Task: "Unit tests for TransactionValidator rules in packages/import/src/services/__tests__/TransactionValidator.test.ts"
Task: "Unit tests for Money value object operations in packages/core/src/types/__tests__/Money.test.ts"
Task: "Unit tests for UniversalTransactionBridge conversions in packages/import/src/bridges/__tests__/UniversalTransactionBridge.test.ts"
```

## Notes

- **[P] tasks**: Different files, no dependencies - can execute simultaneously
- **TDD requirement**: All tests (T005-T015) must be written and FAIL before implementation starts
- **MVP scope**: Only Kraken exchange and Ethereum blockchain support
- **Deterministic requirement**: Same input must produce identical classification results
- **Balance validation**: Fail-fast approach - reject entire transaction if validation fails
- **Financial precision**: Use Decimal.js for all monetary calculations (18+ decimal places)

## Validation Checklist

_GATE: Checked before task execution_

- [x] All 6 contracts have corresponding contract tests (T005-T010)
- [x] All 8 entities have model implementation tasks (T017-T024)
- [x] All tests come before implementation (T005-T016 before T017-T047)
- [x] Parallel tasks are truly independent (different files, no shared state)
- [x] Each task specifies exact file path for implementation
- [x] No task modifies same file as another [P] task
- [x] MVP scope constraints enforced (Kraken + Ethereum only)
- [x] Deterministic processing requirements captured in integration tests
- [x] TDD approach: failing tests mandatory before implementation

## Task Execution Summary

**Total Tasks**: 50 tasks
**Parallel Opportunities**: 35 tasks can run in parallel across different phases
**Sequential Dependencies**: 15 critical path tasks
**Estimated Completion**: 2-3 development cycles with parallel execution

**Test-First Approach**: 15 test tasks (T005-T016, T041-T045, T049-T050) ensure comprehensive coverage before and after implementation.

**MVP Constraints**: Tasks explicitly limited to Kraken spot trades and Ethereum transfers only, avoiding scope creep into DeFi, NFTs, or advanced blockchain features.
