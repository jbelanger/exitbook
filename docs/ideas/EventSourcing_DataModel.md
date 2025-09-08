## Event-Sourced Architecture: Complete Data Model

Here's a comprehensive data model for the crypto portfolio system using event
sourcing, CQRS, and proper domain boundaries.

## 1. **Event Store (Core Source of Truth)**

```typescript
// PostgreSQL Event Store Schema
// This is the ONLY source of truth for the system

-- Core event storage table
CREATE TABLE event_stream (
  -- Event identification
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type VARCHAR(255) NOT NULL,
  event_version INTEGER NOT NULL DEFAULT 1,
  event_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Aggregate relationship
  aggregate_id VARCHAR(255) NOT NULL,
  aggregate_type VARCHAR(100) NOT NULL,
  aggregate_version BIGINT NOT NULL,

  -- User context (for multi-tenancy)
  user_id UUID NOT NULL,

  -- Event correlation
  causation_id UUID NOT NULL, -- Command that caused this event
  correlation_id UUID NOT NULL, -- Business transaction correlation

  -- Event data
  event_data JSONB NOT NULL,
  event_metadata JSONB NOT NULL,

  -- Indexing
  CONSTRAINT unique_aggregate_version UNIQUE(aggregate_id, aggregate_version)
);

-- Indexes for efficient querying
CREATE INDEX idx_event_stream_aggregate ON event_stream(aggregate_id, aggregate_version);
CREATE INDEX idx_event_stream_user ON event_stream(user_id, event_timestamp);
CREATE INDEX idx_event_stream_type ON event_stream(event_type, event_timestamp);
CREATE INDEX idx_event_stream_correlation ON event_stream(correlation_id);

-- Snapshots for performance optimization
CREATE TABLE aggregate_snapshots (
  snapshot_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_id VARCHAR(255) NOT NULL,
  aggregate_type VARCHAR(100) NOT NULL,
  aggregate_version BIGINT NOT NULL,
  snapshot_data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT unique_snapshot UNIQUE(aggregate_id, aggregate_version)
);
```

## 2. **Domain Events Schema**

