# ADR 003: Unified Price and FX Rate Enrichment Architecture

**Date**: 2025-11-01
**Status**: Proposed
**Deciders**: Joel Belanger (maintainer)
**Tags**: pricing, fx-rates, multi-currency, enrichment, architecture

---

## Context and Problem Statement

The system needs to handle multiple currencies (EUR, CAD, USD, USDC, etc.) throughout the data pipeline: during import, price enrichment, cost basis calculation, and report generation. The initial architecture proposed normalizing prices to USD during import/processing, but this creates several problems:

1. **Architectural inconsistency**: Crypto prices are fetched during enrichment phase, but FX rates would be fetched during import/processing
2. **External dependencies in processors**: Processors would need network access and API keys for FX providers
3. **Poor separation of concerns**: Import/process phases should focus on data acquisition/transformation, not external data enrichment
4. **Reprocessing limitations**: Cannot update FX rates without reimporting raw data
5. **Testability**: Processors become harder to test with external API dependencies

### Multi-Currency Data Flow Problems

**Scenario 1: EUR trade on European exchange**

```
Import: Buy 1 BTC for 40,000 EUR
Question: Convert EUR→USD during import or later?
Current proposal (Issue #153 Phase 3): Fetch FX rate during import
Problem: Violates separation of concerns
```

**Scenario 2: USDC stablecoin trade**

```
Import: Buy 1 BTC for 50,000 USDC
Question: Treat USDC as USD (1:1 peg) or fetch actual rate?
Decision: Fetch actual historical prices to avoid de-peg issues
Rationale: Historical events (UST collapse, USDC de-peg to $0.98 in March 2023)
```

**Scenario 3: Tax report in CAD**

```
Cost basis calculated in USD
User wants report in CAD
Question: Convert using which FX rate? Today's or transaction date's?
Current proposal: Unclear
Problem: Using current rates would give incorrect tax calculations
```

### Existing Price Provider Infrastructure

The codebase already has a sophisticated price provider system (`packages/platform/price-providers`):

- Unified `IPriceProvider` interface
- Provider manager with failover and circuit breakers
- Shared cache database (`./data/prices.db`)
- Multiple crypto price providers (CoinGecko, CryptoCompare, Binance)

**Key insight**: FX rates are conceptually identical to crypto prices:

- Crypto price: `asset='BTC', currency='USD', price=50000`
- FX rate: `asset='EUR', currency='USD', price=1.08`

Both are historical time-series data fetched from external APIs and cached locally.

---

## Decision

We will treat **FX rate fetching as price enrichment**, not import normalization. All external data fetching (crypto prices AND FX rates) happens during the enrichment phase, never during import/process.

### Core Principles

1. **Separation of concerns**:
   - Import/Process: Data acquisition and transformation (no external API calls)
   - Enrich: External data fetching (crypto prices + FX rates)
   - Calculate: Pure computation on enriched data
   - Report: Display formatting and conversion

2. **Single storage currency**: USD
   - All prices normalized to USD during enrichment
   - Cost basis calculations work purely in USD
   - No multi-currency lot matching complexity

3. **Two separate conversions**:
   - **Storage normalization** (EUR/CAD → USD): Done during enrichment, stored in DB with audit trail
   - **Display conversion** (USD → CAD/EUR): Done during report generation, ephemeral, uses historical rates

4. **USD-equivalent assets**: Only derive prices from actual USD
   - USD ✅ (only actual USD)
   - USDC, USDT, DAI ❌ (treat as crypto assets, fetch in Stage 3 to avoid de-peg issues)
   - EUR, CAD, GBP ❌ (need FX conversion first)

5. **Historical FX rates**: Always use transaction date rates, never current rates
   - Critical for tax accuracy
   - Both storage normalization and display conversion use historical rates

6. **Unified provider infrastructure**: FX providers integrated into existing price provider package
   - Same `IPriceProvider` interface
   - Same cache database
   - Same failover/circuit breaker logic
   - No code duplication

---

## Architecture

### Data Flow Pipeline

