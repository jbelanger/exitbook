# Feature Specification: Replace UniversalTransaction with ProcessedTransaction + Purpose Classifier

**Feature Branch**: `001-replace-universaltransaction-with`
**Created**: 2025-09-23
**Status**: Draft
**Input**: User description: "Replace UniversalTransaction with ProcessedTransaction + Purpose Classifier - This PR updates our ingestion/ETL documentation and contracts to replace the ambiguous UniversalTransaction with a more explicit intermediate model, ProcessedTransaction, and introduces a Movement Purpose Classifier stage. The goal is to separate what happened (money flows) from why it happened (purpose) and how to book it (accounting rules), reducing ambiguity and brittleness in processors and improving downstream consistency."

## Execution Flow (main)
```
1. Parse user description from Input
   � Key concept: Replace ambiguous transaction model with clearer separation of concerns
2. Extract key concepts from description
   � Actors: Transaction processors, purpose classifier, accounting transformer
   � Actions: Process transactions, classify movement purposes, transform for accounting
   � Data: Financial movements, transaction metadata, classification rules
   � Constraints: Deterministic classification, backward compatibility, audit trails
3. For each unclear aspect:
   � Migration timeline needs clarification
   � Performance requirements unclear
   � Validation rule specifics need definition
4. Fill User Scenarios & Testing section
   � Clear flow: processor outputs flows � classifier assigns purposes � transformer applies accounting
5. Generate Functional Requirements
   � All requirements testable through data validation and pipeline verification
6. Identify Key Entities
   � ProcessedTransaction, Movement, ClassifiedTransaction, PurposeClassifier
7. Run Review Checklist
   � Some clarifications needed on implementation timeline and performance targets
8. Return: SUCCESS (spec ready for planning with noted clarifications)
```

---

## � Quick Guidelines
-  Focus on WHAT users need and WHY
- L Avoid HOW to implement (no tech stack, APIs, code structure)
- =e Written for business stakeholders, not developers

---

## Clarifications

### Session 2025-09-23
- Q: What is the acceptable migration timeline for transitioning from UniversalTransaction to ProcessedTransaction? → A: 1-2 sprints (rapid migration with focused effort)
- Q: What performance targets must the purpose classifier meet for classification processing? → A: Background processing acceptable (minutes for large batches)
- Q: What should trigger a migration rollback if issues are discovered? → A: No rollback, we go all in
- Q: What volume of historical transactions must the system handle for reprocessing? → A: Per-user reprocessing support needed

---

## User Scenarios & Testing *(mandatory)*

### Primary User Story
As a transaction data processor, I need to process financial transactions from various sources (exchanges, blockchains) into a consistent format that separates the factual money movements from their business purposes, so that accounting rules can be applied uniformly and auditably without processors needing to understand complex accounting semantics.

### Acceptance Scenarios
1. **Given** a complex multi-leg transaction (e.g., trade with separate network fee), **When** the processor handles it, **Then** it outputs distinct movements for principal amounts and fees without making accounting decisions
2. **Given** processed transactions from multiple sources, **When** the purpose classifier processes them, **Then** each movement receives a definitive purpose classification with audit metadata
3. **Given** classified transactions, **When** the accounting transformer processes them, **Then** proper accounting entries are generated following business rules
4. **Given** an existing UniversalTransaction processor, **When** migration occurs, **Then** the system continues to function through compatibility shims during transition
5. **Given** classification rules are updated, **When** historical transactions are reprocessed, **Then** the system maintains version tracking for audit purposes

### Edge Cases
- What happens when a movement cannot be confidently classified (low confidence score)?
- How does the system handle new transaction types not covered by existing classification rules?
- What occurs when source data is incomplete or contains conflicting information?
- How are multi-currency transactions with complex fee structures processed?

## Requirements *(mandatory)*

### Functional Requirements
- **FR-001**: System MUST separate transaction processing into distinct stages: flow description, purpose classification, and accounting transformation
- **FR-002**: Processors MUST output only factual money movements without making accounting decisions or purpose assignments
- **FR-003**: Purpose classifier MUST assign a definitive MovementPurpose to every movement using deterministic rules
- **FR-004**: System MUST maintain audit trails including classification rule versions, confidence scores, and source transaction metadata
- **FR-005**: System MUST support backward compatibility through shims that convert UniversalTransaction to ProcessedTransaction format
- **FR-006**: Classification rules MUST be venue-aware and chain-aware to handle context-specific scenarios
- **FR-007**: System MUST validate transaction consistency at processor-time (e.g., zero-sum transfers) and transformer-time (valued requirements)
- **FR-008**: System MUST track observability metrics including rule usage, confidence distributions, and classification drift
- **FR-009**: System MUST support incremental migration of existing processors without disrupting active data flows
- **FR-010**: Purpose classifier MUST operate without external dependencies (no I/O, no pricing lookups) for deterministic results
- **FR-011**: System MUST support extension of MovementPurpose enum without breaking existing classifications
- **FR-012**: System MUST link related movements within transactions (e.g., principal to associated fees) through metadata

### Migration & Performance Requirements
- **MR-001**: System MUST support dual-path processing during 1-2 sprint migration period with rapid transition approach
- **MR-002**: Migration uses bridge pattern for compile-time compatibility only, with full commitment to new architecture (no rollback strategy)
- **PR-001**: Classification processing MUST support background batch processing with acceptable completion times in minutes for large transaction volumes
- **PR-002**: System MUST support per-user transaction reprocessing when classification rules are updated or user requests reanalysis

### Key Entities *(include if feature involves data)*
- **ProcessedTransaction**: Represents factual money movements with source metadata and event context, without accounting interpretations
- **Movement**: Individual asset flow with currency, quantity, direction, and optional classification hints
- **ClassifiedTransaction**: ProcessedTransaction with finalized movement purposes and classification metadata
- **PurposeClassifier**: Service that applies deterministic rules to assign movement purposes based on transaction context
- **MovementPurpose**: Enumeration of business purposes (principal, fee, gas, reward, interest, collateral, etc.)
- **ClassificationInfo**: Audit metadata including rule identifier, confidence score, reasoning, and version tracking
- **SourceDetails**: Tagged union capturing source-specific metadata (exchange orders, blockchain transactions)

---

## Review & Acceptance Checklist
*GATE: Automated checks run during main() execution*

### Content Quality
- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

### Requirement Completeness
- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

---

## Execution Status
*Updated by main() during processing*

- [x] User description parsed
- [x] Key concepts extracted
- [x] Ambiguities marked
- [x] User scenarios defined
- [x] Requirements generated
- [x] Entities identified
- [x] Review checklist passed

---