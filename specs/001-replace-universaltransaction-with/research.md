# Research: Replace UniversalTransaction with ProcessedTransaction + Purpose Classifier

**Date**: 2025-09-23
**Feature**: Replace UniversalTransaction with ProcessedTransaction + Purpose Classifier
**Status**: Complete

## Current Architecture Analysis

### Existing UniversalTransaction Structure

**Location**: `packages/core/src/types.ts:233-256`

The current `UniversalTransaction` interface combines:

- Basic transaction metadata (id, timestamp, source)
- Financial amounts (amount, fee, price as Money objects)
- Transaction semantics (type: TransactionType, status)
- Source-specific metadata (from/to addresses, network info)
- Business logic hints (type classification, notes)

**Problems Identified**:

1. **Mixed Concerns**: Combines raw financial flows with accounting decisions
2. **Limited Multi-leg Support**: Single amount/fee structure cannot represent complex transactions
3. **Processor Complexity**: Forces processors to make accounting decisions they shouldn't
4. **Inconsistent Classification**: Each processor applies different business logic

### Current Usage Patterns

**Files Analyzed**: 36 files using UniversalTransaction

**Key Processor Types**:

- Exchange processors (Kraken, Coinbase, KuCoin, LedgerLive)
- Blockchain processors (Bitcoin, Ethereum, Solana, Polkadot, Injective, Avalanche)
- Universal adapters (CCXT, CSV, native APIs)

**Current Flow**:
`Adapter → Processor → UniversalTransaction → Storage/Transform`

## Technology Stack Decisions

### Decision: Keep TypeScript + Zod Validation

**Rationale**:

- Existing codebase uses TypeScript 5.9.2 with comprehensive Zod schemas
- Strong type safety for financial data critical for correctness
- Runtime validation prevents data corruption
  **Alternatives Considered**: None - requirement to maintain existing patterns
  **Implementation**: Extend existing validation patterns in `packages/core/src/validation/`

### Decision: Use Decimal.js for Financial Precision

**Rationale**:

- Already established pattern in codebase (Money interface uses Decimal)
- Critical for cryptocurrency amounts with high precision requirements
- Prevents floating-point precision errors in financial calculations
  **Alternatives Considered**: BigNumber.js (rejected - not already in use)
  **Implementation**: Follow existing Money interface patterns with DecimalString serialization

### Decision: Use neverthrow Result Types for Error Handling

**Rationale**:

- Existing codebase extensively uses neverthrow Result<T, E> pattern for functional error handling
- Processors, mappers, and importers all return Result types instead of throwing exceptions
- Type-safe error handling prevents uncaught exceptions and improves reliability
- Enables composable error handling with map/mapErr/andThen operations
  **Alternatives Considered**: Exception-based error handling (rejected - inconsistent with existing patterns)
  **Implementation**: All validation, classification, and processing functions return Result<Success, Error> types

### Decision: Use Existing Metadata-Driven Registry Pattern (No Changes)

**Rationale**:

- Existing `@RegisterApiClient` decorator pattern works perfectly for ProcessedTransaction
- Current registry in `packages/import/src/blockchains/shared/registry/` supports new types
- No architectural changes needed - only add new processor types
  **Alternatives Considered**: New registry system (rejected - unnecessary complexity)
  **Implementation**: Extend existing processors to output ProcessedTransaction instead of UniversalTransaction

## New Architecture Design Decisions

### Decision: Three-Stage Pipeline

**New Flow**: `Processor → ProcessedTransaction → Classifier → ClassifiedTransaction → Transformer`

**Rationale**:

- Clear separation of concerns: processors describe flows, classifier assigns purposes, transformer applies accounting
- Deterministic classification enables reproducible audits
- Reduces processor complexity and maintenance burden
  **Alternatives Considered**:
- Two-stage (rejected - still mixes concerns)
- Four-stage with separate validation (rejected - over-engineering)