```
┌─────────────────────────────────────────────────────────────┐
│ IMPORT PHASE (Data Acquisition)                            │
│ • Fetch raw data from APIs/CSVs                            │
│ • Store prices in original currency (EUR stays EUR)        │
│ • NO external price/FX API calls                           │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ PROCESS PHASE (Transformation)                             │
│ • Transform raw → UniversalTransaction                     │
│ • Store prices as-provided in movements                    │
│ • NO external price/FX API calls                           │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ ENRICH PHASE (Price Normalization)                         │
│ ALL external data fetching happens here                    │
├─────────────────────────────────────────────────────────────┤
│ Stage 1: normalize                                          │
│ • Find non-USD fiat prices (EUR, CAD, GBP)                 │
│ • Fetch FX rates via PriceProviderManager                  │
│ • Convert to USD, populate fxRateToUSD metadata            │
│                                                             │
│ Stage 2: derive                                             │
│ • Extract prices from USD trades only                      │
│ • Propagate via transaction links                          │
│ • SKIP non-USD fiat (normalized in Stage 1)                │
│ • SKIP stablecoins (fetched in Stage 3 to avoid de-peg)    │
│                                                             │
│ Stage 3: fetch                                              │
│ • Fetch missing crypto prices from providers               │
│ • Always in USD                                             │
│                                                             │
│ Result: All prices in USD with audit trail                 │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ LINK PHASE (Transaction Matching)                          │
│ • Identify cross-platform transfers                        │
│ • Unchanged                                                 │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ CALCULATE PHASE (Cost Basis)                               │
│ • Pre-flight check: validate all prices in USD             │
│ • Calculate purely in USD (no FX conversions)              │
│ • Fast, deterministic                                       │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ REPORT PHASE (Presentation)                                │
│ • Convert USD → display currency (CAD/EUR/GBP)             │
│ • Use historical FX rates at transaction time               │
│ • Ephemeral (not stored, regenerated per report)           │
│ • Cache same-day rates for performance                      │
└─────────────────────────────────────────────────────────────┘
```

### Unified Price Provider Package

FX providers integrated into existing `packages/platform/price-providers`:

```
packages/platform/price-providers/
├─ src/
│  ├─ coingecko/          # Crypto prices
│  │  └─ provider.ts      # Implements IPriceProvider
│  ├─ cryptocompare/      # Crypto prices
│  │  └─ provider.ts
│  ├─ binance/            # Crypto prices
│  │  └─ provider.ts
│  ├─ ecb/                # ← NEW: FX rates (European Central Bank)
│  │  ├─ provider.ts      # Implements IPriceProvider (same interface!)
│  │  ├─ schemas.ts
│  │  └─ __tests__/
│  ├─ bank-of-canada/     # ← NEW: FX rates (CAD/USD)
│  │  ├─ provider.ts
│  │  ├─ schemas.ts
│  │  └─ __tests__/
│  ├─ shared/
│  │  ├─ types/
│  │  │  └─ index.ts      # PriceQuery, PriceData (works for both!)
│  │  ├─ base-provider.ts # Base class for all providers
│  │  ├─ provider-manager.ts  # Manages ALL providers (crypto + FX)
│  │  └─ factory.ts       # Creates manager with all providers
│  └─ persistence/
│     ├─ database.ts      # Single DB: ./data/prices.db
│     └─ schema.ts        # Same schema for crypto + FX
└─ data/
   └─ prices.db           # Stores crypto prices AND FX rates
```

### Schema (No Changes Needed)

Existing `prices` table supports both crypto prices and FX rates:

```sql
-- Crypto price
INSERT INTO prices (asset_symbol, currency, timestamp, price, source_provider, granularity)
VALUES ('BTC', 'USD', '2023-01-15T10:00:00Z', '50000', 'coingecko', 'minute');

-- FX rate (same schema!)
INSERT INTO prices (asset_symbol, currency, timestamp, price, source_provider, granularity)
VALUES ('EUR', 'USD', '2023-01-15T00:00:00Z', '1.08', 'ecb', 'day');
```

Existing `PriceAtTxTime` schema already has FX metadata fields:

