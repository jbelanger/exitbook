# ADR 003: Unified Price and FX Rate Enrichment Architecture

**Date**: 2025-11-01
**Status**: Accepted
**Implementation Date**: 2025-11-03
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

4. **Execution price derivation**: Extract prices from fiat trades (USD + non-USD)
   - USD trades ✅ (highest confidence, marked as 'exchange-execution')
   - EUR/CAD/GBP trades ✅ (derive in native currency as 'fiat-execution-tentative', then normalize to USD)
   - USDC, USDT, DAI ❌ (treat as crypto assets, fetch in Stage 3 to avoid missing de-peg events)

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
│ Stage 1: derive (first pass)                                │
│ • Extract prices from USD trades (highest confidence)      │
│ • Extract prices from non-USD fiat trades (EUR, CAD, GBP)  │
│   - Fiat gets identity price (1 CAD = 1 CAD)               │
│   - Crypto gets price in fiat currency (100 XLM = 50 CAD)  │
│   - Marked as 'fiat-execution-tentative' (priority 0)      │
│ • Propagate prices via transaction links                   │
│ • Stamp identity prices on fiat movements                  │
│                                                             │
│ Stage 2: normalize                                          │
│ • Find non-USD fiat prices (EUR, CAD, GBP)                 │
│ • Fetch FX rates via PriceProviderManager                  │
│ • Convert to USD, populate fxRateToUSD metadata            │
│ • Upgrade source: 'fiat-execution-tentative' (priority 0)  │
│   → 'derived-ratio' (priority 2)                           │
│                                                             │
│ Stage 3: fetch                                              │
│ • Fetch missing crypto prices from external providers      │
│ • Always in USD (source: provider name, priority 1)        │
│ • Cannot overwrite derived-ratio prices (priority 2)       │
│                                                             │
│ Stage 4: derive (second pass)                               │
│ • Use newly fetched/normalized prices for ratio calcs      │
│ • Propagate via links (Pass 1 + Pass N+2)                  │
│                                                             │
│ Result: All prices in USD with full audit trail            │
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
│  ├─ ecb/                # FX rates (European Central Bank)
│  │  ├─ provider.ts      # Implements IPriceProvider (same interface!)
│  │  ├─ schemas.ts
│  │  └─ __tests__/
│  ├─ bank-of-canada/     # FX rates (CAD/USD)
│  │  ├─ provider.ts
│  │  ├─ schemas.ts
│  │  └─ __tests__/
│  ├─ frankfurter/        # FX rates (ECB data, 31 currencies)
│  │  ├─ provider.ts      # Simpler API than ECB, more currencies
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
      supportedAssetTypes: ['fiat'],
      supportedAssets: ['EUR'], // ECB only provides EUR as base currency
      rateLimit: {
        requestsPerSecond: 0.2, // ~12 per minute
        requestsPerMinute: 10,
        requestsPerHour: 300,
        burstLimit: 5,
      },
      granularitySupport: [
        {
          granularity: 'day',
          maxHistoryDays: undefined, // Historical data back to 1999
          limitation: 'ECB provides daily exchange rates (no intraday granularity)',
        },
      ],
    },
    requiresApiKey: false,
  };

  protected async fetchPriceInternal(query: PriceQuery): Promise<Result<PriceData, Error>> {
    const { asset, currency, timestamp } = query;

    // Validate: asset must be EUR, currency must be USD
    if (asset.toString() !== 'EUR') {
      return err(new Error(`ECB only supports EUR as base currency, got ${asset}`));
    }
    if (currency.toString() !== 'USD') {
      return err(new Error(`ECB only supports USD target, got ${currency}`));
    }

    // Build flow reference for ECB SDMX API
    const flowRef = buildECBFlowRef(asset.toString(), currency.toString());
    const dateStr = formatECBDate(timestamp);

    // Fetch from ECB SDMX API
    const response = await this.httpClient.get(flowRef, {
      params: {
        startPeriod: dateStr,
        endPeriod: dateStr,
        format: 'jsondata',
      },
    });

    // Transform and validate response
    const transformResult = transformECBResponse(response, asset, currency, timestamp);
    if (transformResult.isErr()) {
      return err(transformResult.error);
    }

    return ok(transformResult.value);
  }
}
```

### Enrichment Command Structure

Single unified command with four-stage pipeline:

```bash
pnpm run dev prices enrich [options]
```

**Stage 1: Derive (First Pass)**

- Extract prices from USD trades (highest confidence)
- Extract prices from non-USD fiat trades (EUR, CAD, etc.)
  - Fiat gets identity price (1 CAD = 1 CAD)
  - Crypto gets price in fiat currency (marked as 'fiat-execution-tentative')
- Propagate prices via transaction links
- Service: `PriceEnrichmentService`

**Stage 2: Normalize**

- Find movements with non-USD fiat prices
- Fetch FX rates via `PriceProviderManager` (tries ECB → Bank of Canada → Frankfurter)
- Convert to USD, populate fxRateToUSD metadata
- Upgrade source: 'fiat-execution-tentative' → 'derived-ratio' (priority 2)
- Service: `PriceNormalizationService`

**Stage 3: Fetch**

- Fetch missing crypto prices from external providers
- Always in USD (source: provider name, priority 1)
- Cannot overwrite derived-ratio prices (priority 2)
- Handler: `PricesFetchHandler`

**Stage 4: Derive (Second Pass)**

- Use newly fetched/normalized prices for ratio calculations
- Propagate via transaction links (Pass 1 + Pass N+2)
- Service: `PriceEnrichmentService`

**Unified Handler**: `PricesEnrichHandler` (orchestrates all stages)

**Options**:

- `--asset <symbol>`: Filter by specific asset (repeatable)
- `--interactive`: Enable manual price/FX entry when providers fail
- `--derive-only`: Only run derivation stages (skip normalize/fetch)
- `--normalize-only`: Only run normalization stage (skip derive/fetch)
- `--fetch-only`: Only run fetch stage (skip derive/normalize)

### FX Rate Provider Architecture

Clean Architecture pattern with interface-based design:

**Interface** (`packages/accounting/src/price-enrichment/fx-rate-provider.interface.ts`):

```typescript
/**
 * Provider for FX rates - defines contract without coupling to implementations
 */
