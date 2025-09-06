# Taxation Bounded Context - Architecture Document

## 1. Executive Summary

The Taxation bounded context is responsible for managing tax compliance for cryptocurrency transactions, implementing tax lot accounting methodologies (FIFO, LIFO, HIFO, Specific ID), calculating realized gains/losses, detecting wash sale violations, and generating jurisdiction-specific tax reports. This context transforms raw trading transactions into tax-compliant reporting data while maintaining full auditability through event sourcing.

## 2. Business Domain Overview

### 2.1 Core Business Problem

Cryptocurrency taxation is complex due to:

- Multiple accounting methods (FIFO, LIFO, HIFO, Specific ID)
- Wash sale rules that disallow losses when substantially similar assets are repurchased
- Different tax treatments based on holding periods and jurisdictions
- Need for detailed transaction-level audit trails
- Amendment and correction requirements for filed reports

### 2.2 Key Stakeholders

- **Individual Traders**: Need accurate tax reports for personal filing
- **Tax Professionals**: Require detailed transaction data and Form 8949 exports
- **Regulatory Bodies**: Demand compliant reporting and audit trails
- **System Administrators**: Need to manage tax calculation processes

### 2.3 Business Value

- Automated tax compliance reducing manual effort by 90%+
- Accurate wash sale detection preventing audit issues
- Multi-jurisdiction support for global users
- Full audit trail for regulatory compliance
- Amendment capabilities for correction scenarios

## 3. Bounded Context Definition

### 3.1 Core Responsibilities

1. **Tax Lot Management**: Track cost basis and consumption of cryptocurrency holdings
2. **Gain/Loss Calculation**: Compute realized gains/losses using various accounting methods
3. **Wash Sale Detection**: Identify and apply wash sale rules for loss disallowance
4. **Tax Report Generation**: Create jurisdiction-specific tax reports and forms
5. **Amendment Processing**: Handle corrections to previously filed reports

### 3.2 Context Boundaries

**INSIDE the context:**

- Tax lot creation and consumption
- Realized gain/loss calculations
- Wash sale rule application
- Tax report aggregation
- Form generation (8949, Schedule D)
- Amendment processing

**OUTSIDE the context (dependencies):**

- Trading transactions (from Trading context)
- User profiles and jurisdiction settings (from User context)
- Market data for pricing (from Market Data context)

### 3.3 Ubiquitous Language

| Term                      | Definition                                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------------ |
| **Tax Lot**               | A specific holding of an asset with known acquisition date, quantity, and cost basis                   |
| **Cost Basis**            | The original purchase price of an asset, adjusted for wash sales and other factors                     |
| **Realized Gain/Loss**    | The profit or loss from selling an asset (proceeds - cost basis)                                       |
| **Wash Sale**             | A loss that is disallowed when substantially similar assets are repurchased within 30 days             |
| **Holding Period**        | Time between asset acquisition and disposal, determining short/long-term treatment                     |
| **Tax Category**          | Classification of assets (Property, Security, Collectible, DeFi LP, etc.)                              |
| **Accounting Method**     | Method for selecting which tax lots to consume (FIFO, LIFO, HIFO, Specific ID)                         |
| **Substantially Similar** | Assets that are considered equivalent for wash sale purposes (e.g., BTC and wBTC)                      |
| **Projection**            | A read-optimized, materialized view of data derived from events for fast queries                       |
| **Saga**                  | A long-running process that coordinates transactions between different parts of the system             |
| **Tax Treatment**         | The classification of a gain or loss based on jurisdiction rules (SHORT_TERM, LONG_TERM, CAPITAL_GAIN) |
| **Amendment**             | A correction or modification to a previously filed tax report, creating a new linked report            |
| **Aggregate**             | A cluster of domain objects treated as a single unit for data consistency                              |
| **Event Sourcing**        | Storing all changes to application state as a sequence of immutable events                             |

## 4. Use Cases

### 4.1 Primary Use Cases

#### UC-1: Create Tax Lot from Acquisition

**Actor**: System (triggered by Trading transaction)
**Goal**: Create a new tax lot when assets are acquired

**Main Flow:**

1. System receives acquisition transaction from Trading context
2. Extract asset, quantity, cost basis, and acquisition details
3. Validate cost basis is not negative
4. Create TaxLot aggregate with OPEN status
5. Generate TaxLotCreated event
6. Update tax lot projection for query optimization