```typescript
interface PriceAtTxTime {
  price: Money; // Always USD after enrichment
  source: string; // 'ecb', 'coingecko', 'exchange-execution', etc.
  fetchedAt: Date;
  granularity?: 'exact' | 'minute' | 'hour' | 'day';

  // FX metadata (populated when converted from non-USD)
  fxRateToUSD?: Decimal; // e.g., 1.08 for EUR → USD
  fxSource?: string; // e.g., 'ecb'
  fxTimestamp?: Date; // When FX rate was fetched
}
```

### Provider Interface (Unified)

Both crypto and FX providers implement the same interface:

```typescript
interface IPriceProvider {
  fetchPrice(query: PriceQuery): Promise<Result<PriceData, Error>>;
  getMetadata(): ProviderMetadata;
}

// Works for both:
// Crypto: { asset: Currency.create('BTC'), currency: Currency.create('USD'), timestamp }
// FX:     { asset: Currency.create('EUR'), currency: Currency.create('USD'), timestamp }
```

### FX Provider Implementation Example

```typescript
// packages/platform/price-providers/src/ecb/provider.ts

export class ECBProvider extends BasePriceProvider {
  protected metadata: ProviderMetadata = {
    name: 'ecb',
    displayName: 'European Central Bank',
    capabilities: {
      supportedOperations: ['fetchPrice'],
      supportedCurrencies: ['USD'],
      rateLimit: {
        requestsPerSecond: 1,
        requestsPerMinute: 10,
        requestsPerHour: 100,
        burstLimit: 5,
      },
      granularitySupport: [
        {
          granularity: 'day',
          maxHistoryDays: undefined, // Back to 1999
        },
      ],
    },
    requiresApiKey: false,
  };

  protected async fetchPriceInternal(query: PriceQuery): Promise<Result<PriceData, Error>> {
    const { asset, currency, timestamp } = query;

    // Validate: asset must be fiat, currency must be USD
    if (!asset.isFiat()) {
      return err(new Error(`ECB only supports fiat currencies, got ${asset}`));
    }
    if (currency.toString() !== 'USD') {
      return err(new Error(`ECB only supports USD target, got ${currency}`));
    }

    // Fetch from ECB API
    const response = await this.httpClient.get(
      `https://data-api.ecb.europa.eu/service/data/EXR/D.${asset}.${currency}.SP00.A`,
      { params: { startPeriod: formatDate(timestamp), endPeriod: formatDate(timestamp) } }
    );

    const rate = parseECBResponse(response);

    return ok({
      asset,
      currency,
      timestamp,
      price: rate.toNumber(),
      source: 'ecb',
      fetchedAt: new Date(),
      granularity: 'day',
    });
  }
}
```

### Enrichment Command Structure

Single unified command with three stages:

```bash
pnpm run dev prices enrich [options]
```

**Stage 1: Normalize** (NEW)

- Find movements with non-USD fiat prices
- Fetch FX rates via `PriceProviderManager`
- Convert to USD, populate FX metadata
- Handler: `PricesNormalizeHandler`

**Stage 2: Derive** (UPDATED)

- Only extract from actual USD (no stablecoins to avoid de-peg issues)
- Propagate via transaction links
- Update `calculatePriceFromTrade` to check `currency === 'USD'`
- Handler: `PricesDeriveHandler`

**Stage 3: Fetch** (UNCHANGED)

- Fetch missing crypto prices from providers
- Handler: `PricesFetchHandler`

Options:

- `--asset <symbol>`: Filter by specific asset
- `--interactive`: Enable manual price entry
- `--skip-normalize`: Skip FX conversion (for testing)
- `--skip-derive`: Skip price extraction (for testing)
- `--skip-fetch`: Skip external provider fetching (for testing)

### FxRateProvider (Thin Wrapper)

Simplified to delegate to unified price provider infrastructure:

```typescript
// packages/accounting/src/services/fx-rate-provider.ts

export class FxRateProvider {
  constructor(
    private priceManager: PriceProviderManager, // Unified manager
    private manualRates: Map<string, Decimal> = new Map()
  ) {}