export interface IFxRateProvider {
  /**
   * Get FX rate to convert from source currency to USD
   * @returns FX rate data with audit trail
   */
  getRateToUSD(sourceCurrency: Currency, timestamp: Date): Promise<Result<FxRateData, Error>>;

  /**
   * Get FX rate to convert from USD to target currency
   * Used for report generation (e.g., USD capital gains → CAD for Canadian tax reports)
   * @returns Inverted FX rate data with audit trail
   */
  getRateFromUSD(targetCurrency: Currency, timestamp: Date): Promise<Result<FxRateData, Error>>;
}

export interface FxRateData {
  rate: Decimal;
  source: string; // e.g., 'ecb', 'bank-of-canada', 'user-provided'
  fetchedAt: Date;
}
```

**Standard Implementation** (`packages/accounting/src/price-enrichment/standard-fx-rate-provider.ts`):

```typescript
/**
 * Standard implementation that delegates to PriceProviderManager
 * Manager tries providers in order: ECB → Bank of Canada → Frankfurter
 */
export class StandardFxRateProvider implements IFxRateProvider {
  constructor(private readonly priceManager: PriceProviderManager) {}

  async getRateToUSD(sourceCurrency: Currency, timestamp: Date): Promise<Result<FxRateData, Error>> {
    // Fetch FX rate from provider manager (with automatic failover)
    const fxRateResult = await this.priceManager.fetchPrice({
      asset: sourceCurrency,
      currency: Currency.create('USD'),
      timestamp,
    });

    if (fxRateResult.isErr()) {
      return err(new Error(`Failed to fetch FX rate for ${sourceCurrency} → USD: ${fxRateResult.error.message}`));
    }

    const fxData = fxRateResult.value.data;

    return ok({
      rate: fxData.price,
      source: fxData.source,
      fetchedAt: fxData.fetchedAt,
    });
  }