```typescript
// TypeScript Event Definitions
namespace DomainEvents {
  // Base event interface
  interface DomainEvent {
    eventId: UUID;
    eventType: string;
    eventVersion: number;
    timestamp: Date;
    aggregateId: string;
    aggregateType: string;
    aggregateVersion: number;
    userId: UUID;
    causationId: UUID;
    correlationId: UUID;
  }

  // ========== Trading Context Events ==========

  interface TransactionImported extends DomainEvent {
    eventType: 'TransactionImported';
    data: {
      source: 'exchange' | 'blockchain' | 'manual';
      externalId: string;
      importSessionId: UUID;
      rawData: {
        timestamp: Date;
        type: string;
        amounts: Array<{
          asset: string;
          quantity: string;
          direction: 'in' | 'out';
        }>;
        fees?: Array<{ asset: string; quantity: string }>;
        metadata: Record<string, unknown>;
      };
    };
  }

  interface TransactionClassified extends DomainEvent {
    eventType: 'TransactionClassified';
    data: {
      classification:
        | 'trade'
        | 'transfer'
        | 'defi_swap'
        | 'liquidity_add'
        | 'liquidity_remove'
        | 'stake'
        | 'unstake'
        | 'nft_trade';
      confidence: number;
      protocol?: string;
      involvedAssets: string[];
      classificationRules: string[];
    };
  }

  interface LedgerEntriesCreated extends DomainEvent {
    eventType: 'LedgerEntriesCreated';
    data: {
      transactionId: UUID;
      entries: Array<{
        accountId: UUID;
        assetId: string;
        amount: string;
        direction: 'debit' | 'credit';
        timestamp: Date;
      }>;
      balanced: boolean;
    };
  }

  // ========== Portfolio Context Events ==========

  interface AssetPositionOpened extends DomainEvent {
    eventType: 'AssetPositionOpened';
    data: {
      assetId: string;
      initialQuantity: string;
      acquisitionPrice: string;
      acquisitionMethod:
        | 'purchase'
        | 'reward'
        | 'airdrop'
        | 'mining'
        | 'transfer_in';
      source: string;
    };
  }

  interface AssetPositionUpdated extends DomainEvent {
    eventType: 'AssetPositionUpdated';
    data: {
      assetId: string;
      previousQuantity: string;
      newQuantity: string;
      changeAmount: string;
      changeType: 'increase' | 'decrease';
      updateReason: string;
    };
  }

  interface PortfolioValuationCalculated extends DomainEvent {
    eventType: 'PortfolioValuationCalculated';
    data: {
      valuationId: UUID;
      baseCurrency: string;
      totalValue: string;
      holdings: Array<{
        assetId: string;
        quantity: string;
        price: string;
        value: string;
        priceSource: string;
        priceTimestamp: Date;
      }>;
      calculatedAt: Date;
    };
  }

  // ========== Taxation Context Events ==========

  interface TaxLotCreated extends DomainEvent {
    eventType: 'TaxLotCreated';
    data: {
      lotId: UUID;
      assetId: string;
      quantity: string;
      costBasis: string;
      acquisitionDate: Date;
      acquisitionMethod: string;
      acquisitionTransactionId: UUID;
    };
  }

  interface TaxLotConsumed extends DomainEvent {
    eventType: 'TaxLotConsumed';
    data: {
      lotId: UUID;
      consumedQuantity: string;
      remainingQuantity: string;
      disposalPrice: string;
      disposalDate: Date;
      realizedGain: string;
      holdingPeriodDays: number;
      isLongTerm: boolean;
      disposalTransactionId: UUID;
    };
  }

  interface TaxReportGenerated extends DomainEvent {
    eventType: 'TaxReportGenerated';
    data: {
      reportId: UUID;
      taxYear: number;
      accountingMethod: 'FIFO' | 'LIFO' | 'HIFO';
      totalRealizedGains: string;
      shortTermGains: string;
      longTermGains: string;
      transactions: Array<{
        date: Date;
        asset: string;
        proceeds: string;
        costBasis: string;
        gain: string;
        holdingPeriod: number;
      }>;
    };
  }

  // ========== Reconciliation Context Events ==========

  interface ReconciliationPerformed extends DomainEvent {
    eventType: 'ReconciliationPerformed';
    data: {
      reconciliationId: UUID;
      source: string;
      discrepancies: Array<{
        assetId: string;
        internalBalance: string;
        externalBalance: string;
        difference: string;
        severity: 'critical' | 'warning' | 'minor';
      }>;
      performedAt: Date;
    };
  }

  interface ManualCorrectionApplied extends DomainEvent {
    eventType: 'ManualCorrectionApplied';
    data: {
      correctionId: UUID;
      correctionType:
        | 'balance_adjustment'
        | 'transaction_reversal'
        | 'missing_transaction';
      reason: string;
      adjustments: Array<{
        accountId: UUID;
        assetId: string;
        previousValue: string;
        newValue: string;
      }>;
      appliedBy: string;
    };
  }
}
```

## 3. **Read Model Projections (Denormalized for Queries)**