**Business Rules:**

- Cost basis must be non-negative
- Each acquisition creates exactly one tax lot
- Acquisition date determines holding period start

#### UC-2: Process Asset Disposal

**Actor**: System (triggered by Trading transaction)
**Goal**: Consume tax lots and calculate realized gains/losses

**Main Flow:**

1. System receives disposal transaction
2. Load available tax lots for the asset and user
3. Apply selected accounting method (FIFO/LIFO/HIFO/Specific) to select lots
4. Consume required quantity from selected lots
5. Calculate realized gain/loss for each consumption
6. Generate consumption events (Partial/Full)
7. Update projections with realized gains

**Business Rules:**

- Must have sufficient lot quantities available
- FIFO uses oldest lots first, LIFO uses newest
- HIFO uses highest cost basis lots first
- Realized gain = Proceeds - Consumed Cost Basis

#### UC-3: Detect and Apply Wash Sale Rules

**Actor**: System (part of tax report generation)
**Goal**: Identify wash sale violations and adjust tax treatment

**Main Flow:**

1. Analyze all disposals with losses in tax period
2. Find acquisitions of substantially similar assets within 30-day window
3. Create wash sale violation records
4. Adjust realized gains to disallow losses
5. Add disallowed loss to cost basis of replacement assets

**Business Rules:**

- Only applies to loss transactions
- 30-day window before and after disposal
- Substantially similar assets trigger violations
- Full loss is disallowed for wash sales

#### UC-4: Generate Annual Tax Report

**Actor**: User
**Goal**: Create comprehensive tax report for filing

**Main Flow:**

1. User initiates report generation for tax year
2. System loads all taxable transactions for the period
3. Apply jurisdiction-specific tax policies
4. Calculate holding period classifications (short/long term)
5. Aggregate gains/losses by treatment type
6. Generate tax summary with totals
7. Create jurisdiction-specific forms (8949, Schedule D)

**Business Rules:**

- Holding period > 365 days = Long-term (US)
- Different jurisdictions have different rules
- Must include wash sale adjustments
- Forms must match jurisdiction requirements

#### UC-5: Amend Filed Tax Report

**Actor**: User/Tax Professional
**Goal**: Create amendment for previously filed report

**Main Flow:**

1. User requests amendment of filed report
2. System creates new report linked to original
3. Copy relevant data from original report
4. Allow modifications to transactions/data
5. Recalculate all tax implications
6. Generate amended forms and summary
7. Maintain audit trail to original

**Business Rules:**

- Can only amend FINALIZED or FILED reports
- Amendment creates new report aggregate
- Original report remains unchanged
- Full audit trail maintained

### 4.2 Secondary Use Cases

#### UC-6: Adjust Cost Basis for Wash Sales

**Actor**: System (automated) or Tax Professional (manual)
**Goal**: Modify tax lot cost basis due to wash sale or other adjustments

#### UC-7: Export Tax Forms

**Actor**: User/Tax Professional
**Goal**: Generate downloadable tax forms (PDF, CSV, JSON)

#### UC-8: Query Tax Lot Status

**Actor**: User
**Goal**: View current tax lot holdings and their status

#### UC-9: Validate Tax Calculations

**Actor**: Tax Professional
**Goal**: Verify accuracy of tax calculations and detect anomalies

## 5. Architecture Overview

### 5.1 Context Diagram (C4 Model)

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Taxation Bounded Context                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐             │
│  │   Trading   │───▶│  Taxation   │◀───│    User     │             │
│  │   Context   │    │   Context   │    │   Context   │             │
│  │             │    │             │    │             │             │
│  │ • Trades    │    │ • Tax Lots  │    │ • Profile   │             │
│  │ • Prices    │    │ • Reports   │    │ • Jurisdiction           │
│  └─────────────┘    │ • Wash Sale │    │ • Preferences │           │
│                     │ • Forms     │    └─────────────┘             │
│  ┌─────────────┐    └─────────────┘                                │
│  │ Market Data │───────────┘                                       │
│  │   Context   │                                                   │
│  │             │                                                   │
│  │ • Prices    │                                                   │
│  │ • Rates     │                                                   │
│  └─────────────┘                                                   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 5.2 Component Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                      Taxation Context Components                    │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐             │
│  │     API     │───▶│  Command    │───▶│   Domain    │             │
│  │ Controller  │    │   Handlers  │    │ Aggregates  │             │
│  └─────────────┘    └─────────────┘    └─────────────┘             │
│         │                                      │                   │
│         ▼                                      ▼                   │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐             │
│  │   Query     │───▶│    Saga     │───▶│   Domain    │             │
│  │  Handlers   │    │Orchestrator │    │  Services   │             │
│  └─────────────┘    └─────────────┘    └─────────────┘             │
│         │                  │                    │                   │
│         ▼                  ▼                    ▼                   │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐             │
│  │ Projection  │    │Event Store  │    │ Repository  │             │
│  │  Database   │    │             │    │             │             │
│  └─────────────┘    └─────────────┘    └─────────────┘             │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 5.3 Architectural Style