  async getRateFromUSD(targetCurrency: Currency, timestamp: Date): Promise<Result<FxRateData, Error>> {
    // Fetch target → USD and invert the rate
    // Example: CAD → USD = 0.74, so USD → CAD = 1/0.74 = 1.35
    const fxRateResult = await this.priceManager.fetchPrice({
      asset: targetCurrency,
      currency: Currency.create('USD'),
      timestamp,
    });

    if (fxRateResult.isErr()) {
      return err(new Error(`Failed to fetch FX rate for USD → ${targetCurrency}: ${fxRateResult.error.message}`));
    }

    const fxData = fxRateResult.value.data;
    const rateToUsd = fxData.price;
    const rateFromUsd = new Decimal(1).div(rateToUsd);

    return ok({
      rate: rateFromUsd,
      source: fxData.source,
      fetchedAt: fxData.fetchedAt,
    });
  }
}
```

**Interactive Implementation** (`apps/cli/src/features/prices/interactive-fx-rate-provider.ts`):

```typescript
/**
 * CLI-layer wrapper that prompts user for manual FX rate entry
 * when underlying provider fails. Implements decorator pattern.
 */
export class InteractiveFxRateProvider implements IFxRateProvider {
  constructor(
    private readonly underlyingProvider: IFxRateProvider, // Typically StandardFxRateProvider
    private readonly interactive: boolean
  ) {}

  async getRateToUSD(sourceCurrency: Currency, timestamp: Date): Promise<Result<FxRateData, Error>> {
    // Try underlying provider first (ECB, Bank of Canada, Frankfurter)
    const result = await this.underlyingProvider.getRateToUSD(sourceCurrency, timestamp);

    // If successful or not interactive, return as-is
    if (result.isOk() || !this.interactive) {
      return result;
    }

    // Interactive mode: prompt user for manual entry
    const manualRate = await promptManualFxRate(sourceCurrency.toString(), 'USD', timestamp);

    if (!manualRate) {
      return result; // User declined, return original error
    }

    // User provided manual rate
    return ok({
      rate: manualRate.rate,
      source: 'user-provided',
      fetchedAt: new Date(),
    });
  }

  // getRateFromUSD follows same pattern (try provider → prompt if needed)
}
```

### Cost Basis Pre-flight Validation

Validate all prices are USD before calculation:

```typescript
// packages/accounting/src/services/cost-basis-calculator.ts

export class CostBasisCalculator {
  constructor(private readonly repository: CostBasisRepository) {
    this.lotMatcher = new LotMatcher();
    this.gainLossCalculator = new GainLossCalculator();
  }

  async calculate(
    transactions: UniversalTransaction[],
    config: CostBasisConfig,
    rules: IJurisdictionRules
  ): Promise<Result<CostBasisSummary, Error>> {
    // Pre-flight validation: ensure all prices are in USD
    const nonUsdMovements = this.findMovementsWithNonUsdPrices(transactions);

    if (nonUsdMovements.length > 0) {
      const exampleCount = Math.min(5, nonUsdMovements.length);
      const examples = nonUsdMovements
        .slice(0, exampleCount)
        .map((m) => `  - Transaction ${m.transactionId} (${m.datetime}): ${m.asset} with price in ${m.currency}`)
        .join('\n');

      return err(
        new Error(
          `Found ${nonUsdMovements.length} movement(s) with non-USD prices. ` +
            `Run 'prices enrich' to normalize all prices to USD first.\n\n` +
            `First ${exampleCount} example(s):\n${examples}`
        )
      );
    }

    // Calculate cost basis with lot matching, gain/loss calculations, and jurisdiction rules
    // ... (implementation continues)
  }