```sql
-- ========== PORTFOLIO PROJECTION ==========
-- Optimized for portfolio queries and real-time balance lookups

CREATE TABLE portfolio_holdings (
  holding_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  asset_id VARCHAR(50) NOT NULL,

  -- Current state
  quantity DECIMAL(36, 18) NOT NULL,
  last_price DECIMAL(36, 18),
  last_price_usd DECIMAL(36, 18),
  last_price_timestamp TIMESTAMPTZ,
  price_source VARCHAR(100),

  -- Calculated fields (denormalized for performance)
  total_value_usd DECIMAL(36, 18),
  cost_basis_usd DECIMAL(36, 18),
  unrealized_gain_usd DECIMAL(36, 18),
  roi_percentage DECIMAL(10, 4),

  -- Metadata
  first_acquisition_date DATE,
  last_transaction_date DATE,
  total_transactions INTEGER DEFAULT 0,

  -- Optimistic locking
  version INTEGER DEFAULT 1,
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT unique_user_asset UNIQUE(user_id, asset_id)
);

CREATE INDEX idx_holdings_user ON portfolio_holdings(user_id);
CREATE INDEX idx_holdings_value ON portfolio_holdings(user_id, total_value_usd DESC);

-- Account balances by type
CREATE TABLE account_balances (
  balance_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  account_type VARCHAR(50) NOT NULL, -- 'wallet', 'exchange', 'defi', 'nft'
  account_name VARCHAR(255) NOT NULL,
  asset_id VARCHAR(50) NOT NULL,

  -- Balance tracking
  balance DECIMAL(36, 18) NOT NULL,
  balance_usd DECIMAL(36, 18),

  -- Source tracking
  source VARCHAR(100) NOT NULL, -- 'binance', 'ethereum', 'uniswap', etc
  external_address VARCHAR(255),

  -- Temporal
  last_updated TIMESTAMPTZ DEFAULT NOW(),
  last_transaction_id UUID,

  CONSTRAINT unique_account_asset UNIQUE(user_id, account_type, account_name, asset_id)
);

CREATE INDEX idx_account_balances_user ON account_balances(user_id, account_type);

-- ========== TAX PROJECTION ==========
-- Optimized for tax calculations and reporting

CREATE TABLE tax_lots (
  lot_id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  asset_id VARCHAR(50) NOT NULL,

  -- Acquisition details
  acquisition_date DATE NOT NULL,
  acquisition_transaction_id UUID NOT NULL,
  acquisition_method VARCHAR(50) NOT NULL,

  -- Quantities
  original_quantity DECIMAL(36, 18) NOT NULL,
  remaining_quantity DECIMAL(36, 18) NOT NULL,
  consumed_quantity DECIMAL(36, 18) NOT NULL DEFAULT 0,

  -- Cost basis
  total_cost_basis DECIMAL(36, 18) NOT NULL,
  cost_basis_per_unit DECIMAL(36, 18) NOT NULL,
  cost_basis_currency VARCHAR(10) NOT NULL,

  -- Status
  status VARCHAR(20) NOT NULL DEFAULT 'open', -- 'open', 'partial', 'closed'

  -- Indexing for FIFO/LIFO/HIFO queries
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_tax_lots_fifo ON tax_lots(user_id, asset_id, status, acquisition_date, lot_id);
CREATE INDEX idx_tax_lots_lifo ON tax_lots(user_id, asset_id, status, acquisition_date DESC, lot_id);
CREATE INDEX idx_tax_lots_hifo ON tax_lots(user_id, asset_id, status, cost_basis_per_unit DESC, lot_id);

-- Realized gains tracking
CREATE TABLE realized_gains (
  gain_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,

  -- Transaction details
  disposal_date DATE NOT NULL,
  disposal_transaction_id UUID NOT NULL,
  asset_id VARCHAR(50) NOT NULL,

  -- Amounts
  quantity_disposed DECIMAL(36, 18) NOT NULL,
  proceeds DECIMAL(36, 18) NOT NULL,
  cost_basis DECIMAL(36, 18) NOT NULL,
  realized_gain DECIMAL(36, 18) NOT NULL,

  -- Tax classification
  holding_period_days INTEGER NOT NULL,
  tax_treatment VARCHAR(20) NOT NULL, -- 'short_term', 'long_term'

  -- Lot tracking
  consumed_lots JSONB NOT NULL, -- Array of {lot_id, quantity, cost_basis}

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_realized_gains_user_year ON realized_gains(user_id, disposal_date);
CREATE INDEX idx_realized_gains_tax ON realized_gains(user_id, tax_treatment, disposal_date);

-- ========== TRANSACTION CLASSIFICATION PROJECTION ==========

CREATE TABLE classified_transactions (
  transaction_id UUID PRIMARY KEY,
  user_id UUID NOT NULL,

  -- Classification
  transaction_type VARCHAR(50) NOT NULL,
  sub_type VARCHAR(100),
  confidence DECIMAL(3, 2) NOT NULL,
  protocol VARCHAR(100),

  -- Involved assets
  primary_asset VARCHAR(50),
  secondary_asset VARCHAR(50),
  involved_assets TEXT[], -- Array of all involved assets

  -- Amounts
  primary_amount DECIMAL(36, 18),
  secondary_amount DECIMAL(36, 18),
  fee_amount DECIMAL(36, 18),
  fee_asset VARCHAR(50),

  -- Metadata
  classification_rules TEXT[],
  raw_data JSONB,

  classified_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_classified_tx_user ON classified_transactions(user_id, classified_at DESC);
CREATE INDEX idx_classified_tx_type ON classified_transactions(user_id, transaction_type);

-- ========== RECONCILIATION PROJECTION ==========

CREATE TABLE reconciliation_status (
  status_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  source VARCHAR(100) NOT NULL,
  asset_id VARCHAR(50) NOT NULL,

  -- Balance comparison
  internal_balance DECIMAL(36, 18) NOT NULL,
  external_balance DECIMAL(36, 18),
  discrepancy DECIMAL(36, 18),
  discrepancy_percentage DECIMAL(10, 4),

  -- Status
  status VARCHAR(20) NOT NULL, -- 'matched', 'discrepancy', 'missing_external', 'missing_internal'
  severity VARCHAR(20), -- 'critical', 'warning', 'minor'

  -- Temporal
  last_reconciled_at TIMESTAMPTZ NOT NULL,
  last_external_fetch_at TIMESTAMPTZ,

  CONSTRAINT unique_reconciliation_key UNIQUE(user_id, source, asset_id)
);

CREATE INDEX idx_reconciliation_status ON reconciliation_status(user_id, status, severity);
```