  async getRateToUSD(sourceCurrency: string, datetime: Date): Promise<Result<FxRate, Error>> {
    const currency = Currency.create(sourceCurrency);

    // USD doesn't need conversion
    if (currency.toString() === 'USD') {
      return ok({ rate: parseDecimal('1'), source: 'identity', timestamp: datetime });
    }

    // Check manual rates first
    const manualRate = this.manualRates.get(currency.toString());
    if (manualRate) {
      return ok({ rate: manualRate, source: 'manual', timestamp: datetime });
    }

    // Delegate to price provider manager
    // Manager tries: ECB → BankOfCanada → Fixer (with failover)
    const priceResult = await this.priceManager.fetchPrice({
      asset: currency,
      currency: Currency.create('USD'),
      timestamp: datetime,
    });

    if (priceResult.isErr()) return err(priceResult.error);

    const priceData = priceResult.value.data;
    return ok({
      rate: parseDecimal(priceData.price.toString()),
      source: priceData.source,
      timestamp: priceData.fetchedAt,
    });
  }

  async getRateFromUSD(targetCurrency: string, datetime: Date): Promise<Result<FxRate, Error>> {
    // For USD → CAD, invert the EUR → USD rate
    const usdRate = await this.getRateToUSD(targetCurrency, datetime);
    if (usdRate.isErr()) return err(usdRate.error);

    return ok({
      rate: parseDecimal('1').dividedBy(usdRate.value.rate),
      source: `inverse-${usdRate.value.source}`,
      timestamp: datetime,
    });
  }
}
```

### Cost Basis Pre-flight Validation

Validate all prices are USD before calculation:

```typescript
// packages/accounting/src/services/cost-basis-calculator.ts

export class CostBasisCalculator {
  async calculate(transactions: UniversalTransaction[], config: CostBasisConfig) {
    // Pre-flight validation: ensure all prices in USD
    const nonUsdPrices = this.findNonUsdPrices(transactions);

    if (nonUsdPrices.length > 0) {
      return err(
        new Error(
          `Found ${nonUsdPrices.length} movements with non-USD prices. ` +
            `Run \`prices enrich\` first to normalize all prices to USD. ` +
            `Non-USD movements: ${nonUsdPrices
              .map((p) => `${p.txId}:${p.asset}:${p.currency}`)
              .slice(0, 5)
              .join(', ')}`
        )
      );
    }

    // Calculate purely in USD (no conversions needed)
    return this.calculateInternal(transactions, config);
  }

  private findNonUsdPrices(
    transactions: UniversalTransaction[]
  ): Array<{ txId: number; asset: string; currency: string }> {
    const nonUsd: Array<{ txId: number; asset: string; currency: string }> = [];

    for (const tx of transactions) {
      for (const movement of [...(tx.movements.inflows || []), ...(tx.movements.outflows || [])]) {
        if (movement.priceAtTxTime && movement.priceAtTxTime.price.currency.toString() !== 'USD') {
          nonUsd.push({
            txId: tx.id,
            asset: movement.asset,
            currency: movement.priceAtTxTime.price.currency.toString(),
          });
        }
      }
    }

    return nonUsd;
  }
}
```

### Report Generation with Display Conversion

Convert USD amounts to display currency using historical rates:

```typescript
// packages/accounting/src/reports/cost-basis-report-generator.ts

export class CostBasisReportGenerator {
  constructor(
    private calculator: CostBasisCalculator,
    private fxProvider: FxRateProvider
  ) {}

