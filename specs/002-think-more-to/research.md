# Research Findings: ProcessedTransaction + Purpose Classifier Architecture

**Date**: 2025-09-24 | **Feature**: Replace UniversalTransaction with ProcessedTransaction + Purpose Classifier

## Executive Summary

Research confirms that the current UniversalTransaction architecture has fundamental separation-of-concerns violations where transaction processors make classification decisions they shouldn't. The proposed ProcessedTransaction + Purpose Classifier design addresses these architectural issues while preserving the solid infrastructure patterns.

---

## Research Questions Resolved

### R1: Current UniversalTransaction Structure Analysis

**Decision**: Replace mixed-concern UniversalTransaction with separated ProcessedTransaction + classification metadata

**Rationale**:

- Current `UniversalTransaction.type` field mixes movement descriptions with purpose classification
- Processors scattered with different classification logic (Kraken trader logic, Ethereum address analysis)
- No way to test classification independently from data transformation

**Current Structure Issues**:

```typescript
// packages/core/src/types.ts:238-261
interface UniversalTransaction {
  type: TransactionType; // 'trade'|'deposit'|'withdrawal' - MIXED CONCERNS
  amount: Money;
  fee?: Money;
  // ... other fields mix what happened with why it happened
}
```

**Alternatives Considered**:

- Extend UniversalTransaction with optional purpose field → Rejected: maintains mixed concerns
- Add purpose field alongside type → Rejected: creates confusion about which to use

---

### R2: Transaction Processing Pattern Analysis

**Decision**: Preserve ETL pipeline (Import → Process → Store) but add Classification step

**Rationale**:

- Current BaseProcessor architecture (`packages/import/src/shared/processors/base-processor.ts`) has solid patterns:
  - Validation pipeline with Zod schemas
  - Log-and-filter strategy for handling invalid data
  - Scam detection with warning notes
- Provider registry system with decorators works well
- Multi-provider failover with circuit breakers is battle-tested

**Current Flow Issues**:

```
Raw Data → Processor.process() → UniversalTransaction[] (with classification)
                   ↑
          Classification decisions made here (PROBLEM)
```

**New Flow**:

```
Raw Data → Processor.process() → MovementUnclassified[] → Classifier → MovementClassified[]
```

**Alternatives Considered**:

- Rewrite entire processing architecture → Rejected: too risky, loses proven patterns
- Add classification as processor responsibility → Rejected: maintains separation-of-concerns violation

---

### R3: Current Classification Logic Audit

**Decision**: Extract all purpose-assignment logic to centralized Purpose Classifier service

**Rationale**: Found classification logic scattered across multiple processors:

1. **Kraken Processor** (`packages/import/src/exchanges/kraken/processor.ts`):
   - Lines 125-169: Trade pair detection logic
   - Lines 458-503: Token migration classification
   - Lines 360-424: Dustsweeping business rules

2. **Ethereum Processor** (`packages/import/src/blockchains/ethereum/transaction-processor.ts`):
   - Lines 94-96: Delegates to BaseProcessor.mapTransactionType()

3. **BaseProcessor Address Analysis** (`packages/import/src/shared/processors/base-processor.ts:121-162`):
   ```typescript
   if (isFromWallet && isToWallet) return 'transfer'; // Internal
   if (!isFromWallet && isToWallet) return 'deposit'; // Incoming
   if (isFromWallet && !isToWallet) return 'withdrawal'; // Outgoing
   ```

**Issues**:

- No consistent classification rules across processors
- Business logic mixed with data transformation
- Impossible to test classification logic in isolation
- Different processors can classify similar patterns differently

**Alternatives Considered**:

- Standardize classification within each processor → Rejected: doesn't solve separation of concerns
- Create classification utility functions → Rejected: still allows processors to make purpose decisions

---

### R4: Validation and Schema Architecture

**Decision**: Adapt existing Zod validation patterns for ProcessedTransaction architecture

**Rationale**: Current validation infrastructure is well-designed:

- `UniversalTransactionSchema` with strict validation (`packages/core/src/validation/universal-schemas.ts`)
- Decimal.js integration for financial precision
- Batch validation with error separation
- Log-and-filter strategy maintains data integrity

**Patterns to Preserve**:

- Zod-based runtime validation
- Money type with Decimal.js for precision
- ValidationResult separation (valid vs invalid with reasons)
- Error logging without breaking processing pipeline

**Patterns to Modify**:

