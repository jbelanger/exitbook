# Tasks: Replace UniversalTransaction with ProcessedTransaction + Purpose Classifier

**Input**: Design documents from `/specs/001-replace-universaltransaction-with/`
**Prerequisites**: research.md, data-model.md, contracts/, quickstart.md

## Execution Flow (main)

```
1. Loaded research.md → tech stack: TypeScript + Zod + Decimal.js, registry patterns
2. Loaded data-model.md → entities: ProcessedTransaction, ClassifiedTransaction, Movement
3. Loaded contracts/ → 4 interface files → contract test tasks
4. Loaded quickstart.md → integration scenarios → test tasks
5. Generated tasks: Setup → Tests → Core → Integration → Polish
6. Applied [P] marking for independent files
7. Tasks numbered T001-T031
8. Dependencies: Tests before implementation (TDD)
```

## Format: `[ID] [P?] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- Include exact file paths in descriptions

## Phase 3.1: Setup

- [x] T001 Create ProcessedTransaction types in packages/core/src/types.ts
- [x] T002 [P] Configure Zod schemas for new types in packages/core/src/validation/
- [x] T003 [P] Setup purpose classifier module structure in packages/import/src/classification/

## Phase 3.2: Tests First (TDD) ⚠️ MUST COMPLETE BEFORE 3.3

**CRITICAL: These tests MUST be written and MUST FAIL before ANY implementation**

### Contract Tests

- [x] T004 [P] Contract test PurposeClassifier interface in packages/import/src/classification/**tests**/purpose-classifier.contract.test.ts
- [x] T005 [P] Contract test ProcessorValidator interface in packages/core/src/validation/**tests**/processor-validator.contract.test.ts
- [x] T006 [P] Contract test ClassifierValidator interface in packages/core/src/validation/**tests**/classifier-validator.contract.test.ts
- [x] T007 [P] Contract test TransformerValidator interface in packages/core/src/validation/**tests**/transformer-validator.contract.test.ts

### Integration Tests

- [x] T008 [P] Integration test ProcessedTransaction pipeline in packages/import/src/**tests**/processed-transaction-pipeline.test.ts
- [x] T009 [P] Integration test purpose classification flow in packages/import/src/**tests**/classification-flow.test.ts
- [x] T010 [P] Integration test backward compatibility shim in packages/import/src/**tests**/compatibility-shim.test.ts
- [x] T011 [P] Integration test multi-leg trade scenario in packages/import/src/**tests**/multi-leg-trade.test.ts

## Phase 3.3: Core Implementation (ONLY after tests are failing)

### Type Definitions and Schemas

- [ ] T012 ProcessedTransaction interface and enums in packages/core/src/types.ts
- [ ] T013 [P] Movement and MovementDirection types in packages/core/src/types.ts
- [ ] T014 [P] ClassifiedTransaction interface in packages/core/src/types.ts
- [ ] T015 [P] Zod schema for ProcessedTransaction in packages/core/src/validation/processed-transaction.schema.ts
- [ ] T016 [P] Zod schema for ClassifiedTransaction in packages/core/src/validation/classified-transaction.schema.ts

### Purpose Classifier Implementation

- [ ] T017 [P] Classification rule interface in packages/import/src/classification/classification-rule.ts
- [ ] T018 [P] Exchange trading rules in packages/import/src/classification/rules/exchange-trading-rules.ts
- [ ] T019 [P] Blockchain transfer rules in packages/import/src/classification/rules/blockchain-transfer-rules.ts
- [ ] T020 [P] Fee classification rules in packages/import/src/classification/rules/fee-classification-rules.ts
- [ ] T021 PurposeClassifier implementation in packages/import/src/classification/purpose-classifier.ts

### Validation Implementation

- [ ] T022 [P] ProcessorValidator implementation in packages/core/src/validation/processor-validator.ts
- [ ] T023 [P] ClassifierValidator implementation in packages/core/src/validation/classifier-validator.ts
- [ ] T024 [P] TransformerValidator implementation in packages/core/src/validation/transformer-validator.ts

## Phase 3.4: Integration

### Backward Compatibility Shim

- [ ] T025 UniversalTransaction compatibility shim in packages/import/src/compatibility/universal-transaction-shim.ts
- [ ] T026 Update existing processors to output ProcessedTransaction in packages/import/src/blockchains/bitcoin/transaction-processor.ts
- [ ] T027 Update exchange processors for new format in packages/import/src/exchanges/kraken/transaction-processor.ts

### Pipeline Integration

- [ ] T028 Wire classification pipeline in import service in packages/import/src/services/import-service.ts
- [ ] T029 Add classification metrics and logging in packages/import/src/classification/classification-metrics.ts

## Phase 3.5: Polish

- [ ] T030 [P] Unit tests for classification rules in packages/import/src/classification/rules/**tests**/
- [ ] T031 [P] Performance benchmark tests for classification pipeline in packages/import/src/**tests**/performance.test.ts

## Dependencies

- Setup (T001-T003) before tests (T004-T011)
- Contract tests (T004-T007) before implementation (T012-T029)
- Integration tests (T008-T011) before implementation (T012-T029)
- Type definitions (T012-T016) block classifier implementation (T017-T021)
- T021 blocks T025-T029 (shim and integration depend on classifier)
- All implementation before polish (T030-T031)

## Parallel Example

```
# Launch contract tests together:
Task: "Contract test PurposeClassifier interface in packages/import/src/classification/__tests__/purpose-classifier.contract.test.ts"
Task: "Contract test ProcessorValidator interface in packages/core/src/validation/__tests__/processor-validator.contract.test.ts"
Task: "Contract test ClassifierValidator interface in packages/core/src/validation/__tests__/classifier-validator.contract.test.ts"
Task: "Contract test TransformerValidator interface in packages/core/src/validation/__tests__/transformer-validator.contract.test.ts"
```

## Key Implementation Notes

### From Research Analysis

- Extend existing TypeScript + Zod + Decimal.js patterns
- Use existing `@RegisterApiClient` decorator pattern for new processors
- Maintain backward compatibility with time-boxed shims (1-2 sprints)
- Follow three-stage pipeline: Processor → Classifier → Transformer

### From Data Model Analysis

- ProcessedTransaction replaces UniversalTransaction with movement-based model
- ID uniqueness per (source, sourceUid, id) tuple to avoid cross-account collisions
- Direction relative to user's targeted account/scope
- Comprehensive MovementPurpose enum for business classification

### From Contract Analysis

- 4 interface contracts require implementation and testing
- PurposeClassifier with deterministic classification (no I/O dependencies)
- Multi-level validation: processor-time, classifier-time, transformer-time
- Classification rules with confidence scoring and audit trails

### From Quickstart Analysis

- Support complex multi-leg transactions (trades + fees + gas)
- Background batch processing acceptable (minutes latency)
- Validation includes zero-sum transfers, confidence thresholds
- Performance benchmarks: <100ms per transaction, <50MB for 1000 transactions

## Validation Checklist

_GATE: Checked before considering implementation complete_

- [x] All contracts (4 interfaces) have corresponding tests (T004-T007)
- [x] All entities (ProcessedTransaction, ClassifiedTransaction, Movement) have model tasks (T012-T016)
- [x] All tests come before implementation (T004-T011 before T012-T029)
- [x] Parallel tasks truly independent (different files, marked [P])
- [x] Each task specifies exact file path
- [x] No task modifies same file as another [P] task
- [x] TDD approach: tests must fail before implementation
- [x] Integration scenarios from quickstart covered (T008-T011)
- [x] Backward compatibility requirements addressed (T025-T027)
