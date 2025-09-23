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

### Decision: Implement via Metadata-Driven Registry Pattern
**Rationale**:
- Existing `@RegisterApiClient` decorator pattern already established
- Enables automatic discovery and instantiation of processors
- Maintains type safety with compile-time checking
**Alternatives Considered**: Manual registration (rejected - inconsistent with current patterns)
**Implementation**: Extend existing registry in `packages/import/src/blockchains/shared/registry/`

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

### Decision: Complete UniversalTransaction Removal
**Rationale**:
- Specification explicitly states "No rollback, we go all in"
- Clean architecture without legacy compatibility burden
- Forces complete migration ensuring consistent new patterns
**Alternatives Considered**:
- Compatibility shims (rejected - specification prohibits backward compatibility)
- Gradual migration (rejected - creates dual-maintenance burden)

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

### Decision: Incremental Processor Migration
**Approach**:
1. Implement new types alongside existing ones
2. Migrate processors one at a time (exchange → blockchain)
3. Remove UniversalTransaction after all processors migrated
4. Update storage layer last

**Rationale**: Minimizes risk while maintaining development velocity during 1-2 sprint timeline
**Testing**: Parallel validation during migration to ensure output equivalence

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