- **Domain-Driven Design (DDD)**: Clear bounded context with ubiquitous language
- **Event Sourcing**: Complete audit trail through domain events
- **CQRS**: Separate command and query models for optimization
- **Hexagonal Architecture**: Clean separation of domain from infrastructure

### 5.4 Key Architectural Patterns

#### Event Sourcing

All state changes are captured as immutable events:

- `TaxLotCreated`
- `TaxLotPartiallyConsumed`
- `TaxLotFullyConsumed`
- `TaxReportGenerated`
- `TaxReportAmended`

#### CQRS

- **Commands**: Create lots, process disposals, generate reports
- **Queries**: Read-optimized projections for fast lookups
- **Projections**: Materialized views for common query patterns

#### Saga Pattern

`TaxCalculationSaga` orchestrates complex multi-step processes:

1. Load transactions → 2. Process disposals → 3. Apply tax rules → 4. Generate report

### 5.3 Technology Stack

- **Framework**: NestJS with Effect-TS for functional programming
- **Database**: PostgreSQL with Knex.js for projections
- **Event Store**: Custom implementation for domain events
- **Message Bus**: NestJS CQRS for command/query/event handling

## 6. Domain Model

### 6.1 Core Aggregates

#### TaxLot Aggregate

**Purpose**: Manages individual asset holdings with cost basis tracking
**State**: Lot ID, Asset, Quantity (original/remaining/consumed), Cost Basis, Status
**Commands**: Create, Consume, AdjustCostBasis
**Events**: Created, PartiallyConsumed, FullyConsumed, Adjusted

#### TaxReport Aggregate

**Purpose**: Manages tax report generation and lifecycle
**State**: Report ID, Tax Year, Transactions, Summary, Status
**Commands**: Generate, AddTransaction, Finalize, Amend
**Events**: Generated, TransactionAdded, Calculated, Finalized, Filed, Amended

### 6.2 Key Value Objects

#### TaxableTransaction

```typescript
{
  transactionId: TransactionId;
  type: 'ACQUISITION' | 'DISPOSAL' | 'INCOME' | 'MINING' | 'STAKING';
  asset: AssetId;
  taxCategory: TaxCategory; // NEW: Property, Security, Collectible, etc.
  quantity: Quantity;
  price: Money;
  date: Date;
  realizedGain: Option<RealizedGain>;
}
```

#### RealizedGain

```typescript
{
  proceeds: Money;
  costBasis: Money;
  gain: Money;
  holdingPeriod: HoldingPeriod;
  washSaleAdjustment: Option<Money>;
}
```

#### CostBasis

```typescript
{
  originalAmount: Money;
  adjustedAmount: Money;
  adjustments: CostBasisAdjustment[];
}
```

### 6.3 Domain Services

#### TaxLotSelector

**Purpose**: Implements accounting methods for lot selection
**Implementations**: FIFO, LIFO, HIFO, SpecificID selectors

#### WashSaleDetector

**Purpose**: Identifies wash sale violations
**Enhancement**: Uses `SubstantiallySimilarAssetDetector` interface for flexible asset matching

#### JurisdictionTaxPolicy

**Purpose**: Applies jurisdiction-specific tax rules
**Implementations**: USTaxPolicy, CanadaTaxPolicy

## 7. Data Flow & Process Flows

### 7.1 Tax Lot Creation Flow

```
Trading Transaction → TaxLot.create() → TaxLotCreated Event → Projection Update
```

### 7.2 Disposal Processing Flow

