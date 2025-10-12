# @exitbook/accounting

Cost basis calculation, acquisition lot tracking, and capital gains/losses reporting for cryptocurrency transactions.

## Features

- **Multiple Calculation Methods**: FIFO, LIFO, Specific ID, Average Cost
- **Jurisdiction Support**: Canada, US, UK, EU with pluggable tax rules
- **Decimal Precision**: Uses Decimal.js to avoid floating-point errors
- **Audit Trails**: All calculations preserved for historical analysis
- **Idempotent**: Same configuration produces same results

## Usage

```typescript
import { CostBasisCalculator, CanadaRules } from '@exitbook/accounting';

const calculator = new CostBasisCalculator(db, logger);

const result = await calculator.calculate({
  method: 'fifo',
  currency: 'CAD',
  jurisdiction: 'CA',
  taxYear: 2024,
});

if (result.isOk()) {
  console.log('Total gain/loss:', result.value.totalGainLoss);
  console.log('Taxable gain/loss:', result.value.totalTaxableGainLoss);
}
```

## Configuration

```typescript
interface CostBasisConfig {
  method: 'fifo' | 'lifo' | 'specific-id' | 'average-cost';
  currency: 'USD' | 'CAD' | 'EUR' | 'GBP';
  jurisdiction: 'CA' | 'US' | 'UK' | 'EU';
  taxYear: number;
  startDate?: Date;
  endDate?: Date;
  specificLotSelectionStrategy?: 'minimize-gain' | 'maximize-loss';
}
```

## Jurisdiction Rules

### Canada

- 50% capital gains inclusion rate
- No short-term vs long-term distinction
- Superficial loss rules (30 days before OR after)

### United States

- Short-term (<1 year) vs long-term (≥1 year) classification
- 100% taxable (rates differ by classification)
- Wash sale rules (30 days after)

## Architecture

Follows **Functional Core, Imperative Shell** pattern:

- Pure business logic in `*-utils.ts` modules
- Classes only for resource management and side effects
- All functions return `Result<T, Error>` (neverthrow)
