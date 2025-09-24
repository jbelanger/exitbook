# Feature Specification: Replace UniversalTransaction with ProcessedTransaction + Purpose Classifier (MVP)

**Feature Branch**: `003-replace-universaltransaction-with`
**Created**: 2025-09-24
**Status**: Draft
**Input**: User description: "Replace `UniversalTransaction` with `ProcessedTransaction` + Purpose Classifier (MVP)"

## Execution Flow (main)

```
1. Parse user description from Input
   �  Feature description provided with detailed GitHub issue
2. Extract key concepts from description
   �  Identified: transaction processing, purpose classification, data separation, MVP scope
3. For each unclear aspect:
   � No major ambiguities - GitHub issue well-defined with explicit scope
4. Fill User Scenarios & Testing section
   �  Clear user flows for transaction import and processing
5. Generate Functional Requirements
   �  Each requirement testable and aligned to acceptance criteria
6. Identify Key Entities (if data involved)
   �  ProcessedTransaction, MovementUnclassified, MovementClassified, ClassificationInfo
7. Run Review Checklist
   �  No scope creep, focused on MVP user value
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

- **Data Structure Redesign**: Replace ambiguous transaction representation with explicit flow-based model
- **Purpose Classification**: Introduce deterministic classifier for transaction movement purposes (PRINCIPAL, FEE, GAS only)
- **Separation of Concerns**: Distinguish between "what happened" (money flows) vs "why it happened" (purposes) vs "how to book it" (accounting)
- **Limited Domain Support**: Spot trades on Kraken exchange and simple transfers on Ethereum L1 including gas fees
- **Clean Implementation**: Build new transaction processing system without legacy migration concerns
- **Quality Assurance**: Deterministic processing with consistent outcomes across runs

## Out of Scope (Non-Goals)

- **Complex DeFi Operations**: Bridges, lending/borrowing, liquidity pools, liquidations
- **Advanced Asset Types**: NFTs, governance tokens, staking rewards
- **Corporate Events**: Forks, airdrops, token migrations
- **Financial Features**: Pricing integration, cost basis calculation, tax reporting
- **Performance Optimizations**: Confidence-based UX, SLA requirements, reorg handling
- **Multi-Venue Expansion**: Support beyond Kraken + Ethereum L1

## MoSCoW Priorities

- **Must**: Core data contracts, deterministic classifier (3 purposes), processing guardrails
- **Should**: Classification metadata (rule tracking, versioning, confidence scoring)
- **Could**: Support for one additional exchange or blockchain as stretch goal
- **Won't**: Everything listed in Out of Scope section above

---

## User Scenarios & Testing _(mandatory)_

### Primary User Story

As a crypto portfolio user, I need my imported transactions to be processed consistently and accurately, so that I can trust my portfolio calculations and understand the purpose of each money movement. The system should clearly distinguish between the actual money flows that occurred versus the business reasons why they occurred, enabling reliable accounting downstream.

### Acceptance Scenarios

1. **Given** a user imports a Kraken spot trade with fee, **When** the transaction is processed, **Then** the system identifies PRINCIPAL movements (buy/sell) and FEE movements separately with high confidence
2. **Given** a user imports an Ethereum transfer, **When** the transaction is processed, **Then** the system identifies the transfer as PRINCIPAL and the gas cost as GAS movement
3. **Given** the same transaction data is processed multiple times, **When** classification runs, **Then** identical outputs are produced every time (deterministic)
4. **Given** a transaction fails validation rules, **When** the system processes it, **Then** clear error messages indicate specific validation failures
5. **Given** a processor attempts to set purpose beyond allowed exceptions, **When** validation runs, **Then** the system prevents the operation and logs a violation

### Edge Cases

- **Multi-leg transactions**: Complex trades with multiple fees or components [FOLLOW-UP: Advanced trade types]
- **Failed transactions**: Gas paid but transaction reverted [FOLLOW-UP: Failed transaction handling]
- **Cross-chain operations**: Transactions spanning multiple blockchains [FOLLOW-UP: Bridge support]

## Requirements _(mandatory)_

### Functional Requirements [Must align to In Scope]

- **FR-001**: System MUST process Kraken spot trade transactions into separate PRINCIPAL and FEE movements
- **FR-002**: System MUST process Ethereum transfers into PRINCIPAL movements and gas payments into GAS movements
- **FR-003**: System MUST classify movements using only three supported purposes: PRINCIPAL, FEE, GAS
- **FR-004**: System MUST produce identical classification results when processing the same input data multiple times
- **FR-005**: System MUST prevent transaction processors from setting purpose fields except for indisputable cases (e.g., gas fees)
- **FR-006**: System MUST include classification metadata (rule ID, version, reasoning, confidence score 0-1) with each classified movement, accepting all confidence levels
- **FR-007**: System MUST validate that all movements balance correctly within each transaction and reject entire transaction if validation fails
- **FR-010**: System MUST fail gracefully when encountering unsupported transaction types outside the MVP scope

### Key Entities _(include if feature involves data)_

- **ProcessedTransaction**: Represents a complete financial event with multiple money movements, timestamp, source identifiers, and validation status
- **MovementUnclassified**: Individual money flow within a transaction before purpose classification (amount as Decimal, asset, direction, participant)
- **MovementClassified**: Movement after purpose classification including purpose assignment and classification metadata (amount as Decimal)
- **ClassificationInfo**: Metadata about how purpose was determined (rule ID, classifier version with historical preservation, reasoning text, confidence score 0-1)

## Clarifications

### Session 2025-09-24

- Q: Migration Strategy for Legacy Data → A: No legacy data is present
- Q: Error Handling for Invalid Movements → A: Reject entire transaction and log error for manual review
- Q: Confidence Score Thresholds → A: Accept all classifications regardless of confidence score
- Q: Asset Amount Precision Requirements → A: Decimal, 18+ digits, stored as strings
- Q: Classification Rule Versioning Strategy → A: Mark rule changes with version bumps, preserve historical classifications

---

## Review & Acceptance Checklist

_GATE: Automated checks run during main() execution_

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

_Updated by main() during processing_

- [x] User description parsed
- [x] Key concepts extracted
- [x] Ambiguities marked
- [x] User scenarios defined
- [x] Requirements generated
- [x] Entities identified
- [x] Review checklist passed

---