```
Disposal Transaction → Load Available Lots → Apply Accounting Method →
Consume Selected Lots → Calculate Gains → Generate Events → Update Projections
```

### 7.3 Tax Report Generation Flow

```
Generate Command → Load Transactions → Tax Calculation Saga:
  ├── Process All Disposals
  ├── Apply Wash Sale Detection
  ├── Apply Jurisdiction Rules
  ├── Calculate Tax Summary
  └── Generate Required Forms
```

### 7.4 Amendment Flow

```
Amendment Request → Create New Report → Link to Original →
Copy Base Data → Allow Modifications → Recalculate → Generate Amended Forms
```

## 8. API Design

### 8.1 REST Endpoints

```typescript
POST /tax/reports/generate
  Body: { userId, taxYear, accountingMethod }
  Response: { success, message }

GET /tax/reports/{year}?format=json|pdf|csv
  Response: Complete tax report with summary and transactions

GET /tax/reports/{year}/form8949
  Response: Form 8949 data for US tax filing

GET /tax/lots?status=OPEN&asset=BTC
  Response: Tax lot projections matching criteria

POST /tax/lots/{id}/adjust
  Body: { type, amount, currency, reason }
  Response: { success }

GET /tax/wash-sales/{year}
  Response: Wash sale violations for tax year
```

### 8.2 Command Messages

```typescript
CreateTaxLotCommand {
  userId: UserId;
  asset: AssetId;
  quantity: Quantity;
  costBasis: Money;
  acquisitionDate: Date;
  acquisitionMethod: AcquisitionMethod;
}

GenerateTaxReportCommand {
  userId: UserId;
  taxYear: number;
  accountingMethod: AccountingMethod;
}

AmendTaxReportCommand { // NEW
  originalReportId: TaxReportId;
  amendmentReason: string;
  amendedBy: UserId;
}
```

## 9. Data Storage

### 9.1 Event Store Schema

```sql
events (
  stream_id UUID,
  event_id UUID,
  event_type VARCHAR,
  event_data JSONB,
  event_version INTEGER,
  created_at TIMESTAMP
)
```

### 9.2 Projection Tables

#### tax_lot_projections

```sql
CREATE TABLE tax_lot_projections (
  lot_id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  asset_id VARCHAR NOT NULL,
  acquisition_date TIMESTAMP NOT NULL,
  original_quantity DECIMAL(30,18),
  remaining_quantity DECIMAL(30,18),
  adjusted_cost_basis DECIMAL(20,2),
  status VARCHAR NOT NULL,
  INDEX (user_id, asset_id, status)
);
```

#### realized_gains

```sql
CREATE TABLE realized_gains (
  id UUID PRIMARY KEY,
  lot_id UUID NOT NULL,
  disposal_transaction_id UUID NOT NULL,
  quantity_disposed DECIMAL(30,18),
  proceeds DECIMAL(20,2),
  cost_basis DECIMAL(20,2),
  realized_gain DECIMAL(20,2),
  holding_period_days INTEGER,
  tax_treatment VARCHAR,
  wash_sale_adjustment DECIMAL(20,2)
);
```

#### tax_report_projections

```sql
CREATE TABLE tax_report_projections (
  report_id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  tax_year INTEGER NOT NULL,
  status VARCHAR NOT NULL,
  short_term_gains DECIMAL(20,2),
  long_term_gains DECIMAL(20,2),
  total_proceeds DECIMAL(20,2),
  net_gain DECIMAL(20,2),
  INDEX (user_id, tax_year)
);
```

## 10. Integration Points

### 10.1 Inbound Dependencies

#### Trading Context

- **Transaction Events**: Asset acquisitions and disposals
- **Price Data**: Market prices for cost basis calculations
- **User Context**: Tax jurisdiction and preferences

### 10.2 Outbound Dependencies

#### Notification Context

- **Report Ready Events**: Notify users when reports are complete
- **Amendment Events**: Alert about report amendments

#### Analytics Context

- **Tax Metrics**: Aggregate tax data for business insights

## 11. Quality Attributes

### 11.1 Performance Requirements

- **Tax Report Generation**: Complete within 30 seconds for 10K transactions
- **Real-time Lot Updates**: Process disposals within 1 second
- **Query Performance**: Lot lookups under 100ms

### 11.2 Reliability Requirements

- **Data Consistency**: 100% accuracy in tax calculations
- **Event Durability**: Zero data loss through event sourcing
- **Error Recovery**: Automatic retry for failed calculations