  async generateReport(
    transactions: UniversalTransaction[],
    config: { displayCurrency: 'USD' | 'CAD' | 'EUR' | 'GBP'; method: 'FIFO' | 'LIFO'; taxYear: number }
  ): Promise<Result<CostBasisReport, Error>> {
    // Calculate cost basis in USD
    const resultsResult = await this.calculator.calculate(transactions, config);
    if (resultsResult.isErr()) return err(resultsResult.error);

    const results = resultsResult.value;

    // If display currency is USD, return as-is
    if (config.displayCurrency === 'USD') {
      return ok({ results, displayCurrency: 'USD' });
    }

    // Convert to display currency using historical rates
    const converted = [];
    const fxRateCache = new Map<string, FxRate>(); // date → rate cache

    for (const result of results) {
      const dateKey = result.transaction.datetime.split('T')[0]; // Daily granularity

      // Check cache first
      let fxRate = fxRateCache.get(dateKey);
      if (!fxRate) {
        // Fetch USD → CAD rate for this transaction's date
        const rateResult = await this.fxProvider.getRateFromUSD(
          config.displayCurrency,
          new Date(result.transaction.datetime) // Historical, NOT today!
        );

        if (rateResult.isErr()) {
          return err(
            new Error(`Missing FX rate for ${config.displayCurrency} on ${dateKey}: ${rateResult.error.message}`)
          );
        }

        fxRate = rateResult.value;
        fxRateCache.set(dateKey, fxRate);
      }

      // Convert all USD amounts to display currency
      converted.push({
        ...result,
        costBasis: result.costBasis.times(fxRate.rate),
        proceeds: result.proceeds?.times(fxRate.rate),
        capitalGain: result.capitalGain?.times(fxRate.rate),
        fxRate, // Include for audit trail
      });
    }

    return ok({ results: converted, displayCurrency: config.displayCurrency });
  }
}
```

---

## Implementation Plan

### Phase 1: Unified Provider Infrastructure

1. Add FX providers to `packages/platform/price-providers`:
   - ECB provider (EUR/USD)
   - Bank of Canada provider (CAD/USD)
   - Update factory to register FX providers

2. Update `PriceProviderManager` to handle fiat assets:
   - Add fiat currency detection
   - Route to appropriate provider (ECB for EUR, BoC for CAD)

3. Tests:
   - Unit tests for ECB/BoC providers
   - Integration tests for unified manager with FX providers
   - E2E tests fetching actual FX rates

### Phase 2: Enrichment Pipeline

1. Create `PricesNormalizeHandler`:
   - Find movements with non-USD fiat prices
   - Fetch FX rates via `PriceProviderManager`
   - Update movements with USD prices + FX metadata

2. Update `price-calculation-utils.ts`:
   - Update `calculatePriceFromTrade()` to only derive from actual USD
   - Check `currency === 'USD'` before deriving prices
   - Stablecoins treated as crypto assets, fetched in Stage 3

3. Create unified `prices enrich` command:
   - Run normalize → derive → fetch in sequence
   - Support `--skip-*` flags for testing
   - Progress reporting across all stages

4. Tests:
   - Unit tests for normalize logic
   - Integration tests for full enrichment pipeline
   - Test EUR/CAD trades normalize to USD
   - Test stablecoin prices fetched (not derived) to capture de-peg events

### Phase 3: Cost Basis Updates

1. Add pre-flight validation to `CostBasisCalculator`:
   - Check all prices are USD before calculating
   - Return clear error with guidance

2. Update `FxRateProvider`:
   - Inject `PriceProviderManager` instead of direct API clients
   - Implement `getRateFromUSD()` for report generation

3. Tests:
   - Test pre-flight validation catches non-USD prices
   - Test error messages guide user to run enrichment

### Phase 4: Report Generation

1. Update report generators to support display currency:
   - Accept `displayCurrency` config parameter
   - Fetch historical FX rates per transaction date
   - Cache same-day rates for performance

2. Tests:
   - Test USD→CAD conversion using historical rates
   - Test date-specific rate caching
   - Verify tax calculations match jurisdiction rules

### Phase 5: Documentation

1. Update CLAUDE.md (concise summary)
2. Create ADR-003 (this document)
3. Update Issue #153 with refined implementation plan
4. Add examples to development guide

---

## Consequences

### Positive

1. **Architectural consistency**: All external data fetching in enrichment phase
2. **Clean separation of concerns**: Import/process pure transformations, no external deps
3. **Reusable infrastructure**: FX providers leverage existing price provider system
4. **No schema changes**: Existing tables support both crypto prices and FX rates
5. **Better testability**: Processors don't need mocked API clients
6. **Flexibility**: Can update FX rates without reimporting
7. **Tax accuracy**: Reports use historical rates at transaction time, not current rates
8. **Audit trail**: FX metadata tracks both storage normalization and display conversions
9. **Performance**: Shared cache reduces redundant API calls
10. **Single source of truth**: All prices in USD for cost basis calculation

### Negative

1. **Temporary mixed-currency state**: Transactions stored in original currency until enrichment runs
2. **Multi-stage enrichment**: Users must run `prices enrich` after import (but this is already true for crypto prices)
3. **Pre-flight validation needed**: Cost basis must validate all prices USD before calculating
4. **Learning curve**: Users need to understand enrichment is separate from import

### Risks

1. **FX provider availability**: If ECB/BoC down, enrichment fails
   - Mitigation: Multi-provider failover, manual rate entry supported

2. **Historical rate gaps**: Provider may not have rates for old dates
   - Mitigation: Manual rate entry, clear error messages

3. **Stablecoin de-peg events**: Historical de-peg events require actual price data (e.g., UST collapse, USDC de-peg to $0.98 in March 2023)
   - Mitigation: Stablecoins treated as crypto assets, fetched in Stage 3 with actual historical prices

4. **Timezone handling**: FX rates are daily, but crypto transactions timestamped to minute
   - Mitigation: Use UTC midnight for daily rates, document granularity in metadata

### Migration Path

No breaking changes - this is additive:

1. Existing data works unchanged (prices already have currency field)
2. New `prices enrich` command available alongside existing commands
3. Cost basis pre-flight validation added, but doesn't break existing workflows
4. FX providers optional - system works without them (manual rates supported)

---

## Alternatives Considered

### Alternative 1: Normalize at Import

**Approach**: Convert all currencies to USD during import/processing phase.

**Pros**:

- Data always in single currency
- No enrichment stage needed for FX

**Cons**:

- External API calls during import (violates separation of concerns)
- Inconsistent with crypto price handling (fetched during enrichment)
- Processors need network access, API keys, FX provider dependencies
- Cannot update FX rates without reimporting
- Harder to test (mocked API clients in processor tests)

**Rejected**: Violates architectural principles, creates technical debt.

### Alternative 2: Event Sourcing with Projections

**Approach**: Store immutable events, derive multiple projections (raw currency, USD, display currency).

**Pros**:

- Single source of truth
- Can rebuild projections with new FX rates
- Full audit trail built-in

**Cons**:

- Major architectural rewrite (event store, projection engine)
- Over-engineered for current requirements
- Adds significant complexity
- Not aligned with existing patterns

**Rejected**: Over-engineered, disproportionate effort for marginal benefit.

### Alternative 3: Multi-Currency Cost Basis

**Approach**: Support cost basis calculations across multiple currencies (EUR lots matched against USD lots).

**Pros**:

- No currency conversions needed
- "Pure" representation of multi-currency portfolio

**Cons**:

- Extremely complex (which FX rate for cross-currency lot matching?)
- Ambiguous tax treatment (which jurisdiction's rules?)
- High implementation cost, low user value
- No clear tax authority guidance for multi-currency matching

**Rejected**: Complexity far exceeds value, unclear tax compliance implications.

---

## Related

- **Issue #153**: Add FX rate tracking to AssetMovement for multi-currency support
- **ADR-002**: Treat Linked Transfers as Non-Taxable Events (fee handling)
- **Issue #101**: Transaction linking (price propagation via links)
- **Issue #96**: Cost basis calculations

---

## References

- European Central Bank API: https://data.ecb.europa.eu/help/api/overview
- Bank of Canada Valet API: https://www.bankofcanada.ca/valet/docs
- CoinGecko Fiat Exchange Rates: https://www.coingecko.com/en/api/documentation
- CRA Cryptocurrency Guide: https://www.canada.ca/en/revenue-agency/programs/about-canada-revenue-agency-cra/compliance/digital-currency/cryptocurrency-guide.html
- IRS Virtual Currency Guidance: https://www.irs.gov/businesses/small-businesses-self-employed/virtual-currencies