- Split transaction validation into movement validation + classification validation
- Add ClassificationInfo schema for metadata (rule ID, version, reasoning, confidence)

**Alternatives Considered**:

- Switch to different validation library → Rejected: Zod integration is mature
- Remove validation entirely → Rejected: financial precision requires strict validation

---

### R5: Migration Strategy Research

**Decision**: Implement conversion shim with backward compatibility during transition period

**Rationale**: Found 20+ files with UniversalTransaction dependencies:

- Database storage layer expects this format
- All processor implementations output this format
- CLI application consumes this format
- Balance verification relies on this structure

**Migration Requirements**:

1. **Conversion Layer**: UniversalTransaction ↔ ProcessedTransaction + Classification mapping
2. **Gradual Rollout**: Support both formats during transition
3. **Best-Effort Mapping**: Handle cases where UniversalTransaction data cannot be cleanly converted
4. **Flagging Uncertain Conversions**: Mark conversions that may lose information

**Current Dependencies to Address**:

- `packages/import/src/services/ingestion-service.ts` - main processing pipeline
- All processor implementations expect to return UniversalTransaction[]
- Database schema and repository layers
- CLI commands that display transaction data

**Alternatives Considered**:

- Big-bang replacement → Rejected: too risky with financial data
- Maintain both systems permanently → Rejected: increases maintenance burden

---

## Key Technology Decisions

### TD1: Deterministic Classification Architecture

**Decision**: Use rule-based classifier with explicit rule IDs, versions, and reasoning metadata

**Rationale**:

- Feature requirement: "bit-for-bit identical classification results"
- Current processors use different heuristics (address analysis, amount matching, symbol detection)
- Need audit trail for financial accuracy

**Classification Metadata Structure**:

```typescript
interface ClassificationInfo {
  ruleId: string; // e.g., "ETH_GAS_V1", "KRAKEN_SPOT_TRADE_V2"
  version: string; // Rule version for deterministic behavior
  reasoning: string; // Human-readable explanation
  confidence: number; // 0-1 score for informational purposes
}
```

### TD2: Purpose Taxonomy

**Decision**: Start with three-purpose taxonomy: PRINCIPAL, FEE, GAS

**Rationale**:

- MVP scope limits complexity
- PRINCIPAL: Main financial movement (trades, transfers)
- FEE: Exchange/service fees
- GAS: Blockchain transaction costs
- Extensible design allows additional purposes later

**Current Transaction Types to Map**:

- 'trade' → PRINCIPAL (main exchange) + FEE (if applicable)
- 'deposit'/'withdrawal'/'transfer' → PRINCIPAL
- 'fee' → FEE (standalone fees)
- Gas costs in Ethereum transactions → GAS

### TD3: Processor Guardrails

**Decision**: Implement lint rules and test helpers to prevent purpose assignment in processors

**Rationale**: Need enforcement to prevent architectural violations

**Implementation Approaches**:

1. **Type System**: ProcessedTransaction without purpose field in processor outputs
2. **Lint Rules**: ESLint rules to detect purpose assignment in processor code
3. **Test Helpers**: Contract tests that verify processors only output movements
4. **Code Review Checklist**: Guidelines for reviewing processor changes

**Exceptions**: Only blockchain-native operations (gas fees, mining rewards) can be directly classified by processors

---

## Infrastructure Preservation Decisions

### IP1: Provider Registry System

**Keep**: Decorator-based `@RegisterApiClient` registration system works well

### IP2: Multi-Provider Failover

**Keep**: Circuit breaker pattern with health monitoring is battle-tested

### IP3: ETL Pipeline Structure

**Keep**: Import → Store Raw → Process → Load separation is solid architecture

### IP4: Financial Precision

**Keep**: Decimal.js usage throughout for avoiding floating-point errors

### IP5: Validation Pipeline

**Keep**: Zod schemas with log-and-filter strategy maintains data integrity

---

## Next Phase Inputs

Based on this research, Phase 1 (Design & Contracts) should focus on:

1. **ProcessedTransaction Data Model**: Clear movement representation without purpose mixing
2. **Purpose Classifier Interface**: Deterministic classification service contract
3. **Migration Shim Contract**: Conversion between old and new formats
4. **Validation Schemas**: Zod schemas for new data structures
5. **Processor Guardrails**: Type and lint enforcement for separation of concerns

The existing infrastructure provides a solid foundation - the challenge is extracting classification concerns without breaking proven patterns.