### 11.3 Security Requirements

- **Data Privacy**: Encrypt sensitive financial data
- **Audit Trail**: Immutable record of all tax calculations
- **Access Control**: Role-based permissions for tax data

### 11.4 Scalability Requirements

- **User Growth**: Support 100K+ users with 1M+ transactions each
- **Concurrent Processing**: Handle 1000+ simultaneous report generations
- **Storage**: Efficient compression for long-term event storage

## 12. Architectural Enhancements

### 12.1 Recent Improvements Based on Review

#### Amendment Support

- Added `TaxReportAmended` event and `AMENDED` status
- Implemented `amend()` command for creating report amendments
- Maintains full audit trail to original reports

#### Richer Asset Classification

- Added `TaxCategory` enum for different crypto asset types
- Enhanced `TaxableTransaction` with `taxCategory` field
- Supports NFTs, DeFi LP tokens, wrapped assets, etc.

#### Substantially Similar Asset Detection

- Added `SubstantiallySimilarAssetDetector` interface
- Flexible wash sale detection beyond identical assets
- Simple `IdenticalAssetDetector` as starting implementation
- Enables future support for BTC/wBTC wash sale detection

### 12.2 Future Enhancement Opportunities

#### Advanced Asset Similarity

- Machine learning-based asset similarity detection
- Support for protocol-specific substantially similar rules
- Integration with asset taxonomy services

#### Multi-Jurisdiction Expansion

- Additional tax policy implementations
- Automated jurisdiction detection
- Cross-border transaction handling

#### Performance Optimization

- Incremental tax calculation for large portfolios
- Caching strategies for frequent queries
- Parallel processing for multiple tax years

## 13. Testing Strategy

### 13.1 Unit Testing

- **Domain Logic**: Comprehensive testing of aggregates and value objects
- **Tax Calculations**: Verify accuracy of gain/loss computations
- **Business Rules**: Validate wash sale and holding period rules

### 13.2 Integration Testing

- **Event Sourcing**: Test event persistence and replay
- **Saga Orchestration**: Verify multi-step process coordination
- **API Contracts**: Validate request/response schemas

### 13.3 Performance Testing

- **Load Testing**: Simulate high transaction volumes
- **Stress Testing**: Test system limits and degradation
- **Benchmark Testing**: Compare with manual calculations

## 14. Deployment & Operations

### 14.1 Deployment Architecture

- **Microservice**: Independently deployable taxation service
- **Database**: Dedicated PostgreSQL instance for projections
- **Event Store**: Shared event store with other contexts

### 14.2 Monitoring & Observability

- **Metrics**: Tax calculation accuracy, processing times, error rates
- **Logging**: Detailed audit logs for compliance
- **Alerting**: Notification for calculation failures or anomalies

### 14.3 Backup & Recovery

- **Event Store Backup**: Point-in-time recovery capability
- **Projection Rebuild**: Ability to reconstruct projections from events
- **Data Validation**: Regular consistency checks between events and projections

## 15. Architecture Decision Records (ADRs)

### ADR-001: Event Sourcing for Tax Calculations

**Status**: Accepted  
**Date**: 2024-01-15  
**Decision Maker**: Me, myself, and I

**Context**: Tax calculations require absolute auditability and the ability to replay historical calculations with different rules or corrections.

**Decision**: Implement Event Sourcing as the primary persistence strategy for the Taxation context.

**Rationale**:

- **Auditability**: Complete immutable log of all tax-related changes required for regulatory compliance
- **Temporal Queries**: Ability to reconstruct system state at any point in time for historical reporting
- **Amendment Support**: Can replay events with corrections to generate amended reports
- **Regulatory Requirements**: Many jurisdictions require detailed audit trails for tax calculations

**Consequences**:

- **Positive**: Complete audit trail, temporal queries, natural support for amendments
- **Negative**: Increased storage requirements, complexity in handling event schema evolution
- **Risk Mitigation**: Implement event versioning and migration strategies from day one

---

### ADR-002: Effect-TS for Domain Logic

**Status**: Accepted  
**Date**: 2024-01-20  
**Decision Maker**: Just me (after way too much research)

**Context**: Tax calculations involve complex error handling, multiple validation steps, and composition of operations that can fail.