## 4. **Command and Saga State Tables**

```sql
-- Command deduplication and tracking
CREATE TABLE command_inbox (
  command_id UUID PRIMARY KEY,
  command_type VARCHAR(255) NOT NULL,
  user_id UUID NOT NULL,

  -- Idempotency
  idempotency_key VARCHAR(255),

  -- State tracking
  status VARCHAR(20) NOT NULL DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'failed'

  -- Payload
  command_data JSONB NOT NULL,

  -- Results
  result_events UUID[], -- Event IDs created by this command
  error_message TEXT,

  -- Temporal
  received_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ,

  CONSTRAINT unique_idempotency UNIQUE(user_id, idempotency_key)
);

CREATE INDEX idx_command_inbox_status ON command_inbox(status, received_at);

-- Saga/Workflow state management
CREATE TABLE workflow_state (
  workflow_id UUID PRIMARY KEY,
  workflow_type VARCHAR(100) NOT NULL,
  user_id UUID NOT NULL,

  -- State machine
  current_step VARCHAR(100) NOT NULL,
  workflow_status VARCHAR(20) NOT NULL, -- 'running', 'completed', 'failed', 'compensating'

  -- Context and state
  workflow_context JSONB NOT NULL,
  completed_steps TEXT[],
  pending_steps TEXT[],

  -- Error handling
  failed_step VARCHAR(100),
  error_details JSONB,
  retry_count INTEGER DEFAULT 0,

  -- Temporal
  started_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,

  CONSTRAINT unique_workflow UNIQUE(user_id, workflow_type, workflow_id)
);

CREATE INDEX idx_workflow_state_active ON workflow_state(workflow_status) WHERE workflow_status IN ('running', 'compensating');
```

## 5. **Reference Data (Mostly Static)**