### Decision: Movement-Based Transaction Model

**Rationale**:

- Supports complex multi-leg transactions (trades + fees + gas)
- Each movement has clear direction (IN/OUT) and purpose classification
- Enables precise audit trails for regulatory compliance
  **Alternatives Considered**:
- Maintain single amount/fee structure (rejected - insufficient for complex scenarios)
- Account-based model (rejected - too complex for initial implementation)

### Decision: Comprehensive MovementPurpose Enum

**Rationale**:

- Covers all known transaction types across exchanges and blockchains
- Extensible design minimizes "OTHER" classifications
- Venue-aware and chain-aware classification rules
  **Alternatives Considered**:
- Simple purpose categories (rejected - insufficient granularity)
- Open-ended string purposes (rejected - inconsistent classification)

### Decision: Time-Boxed Backward Compatibility Shims (Updated)

**Rationale**:

- FR-005 mandates backward compatibility through shims during transition
- User clarification: "keep a time-boxed shim (1-2 sprints) to decouple provider refactors from transformer work"
- Bridge pattern provides compile-time compatibility without permanent maintenance burden
- Enables "all-in" commitment after transition period
  **Alternatives Considered**:
- Complete replacement (conflicts with FR-005 requirement)
- Permanent dual-path processing (rejected - adds ongoing complexity)
  **Implementation**: Shim converts UniversalTransaction → ProcessedTransaction during 1-2 sprint migration window

## Performance Considerations

### Decision: Background Batch Processing

**Rationale**:

- Classification can be computationally intensive for large transaction volumes
- Acceptable latency (minutes) for batch processing according to requirements
- Enables optimization opportunities (caching, parallel processing)
  **Implementation**: Async processing with progress tracking

### Decision: Deterministic Classification (No I/O)

**Rationale**:

- Ensures reproducible results for auditing
- Prevents external dependencies from affecting classification consistency
- Enables fast batch processing without API rate limits
  **Constraints**: Classification rules must be context-based only (venue, chain, transaction patterns)

## Validation Strategy

### Decision: Multi-Level Validation

**Processor-time**: Fast consistency checks (zero-sum transfers, required fields)
**Classifier-time**: Purpose assignment validation (all movements classified)
**Transformer-time**: Business rule validation (valued constraints, cost basis)

**Rationale**: Separates technical validation from business validation, enables early error detection
**Implementation**: Extend existing Zod schema patterns with custom validators

## Migration Strategy

### Decision: Dual-Path Migration with Time-Boxed Shims

**Approach**:

1. Implement ProcessedTransaction types and pipeline alongside existing UniversalTransaction
2. Create backward compatibility shims (UniversalTransaction ↔ ProcessedTransaction)
3. Migrate processors incrementally using bridge pattern for compile-time compatibility
4. Remove shims and UniversalTransaction after 1-2 sprint time-box expires
5. Complete transition to ProcessedTransaction-only architecture

**Rationale**:

- Satisfies FR-005 backward compatibility requirement
- Decouples provider refactors from transformer work as requested
- Maintains "all-in" commitment with definitive end date for legacy support
  **Testing**: Parallel validation during migration with shim-based compatibility layer

## Observability Requirements

### Decision: Comprehensive Classification Metrics

**Metrics**: Rule usage counters, confidence distribution, classification drift per venue/chain
**Rationale**: Enables monitoring of classification quality and rule effectiveness
**Implementation**: Structured logging with metric aggregation

## Research Summary

**Key Findings**:

1. Current UniversalTransaction creates architectural debt mixing concerns
2. 36 files require migration but follow consistent patterns
3. Existing TypeScript + Zod + Decimal.js patterns provide strong foundation
4. Complete replacement (no backward compatibility) simplifies migration
5. Three-stage pipeline provides optimal separation of concerns

**Ready for Phase 1**: All technical unknowns resolved, architecture decisions validated against existing patterns.