  private findMovementsWithNonUsdPrices(
    transactions: UniversalTransaction[]
  ): Array<{ transactionId: number; datetime: string; asset: string; currency: string }> {
    const nonUsd: Array<{ transactionId: number; datetime: string; asset: string; currency: string }> = [];

    for (const tx of transactions) {
      for (const movement of [...(tx.movements.inflows || []), ...(tx.movements.outflows || [])]) {
        if (movement.priceAtTxTime && movement.priceAtTxTime.price.currency.toString() !== 'USD') {
          nonUsd.push({
            transactionId: tx.id,
            datetime: tx.datetime,
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

export interface ReportGeneratorConfig {
  displayCurrency: string; // e.g., 'USD', 'CAD', 'EUR', 'GBP'
  calculationId: string; // Reference to completed cost basis calculation
}

export class CostBasisReportGenerator {
  constructor(
    private readonly repository: CostBasisRepository,
    private readonly fxProvider: IFxRateProvider
  ) {}

  async generateReport(config: ReportGeneratorConfig): Promise<Result<CostBasisReport, Error>> {
    const { calculationId, displayCurrency } = config;

    // Load calculation from repository
    const calculationResult = await this.repository.findCalculationById(calculationId);
    if (calculationResult.isErr()) return err(calculationResult.error);

    const calculation = calculationResult.value;
    if (!calculation) {
      return err(new Error(`Calculation ${calculationId} not found`));
    }

    // Load all disposals for this calculation
    const disposalsResult = await this.repository.findDisposalsByCalculationId(calculationId);
    if (disposalsResult.isErr()) return err(disposalsResult.error);

    const disposals = disposalsResult.value;

    // If display currency is USD, no conversion needed
    if (displayCurrency === 'USD') {
      return this.generateUsdReport(calculation, disposals);
    }

    // Convert each disposal to display currency
    const convertedDisposalsResult = await this.convertDisposals(disposals, displayCurrency);
    if (convertedDisposalsResult.isErr()) return err(convertedDisposalsResult.error);

    const convertedDisposals = convertedDisposalsResult.value;

    // Calculate summary totals in display currency
    const summary = this.calculateSummary(convertedDisposals);

    return ok({
      calculationId,
      displayCurrency,
      originalCurrency: 'USD',
      disposals: convertedDisposals,
      summary,
    });
  }

  private async convertDisposals(
    disposals: LotDisposal[],
    displayCurrency: string
  ): Promise<Result<ConvertedLotDisposal[], Error>> {
    const converted: ConvertedLotDisposal[] = [];
    const fxRateCache = new Map<string, FxRateData>(); // date → rate cache

    for (const disposal of disposals) {
      const dateKey = disposal.disposalDate.split('T')[0]; // Daily granularity

      // Check cache first
      let fxRate = fxRateCache.get(dateKey);
      if (!fxRate) {
        // Fetch USD → display currency rate for this disposal's date (historical rate!)
        const rateResult = await this.fxProvider.getRateFromUSD(
          Currency.create(displayCurrency),
          new Date(disposal.disposalDate)
        );

        if (rateResult.isErr()) {
          return err(new Error(`Missing FX rate for ${displayCurrency} on ${dateKey}: ${rateResult.error.message}`));
        }

        fxRate = rateResult.value;
        fxRateCache.set(dateKey, fxRate);
      }

      // Convert all USD amounts to display currency
      converted.push({
        ...disposal,
        proceeds: disposal.proceeds.times(fxRate.rate),
        costBasis: disposal.costBasis.times(fxRate.rate),
        gainLoss: disposal.gainLoss.times(fxRate.rate),
        fxConversion: {
          // Metadata for audit trail
          rate: fxRate.rate,
          source: fxRate.source,
          fetchedAt: fxRate.fetchedAt,
          originalCurrency: 'USD',
          targetCurrency: displayCurrency,
        },
      });
    }

    return ok(converted);
  }
}
```

---

## Implementation Summary

This architecture has been fully implemented as of 2025-11-03. The following modules were delivered:

### Unified Price Provider Infrastructure

**FX Providers** (`packages/platform/price-providers/src/`):

- `ecb/provider.ts` - European Central Bank (EUR→USD, daily rates back to 1999)
- `bank-of-canada/provider.ts` - Bank of Canada (CAD→USD, daily rates)
- `frankfurter/provider.ts` - Frankfurter API (31 currencies, ECB data source, no API key)

**Provider Management**:

- `shared/factory.ts` - Auto-registers all providers (crypto + FX)
- `shared/provider-manager.ts` - Unified manager with automatic failover
- All FX providers implement same `IPriceProvider` interface as crypto providers
- Single prices database (`./data/prices.db`) stores both crypto prices and FX rates

### Four-Stage Enrichment Pipeline

**Orchestration** (`apps/cli/src/features/prices/`):

- `prices-enrich-handler.ts` - Orchestrates derive → normalize → fetch → re-derive pipeline
- `prices-enrich.ts` - CLI command with `--derive-only`, `--normalize-only`, `--fetch-only` flags

**Stage 1: Derive** (`packages/accounting/src/price-enrichment/`):

- `price-enrichment-service.ts` - Extracts prices from trades (USD + non-USD fiat)
- `price-calculation-utils.ts` - Trade detection, price calculation, fiat identity stamping
  - USD trades: Marked as 'exchange-execution' (highest confidence)
  - Non-USD fiat trades: Marked as 'fiat-execution-tentative' (priority 0, will be upgraded)

**Stage 2: Normalize** (`packages/accounting/src/price-enrichment/`):

- `price-normalization-service.ts` - Converts non-USD fiat prices to USD
- Upgrades source: 'fiat-execution-tentative' → 'derived-ratio' (priority 2)
- Populates FX metadata (rate, source, timestamp)

**Stage 3: Fetch** (`apps/cli/src/features/prices/`):

- `prices-handler.ts` - Fetches missing crypto prices from external providers
- Priority system ensures derived-ratio prices (priority 2) not overwritten by provider prices (priority 1)

**Stage 4: Re-derive** (`packages/accounting/src/price-enrichment/`):

- Second pass of `PriceEnrichmentService` using newly fetched/normalized prices
- Ratio calculations and link propagation (Pass 1 + Pass N+2)

### FX Rate Provider Architecture

**Interface** (`packages/accounting/src/price-enrichment/`):

- `fx-rate-provider.interface.ts` - Clean Architecture: domain layer defines contract
- `IFxRateProvider` with `getRateToUSD()` and `getRateFromUSD()` methods
- `FxRateData` includes audit trail (rate, source, fetchedAt)

**Implementations**:

- `standard-fx-rate-provider.ts` - Delegates to `PriceProviderManager` (tries ECB → BoC → Frankfurter)
- `apps/cli/src/features/prices/interactive-fx-rate-provider.ts` - CLI wrapper that prompts for manual entry on failure

### Cost Basis Integration

**Pre-flight Validation** (`packages/accounting/src/services/`):

- `cost-basis-calculator.ts` - `findMovementsWithNonUsdPrices()` validation before calculation
- Returns detailed error with examples if non-USD prices detected
- Requires jurisdiction rules (`IJurisdictionRules`) for tax calculations

**Report Generation** (`packages/accounting/src/reports/`):

- `cost-basis-report-generator.ts` - Repository-backed, uses `ReportGeneratorConfig`
- Converts USD amounts to display currency using historical rates
- Per-transaction FX conversion with date-specific rate caching
- Full FX metadata in output for audit trail

### Testing & Quality

All modules include comprehensive test coverage:

- Unit tests for providers, services, utilities
- Integration tests for enrichment pipeline
- E2E tests with real API calls
- Test fixtures for EUR/CAD trades, stablecoin de-peg scenarios

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

### Migration Path (Completed)

Implementation was fully backward-compatible with no breaking changes:

1. Existing data worked unchanged (prices table already had currency field)
2. `prices enrich` command added alongside existing commands
3. Cost basis pre-flight validation guides users to run enrichment when needed
4. Interactive mode supports manual rate entry when providers unavailable

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