**Decision**: Use Effect-TS as the primary functional programming library for domain logic implementation.

**Rationale**:

- **Type-Safe Error Handling**: Tax calculations must handle errors explicitly without silent failures
- **Compositionality**: Complex tax workflows require composable operations (lot selection, consumption, gain calculation)
- **Effect Management**: Tax operations have side effects (persistence, external calls) that need controlled management
- **Deterministic Testing**: Pure functional approach enables reliable unit testing of tax logic

**Consequences**:

- **Positive**: Eliminated runtime errors in tax calculations, improved composability of complex workflows
- **Negative**: Learning curve for team, potential performance overhead
- **Mitigation**: Comprehensive training program, performance benchmarking against business requirements

---

### ADR-003: CQRS with Separate Read Models

**Status**: Accepted  
**Date**: 2024-01-25  
**Decision Maker**: Solo architect (me) wearing multiple hats

**Context**: Tax queries (lot lookups, report generation) have different performance characteristics than tax commands (lot creation, consumption).

**Decision**: Implement Command Query Responsibility Segregation (CQRS) with dedicated projection tables.

**Rationale**:

- **Query Performance**: Tax lot queries need millisecond response times for user experience
- **Complex Aggregations**: Tax reports require complex joins and aggregations not suitable for event store
- **Read Optimization**: Different query patterns (by user, by asset, by date) require different indexing strategies
- **Scalability**: Read and write workloads can be scaled independently

**Consequences**:

- **Positive**: Optimized read performance, flexible query models, independent scaling
- **Negative**: Eventual consistency between commands and queries, increased complexity
- **Mitigation**: Implement projection health monitoring and reconstruction capabilities

---

### ADR-004: Saga Pattern for Tax Report Generation

**Status**: Accepted  
**Date**: 2024-02-01  
**Decision Maker**: Me (consulting my rubber duck)

**Context**: Tax report generation involves multiple steps across different aggregates and external services.

**Decision**: Implement the Saga pattern for orchestrating complex tax calculation workflows.

**Rationale**:

- **Workflow Coordination**: Tax reports require processing transactions, calculating gains, applying wash sales, and generating forms
- **Failure Handling**: Each step can fail and requires specific compensation logic
- **Auditability**: Need to track progress and status of long-running tax calculations
- **Consistency**: Ensure all steps complete successfully or system returns to consistent state

**Consequences**:

- **Positive**: Reliable workflow execution, clear failure handling, progress tracking
- **Negative**: Increased complexity in workflow management and testing
- **Risk Mitigation**: Implement comprehensive saga testing and monitoring

---

### ADR-005: Pluggable Tax Jurisdiction Policies

**Status**: Accepted  
**Date**: 2024-02-10  
**Decision Maker**: Yours truly (after googling tax laws at 2 AM)

**Context**: Different tax jurisdictions have varying rules for holding periods, wash sales, and gain classifications.

**Decision**: Implement tax jurisdiction rules as pluggable policy objects using the Strategy pattern.

**Rationale**:

- **Extensibility**: New jurisdictions can be added without modifying core tax logic
- **Testability**: Each jurisdiction's rules can be tested independently
- **Compliance**: Jurisdiction-specific logic is isolated and clearly documented
- **Maintenance**: Tax law changes affect only the specific jurisdiction implementation

**Consequences**:

- **Positive**: Easy jurisdiction expansion, clear separation of tax rules, isolated testing
- **Negative**: Additional abstraction layer, potential over-engineering for simple rules
- **Future Considerations**: May need jurisdiction-specific form generators and validation rules

## 16. Conclusion

The Taxation bounded context provides a robust, auditable, and compliant solution for cryptocurrency tax calculations. Through event sourcing and CQRS, it maintains complete transparency while optimizing for both command and query performance. The recent architectural enhancements address key real-world requirements including report amendments, diverse asset classifications, and sophisticated wash sale detection.

The context is designed for extensibility, supporting multiple accounting methods, tax jurisdictions, and asset types while maintaining clean separation of concerns through hexagonal architecture principles. This foundation enables the system to evolve with changing tax regulations and business requirements while preserving data integrity and compliance.

The architectural decisions documented in the ADR log provide clear rationale for key design choices, ensuring future maintainers understand the context and trade-offs behind each decision. These decisions collectively create a system that balances complexity with maintainability, performance with auditability, and flexibility with reliability.
