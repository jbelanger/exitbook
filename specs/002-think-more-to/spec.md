# Feature Specification: Replace UniversalTransaction with ProcessedTransaction + Purpose Classifier (MVP)

**Feature Branch**: `002-think-more-to`
**Created**: 2025-09-24
**Status**: Draft
**Input**: User description: "Replace UniversalTransaction with ProcessedTransaction + Purpose Classifier"

## Execution Flow (main)

```
1. Parse user description from Input
   � Portfolio app architecture improvement for transaction processing
2. Extract key concepts from description
   � Actors: portfolio users, system processors; Actions: classify transactions, separate concerns; Data: transactions, movements, purposes; Constraints: MVP scope only
3. For each unclear aspect:
   � All key aspects well-defined in original issue
4. Fill User Scenarios & Testing section
   � Clear user scenarios from portfolio import flows
5. Generate Functional Requirements
   � Each requirement derived from acceptance criteria and in-scope items
6. Identify Key Entities
   � ProcessedTransaction, MovementUnclassified, MovementClassified, ClassificationInfo
7. Run Review Checklist
   � SUCCESS: No ambiguities, clear scope boundaries
8. Return: SUCCESS (spec ready for planning)
```

---

## � Quick Guidelines

-  Focus on WHAT users need and WHY
- L Avoid HOW to implement (no tech stack, APIs, code structure)
- =e Written for business stakeholders, not developers
- <� Always declare In Scope and Out of Scope
- =� MoSCoW snapshot required (Must / Should / Could / Won't)
- =� If requirement smells like future work � move to Follow-Up Issues

## In Scope (MVP)

1. **New Data Model Architecture**: Replace ambiguous transaction representation with clear separation of concerns
2. **Purpose Classification System**: Deterministic classifier that identifies why movements occur (PRINCIPAL, FEE, GAS)
3. **Processor Guardrails**: Prevent transaction processors from making classification decisions beyond indisputable cases
4. **Migration Compatibility**: Conversion layer to maintain existing functionality during transition
5. **Limited Domain Support**:
   - One exchange (Kraken) for spot trades
   - One blockchain (Ethereum L1) for simple transfers including gas
6. **Testing Infrastructure**: Golden tests to ensure deterministic behavior

## Out of Scope (Non-Goals)

- Complex DeFi operations (bridges, lending, borrowing, liquidity providing, liquidations)
- NFT transactions, forks, airdrops, governance, staking
- Pricing calculations, cost basis determination, tax export functionality
- User experience changes or confidence-based UX features
- Performance optimizations or service level agreements
- Multi-exchange Verification (MEV) or blockchain reorganization handling
- Expanding to additional venues or blockchain networks

## MoSCoW Priorities

- **Must**: New data contracts, deterministic classifier supporting 3 purposes, processor guardrails, migration shim
- **Should**: Classification metadata including rule ID, version, reasoning, and confidence levels
- **Could**: Support for one additional exchange or blockchain as stretch goal
- **Won't**: All items listed in Non-Goals section above

---

## Clarifications

### Session 2025-09-24

- Q: What criteria determine when a processor can directly set a purpose versus requiring classifier assignment? → A: Only blockchain-native operations (gas fees, mining rewards)
- Q: How should the migration shim handle UniversalTransaction data that cannot be cleanly converted to ProcessedTransaction format? → A: Convert with best-effort mapping and flag as uncertain
- Q: What confidence score threshold should trigger special handling or user attention for classification decisions? → A: No threshold - purely informational metadata
- Q: What level of determinism is required for the golden test validation? → A: Bit-for-bit identical outputs
- Q: When does the backward compatibility transition period end? → A: When all processors are updated to new format

---

## User Scenarios & Testing _(mandatory)_

### Primary User Story

As a portfolio app user, when I import transactions from Kraken or an Ethereum address, the system should clearly separate what money moved (flows) from why it moved (purposes), so that my transaction history is consistently categorized and my portfolio calculations are reliable across different import sources.

### Acceptance Scenarios

1. **Given** a Kraken spot trade with fees, **When** the system processes the transaction, **Then** the classifier identifies PRINCIPAL movements (base/quote asset exchange) and FEE movements separately, while the processor only describes the raw flows
2. **Given** an Ethereum transfer with gas costs, **When** the system processes the transaction, **Then** the classifier identifies the main transfer as PRINCIPAL and gas consumption as GAS, without the processor making purpose decisions
3. **Given** identical raw transaction data processed multiple times, **When** the classification runs, **Then** the output is identical each time (deterministic behavior)
4. **Given** existing UniversalTransaction data, **When** the migration shim runs, **Then** the data converts to ProcessedTransaction format for supported transaction types
5. **Given** a transaction processor attempts to set purpose beyond allowed exceptions, **When** linting/testing runs, **Then** the system prevents the violation and fails the build

### Edge Cases

- Complex multi-leg trades � FOLLOW-UP (out of scope for MVP)
- Cross-chain bridge transactions � FOLLOW-UP (out of scope for MVP)
- Failed transactions with gas consumption � Must handle GAS classification
- Transactions with unusual fee structures � Limited to Kraken patterns only

## Requirements _(mandatory)_

### Functional Requirements [Must align to In Scope]

- **FR-001**: System MUST provide ProcessedTransaction data model that separates movement descriptions from purpose classifications
- **FR-002**: System MUST implement deterministic Purpose Classifier that assigns PRINCIPAL, FEE, or GAS classifications
- **FR-003**: System MUST prevent transaction processors from setting purposes except for blockchain-native operations (e.g., GAS fees, mining rewards)
- **FR-004**: System MUST support Kraken spot trades by classifying base/quote exchanges as PRINCIPAL and fees as FEE
- **FR-005**: System MUST support Ethereum transfers by classifying main transfers as PRINCIPAL and gas usage as GAS
- **FR-006**: System MUST produce bit-for-bit identical classification results when processing the same input data multiple times
- **FR-007**: System MUST provide migration shim to convert UniversalTransaction outputs to ProcessedTransaction format, using best-effort mapping and flagging uncertain conversions
- **FR-008**: System MUST include classification metadata (rule ID, version, reasoning, confidence score 0-1 for informational purposes)
- **FR-009**: System MUST fail builds when processors violate purpose-setting guardrails
- **FR-010**: System MUST maintain backward compatibility until all processors are updated to new format

### Key Entities _(include if feature involves data)_

- **ProcessedTransaction**: Container for transaction data with separated movements and metadata, replaces UniversalTransaction
- **MovementUnclassified**: Raw financial flow data without purpose assignment, output by processors
- **MovementClassified**: Financial flow with assigned purpose (PRINCIPAL/FEE/GAS), output by classifier
- **ClassificationInfo**: Metadata about classification decision including rule ID, version, reasoning, and confidence level
- **PurposeClassifier**: Service that deterministically assigns purposes to movements based on transaction patterns

---

## Review & Acceptance Checklist

### Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

### Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Scope clearly bounded by In/Out of Scope
- [x] MoSCoW priorities included
- [x] No Out of Scope requirements slipped in
- [x] Dependencies and assumptions identified

---

## Execution Status

- [x] User description parsed
- [x] Key concepts extracted
- [x] Ambiguities marked
- [x] User scenarios defined
- [x] Requirements generated
- [x] Entities identified
- [x] Review checklist passed

---