```sql
-- Asset reference data
CREATE TABLE assets (
  asset_id VARCHAR(50) PRIMARY KEY, -- 'ETH', 'BTC', 'USDC', etc.
  asset_type VARCHAR(20) NOT NULL, -- 'crypto', 'fiat', 'nft_collection', 'lp_token'

  -- Basic info
  name VARCHAR(255) NOT NULL,
  symbol VARCHAR(20) NOT NULL,
  decimals INTEGER NOT NULL,

  -- Blockchain info (for crypto)
  blockchain VARCHAR(50),
  contract_address VARCHAR(255),
  is_native_token BOOLEAN DEFAULT FALSE,

  -- LP Token specific
  underlying_assets JSONB, -- For LP tokens: [{asset_id, weight}]
  protocol VARCHAR(100),

  -- NFT Collection specific
  collection_standard VARCHAR(20), -- 'ERC721', 'ERC1155'

  -- Metadata
  icon_url TEXT,
  coingecko_id VARCHAR(100),
  active BOOLEAN DEFAULT TRUE,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_assets_type ON assets(asset_type);
CREATE INDEX idx_assets_blockchain ON assets(blockchain);

-- Protocol/Exchange registry
CREATE TABLE data_sources (
  source_id VARCHAR(100) PRIMARY KEY,
  source_type VARCHAR(20) NOT NULL, -- 'exchange', 'blockchain', 'defi_protocol'

  -- Basic info
  name VARCHAR(255) NOT NULL,
  display_name VARCHAR(255) NOT NULL,

  -- Classification rules
  contract_addresses TEXT[], -- Known contract addresses
  method_signatures JSONB, -- Known method signatures for classification

  -- API configuration
  api_endpoint TEXT,
  api_version VARCHAR(20),
  rate_limit_per_minute INTEGER,

  -- Status
  active BOOLEAN DEFAULT TRUE,
  supported_operations TEXT[], -- ['balance_fetch', 'transaction_import', 'trading']

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- User preferences and settings
CREATE TABLE user_settings (
  user_id UUID PRIMARY KEY,

  -- Tax settings
  tax_accounting_method VARCHAR(20) DEFAULT 'FIFO',
  tax_jurisdiction VARCHAR(50) DEFAULT 'US',
  fiscal_year_end_month INTEGER DEFAULT 12,

  -- Portfolio settings
  base_currency VARCHAR(10) DEFAULT 'USD',
  display_small_balances BOOLEAN DEFAULT FALSE,

  -- Reconciliation settings
  reconciliation_tolerance_percent DECIMAL(5, 2) DEFAULT 1.0,
  auto_reconcile_enabled BOOLEAN DEFAULT FALSE,

  -- Notification preferences
  notification_preferences JSONB DEFAULT '{}',

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

## 6. **Audit and Compliance Tables**

```sql
-- Immutable audit log
CREATE TABLE audit_log (
  audit_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,

  -- Action details
  action_type VARCHAR(100) NOT NULL,
  entity_type VARCHAR(100) NOT NULL,
  entity_id VARCHAR(255),

  -- Change tracking
  changes JSONB NOT NULL,
  previous_values JSONB,
  new_values JSONB,

  -- Context
  performed_by VARCHAR(255) NOT NULL, -- Could be user_id or 'system'
  ip_address INET,
  user_agent TEXT,

  -- Correlation
  correlation_id UUID,

  -- Immutable timestamp
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX idx_audit_log_user ON audit_log(user_id, created_at DESC);
CREATE INDEX idx_audit_log_entity ON audit_log(entity_type, entity_id);

-- Data export tracking for compliance
CREATE TABLE data_exports (
  export_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,

  -- Export details
  export_type VARCHAR(50) NOT NULL, -- 'full_data', 'tax_report', 'transactions'
  export_format VARCHAR(20) NOT NULL, -- 'json', 'csv', 'pdf'

  -- File tracking
  file_size_bytes BIGINT,
  file_hash VARCHAR(64), -- SHA256
  storage_location TEXT, -- S3 key or similar

  -- Temporal
  requested_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,

  -- Status
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
);

CREATE INDEX idx_data_exports_user ON data_exports(user_id, requested_at DESC);
```

## Key Design Principles

1. **Event Store as Single Source of Truth**: All state changes go through
   events first
2. **Projections for Queries**: Denormalized views optimized for specific query
   patterns
3. **No Foreign Keys Between Contexts**: Bounded contexts communicate through
   events only
4. **Idempotency Built-in**: Command inbox prevents duplicate processing
5. **Audit by Design**: Event store provides complete audit trail
6. **Performance Optimized**: Projections and indexes for sub-second queries
7. **Multi-tenancy**: All tables include user_id for data isolation

This architecture provides:

- Complete audit trail and time-travel capability
- Horizontal scalability (can shard by user_id)
- Read/write separation (projections can be on different databases)
- Natural support for corrections and reversals
- Performance optimization through targeted projections
- Clear bounded contexts with event-driven communication
