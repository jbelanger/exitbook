# Prices Enrich — Operation Tree Spec

## Overview

`exitbook prices enrich` runs the four-stage price enrichment pipeline and displays progress as an Ink operation tree. Each stage runs sequentially; render updates happen between stages and on progress callbacks within the market prices stage.

---

## Stage Labels

Active states use verb phrases; completed states use result-oriented phrasing:

| Stage | Active (spinner)        | Completed (✓)     | Internal key   |
| ----- | ----------------------- | ----------------- | -------------- |
| 1     | Extracting trade prices | Trade prices      | `tradePrices`  |
| 2     | Normalizing FX rates    | FX rates          | `fxRates`      |
| 3     | Fetching market prices  | Market prices     | `marketPrices` |
| 4     | Propagating prices      | Price propagation | `propagation`  |

---

## Visual Examples

### Full Pipeline (All Stages)

```
✓ Trade prices (340ms)
  └─ 142 transactions updated
✓ FX rates (1.2s)
  ├─ 89 movements converted to USD
  └─ 12 skipped
✓ Market prices (8.4s)
  ├─ 312 fetched from providers
  ├─ 1,204 movements updated
  └─ 3 failures
✓ Price propagation (280ms)
  └─ 38 transactions updated

✓ Done (10.2s)

──────────────────────────────────────────────────────────────────────────────
315 API calls
  coingecko     2.8 req/s    24ms   280 calls   280 ok (200)
  cryptocomp…   0.4 req/s    89ms    35 calls    35 ok (200)

Next: exitbook prices view --missing-only
```

### Single Stage (Trade Prices Only)

```
✓ Trade prices (320ms)
  └─ 142 transactions updated

✓ Done (320ms)
```

### Single Stage (Market Prices Only)

```
✓ Market prices (12.1s)
  ├─ 312 fetched from providers
  ├─ 1,204 movements updated
  ├─ 14 skipped
  └─ 3 failures

✓ Done (12.1s)

──────────────────────────────────────────────────────────────────────────────
315 API calls
  coingecko     2.8 req/s    24ms   280 calls   280 ok (200)
  cryptocomp…   0.4 req/s    89ms    35 calls    35 ok (200)
```

### Active State (Market Prices In Progress)

```
✓ Trade prices (340ms)
  └─ 142 transactions updated
✓ FX rates (1.2s)
  ├─ 89 movements converted to USD
  └─ 12 skipped
⠋ Fetching market prices · 124/847 · 3.2s

──────────────────────────────────────────────────────────────────────────────
coingecko     ● 3.1 req/s    22ms   98 ok
```

### Warnings (FX Rate Failures)

```
✓ Trade prices (340ms)
  └─ 142 transactions updated
⚠ FX rates (1.8s)
  ├─ 76 movements converted to USD
  ├─ 12 skipped
  └─ 3 failures
    ├─ EUR→USD rate not found for 2019-03-15
    ├─ CAD→USD rate not found for 2019-04-22
    └─ EUR→USD rate not found for 2019-06-01
✓ Market prices (8.4s)
  ├─ 312 fetched from providers
  └─ 1,204 movements updated
✓ Price propagation (280ms)
  └─ 38 transactions updated

✓ Done (10.8s)

──────────────────────────────────────────────────────────────────────────────
315 API calls
  coingecko     2.8 req/s    24ms   280 calls   280 ok (200)
  cryptocomp…   0.4 req/s    89ms    35 calls    35 ok (200)

Next: exitbook prices view --missing-only
```

### Fail Fast (--on-missing fail)

```
✓ Trade prices (340ms)
  └─ 142 transactions updated
✓ FX rates (0.9s)
  ├─ 68 movements converted to USD
  └─ 12 skipped

⚠ Failed (1.2s)
  FX rate conversion aborted: 3 failures
  Run: exitbook prices view --missing-only
```

### Fetch Fail Fast

```
✓ Trade prices (340ms)
  └─ 142 transactions updated
✓ FX rates (1.2s)
  ├─ 89 movements converted to USD
  └─ 12 skipped

⚠ Failed (2.8s)
  Missing price for PENDLE (tx #2041, 2024-03-15)
  Run: exitbook prices set --asset PENDLE --date "2024-03-15T14:23:41Z" --price <amount> --currency USD
```

### Aborted (Ctrl-C)

```
✓ Trade prices (340ms)
  └─ 142 transactions updated
✓ FX rates (1.2s)
  ├─ 89 movements converted to USD
  └─ 12 skipped
⠋ Fetching market prices · 124/847 · 3.2s

⚠ Aborted (4.8s)
```

### Nothing to Do

```
✓ Trade prices (120ms)
  └─ 0 transactions updated
✓ FX rates (80ms)
  └─ 0 movements to convert
✓ Market prices (200ms)
  └─ 0 transactions need prices

✓ Done (400ms)
```

---

## Operation Tree Structure

### Stage 1: Trade Prices

Extracts prices from your own trade data (e.g., you bought ETH at $3,200 on Kraken — that's a known price). Also propagates prices across transaction links.

Active:

```
⠋ Extracting trade prices · {duration}
```

Completed:

```
✓ Trade prices ({duration})
  └─ {transactionsUpdated} transactions updated
```

Nothing to do:

```
✓ Trade prices ({duration})
  └─ 0 transactions updated
```

### Stage 2: FX Rates

Converts non-USD fiat prices to USD (e.g., a EUR trade → USD via ECB exchange rate).

Active:

```
⠋ Normalizing FX rates · {duration}
```

Completed (success):

```
✓ FX rates ({duration})
  ├─ {movementsNormalized} movements converted to USD
  └─ {movementsSkipped} skipped
```

Completed (with failures — pipeline continues):

```
⚠ FX rates ({duration})
  ├─ {movementsNormalized} movements converted to USD
  ├─ {movementsSkipped} skipped
  └─ {failures} failures
    ├─ {error1}
    ├─ {error2}
    └─ {errorN}
```

Nothing to do:

```
✓ FX rates ({duration})
  └─ 0 movements to convert
```

Sub-line rules:

- `skipped` line only appears when > 0
- Failure error lines are nested under the failures count, showing up to 5
- Last sub-line uses `└─`, others use `├─`

### Stage 3: Market Prices

Downloads missing prices from external providers (CoinGecko, CryptoCompare).

Active (with progress):

```
⠋ Fetching market prices · {processed}/{total} · {duration}
```

Completed (success):

```
✓ Market prices ({duration})
  ├─ {pricesFetched} fetched from providers
  ├─ {movementsUpdated} movements updated
  └─ {failures} failures
```

Completed (with failures — pipeline continues):

```
⚠ Market prices ({duration})
  ├─ {pricesFetched} fetched from providers
  ├─ {movementsUpdated} movements updated
  ├─ {skipped} skipped
  └─ {failures} failures
    ├─ {error1}
    └─ {errorN}
```

Nothing to do:

```
✓ Market prices ({duration})
  └─ 0 transactions need prices
```

Sub-line rules:

- `skipped` line only appears when > 0
- `failures` line only appears when > 0 (except in nothing-to-do case)
- Failure error lines nested, showing up to 5
- Last sub-line uses `└─`, others use `├─`

### Stage 4: Price Propagation

Propagates newly fetched/normalized prices to related transactions (via links, ratio calculations).

Only runs when Stage 2 or Stage 3 ran (full pipeline).

Active:

```
⠋ Propagating prices · {duration}
```

Completed:

```
✓ Price propagation ({duration})
  └─ {transactionsUpdated} transactions updated
```

### Completion

Success:

```
✓ Done ({totalDuration})
```

With next steps (only when failures > 0 or missing prices remain):

```
✓ Done ({totalDuration})

Next: exitbook prices view --missing-only
```

Aborted:

```
⚠ Aborted ({totalDuration})
```

Failed:

```
⚠ Failed ({totalDuration})
  {errorMessage}
  {suggestedAction}
```

---

## Color Specification

Follows the same three-tier hierarchy as the ingestion dashboard.

### Signal tier (icons)

| Icon | Color  | Meaning                        |
| ---- | ------ | ------------------------------ |
| `✓`  | green  | Completed successfully         |
| `⠋`  | cyan   | Active (spinner)               |
| `⚠`  | yellow | Completed with warnings / fail |

### Content tier (what you read)

| Element                                                                                                          | Color      |
| ---------------------------------------------------------------------------------------------------------------- | ---------- |
| Active labels: `Extracting trade prices`, `Normalizing FX rates`, `Fetching market prices`, `Propagating prices` | white/bold |
| Completed labels: `Trade prices`, `FX rates`, `Market prices`, `Price propagation`                               | white/bold |
| Counts: `142`, `89`, `312`                                                                                       | green      |
| `0 transactions updated`, `0 movements to convert`, `0 transactions need prices`                                 | dim        |
| `failures` when > 0                                                                                              | yellow     |
| Error detail text                                                                                                | yellow     |
| `Done` / `Failed` / `Aborted`                                                                                    | white/bold |

### Context tier (recedes)

| Element                                                      | Color |
| ------------------------------------------------------------ | ----- |
| Durations                                                    | dim   |
| Tree chars `├─` `└─`                                         | dim   |
| Labels: `transactions updated`, `movements converted to USD` | dim   |
| `skipped`                                                    | dim   |
| Progress counter: `124/847`                                  | dim   |
| `Next:` hint line                                            | dim   |

---

## API Footer

Reuses the same `ApiFooter` component from the ingestion dashboard. Separated from the operation tree by a full-width dim `─` divider.

### Live View (During Market Prices Stage)

Per-provider rows with active/idle indicator, live rate, latency, and status breakdown:

```
──────────────────────────────────────────────────────────────────────────────
coingecko     ● 3.1 req/s    22ms   98 ok
cryptocomp…   ○ idle          —ms    0
```

- `●` green = active (called within last 2s), `○` dim = idle
- Rate: cyan when active, dim when idle
- Latency: dim
- Counts: ok (green), throttled (yellow), err (red)

### Final View (After Completion)

Per-provider rows with average rate, latency, total calls, and response breakdown:

```
──────────────────────────────────────────────────────────────────────────────
315 API calls
  coingecko     2.8 req/s    24ms   280 calls   280 ok (200)
  cryptocomp…   0.4 req/s    89ms    35 calls    35 ok (200)
```

Multi-provider shows total header line. Single provider omits it.

Response breakdown includes status codes: `ok (200)`, `throttled (429)`, `err (500)`.

### When Shown

- Only when API calls were made (market prices or FX rates stages ran and made external calls)
- Not shown for trade-prices-only or propagation-only runs
- Lives below the completion line (`✓ Done`) and above the `Next:` hint

---

## State Model

```typescript
type OperationStatus = 'pending' | 'active' | 'complete' | 'warning' | 'error';

interface PricesEnrichState {
  // Stage 1: Trade prices
  tradePrices?:
    | {
        status: OperationStatus;
        startedAt: number;
        completedAt?: number | undefined;
        transactionsUpdated: number;
      }
    | undefined;

  // Stage 2: FX rates
  fxRates?:
    | {
        status: OperationStatus;
        startedAt: number;
        completedAt?: number | undefined;
        movementsNormalized: number;
        movementsSkipped: number;
        failures: number;
        errors: string[];
      }
    | undefined;

  // Stage 3: Market prices
  marketPrices?:
    | {
        status: OperationStatus;
        startedAt: number;
        completedAt?: number | undefined;
        transactionsFound: number;
        processed: number;
        pricesFetched: number;
        movementsUpdated: number;
        skipped: number;
        failures: number;
        errors: string[];
      }
    | undefined;

  // Stage 4: Price propagation
  propagation?:
    | {
        status: OperationStatus;
        startedAt: number;
        completedAt?: number | undefined;
        transactionsUpdated: number;
      }
    | undefined;

  // API call tracking (shared with import dashboard)
  apiCalls: {
    total: number;
    byProvider: Map<string, ProviderApiStats>;
  };

  // Completion
  isComplete: boolean;
  aborted?: boolean | undefined;
  errorMessage?: string | undefined;
  suggestedAction?: string | undefined;
  totalDurationMs?: number | undefined;

  // Pipeline configuration
  stages: {
    tradePrices: boolean;
    fxRates: boolean;
    marketPrices: boolean;
  };
}
```

`ProviderApiStats` is reused from `ingestion-monitor-state.ts` — same shape, same live/final rendering logic.

---

## Handler Changes

### Progress Callbacks

The `PricesEnrichHandler` needs progress callback support for the Ink renderer. The market prices stage (longest-running) reports per-transaction progress; all stages report API call metrics:

```typescript
interface EnrichProgressCallbacks {
  onStageStart: (stage: 'tradePrices' | 'fxRates' | 'marketPrices' | 'propagation') => void;
  onProgress: (stage: 'marketPrices', processed: number, total: number) => void;
  onStageComplete: (stage: 'tradePrices' | 'fxRates' | 'marketPrices' | 'propagation', result: StageResult) => void;
  onApiCall: (provider: string, metric: { status: number; duration: number }) => void;
  onError: (stage: string, error: Error) => void;
}

type StageResult =
  | { stage: 'tradePrices'; transactionsUpdated: number }
  | { stage: 'fxRates'; movementsNormalized: number; movementsSkipped: number; failures: number; errors: string[] }
  | {
      stage: 'marketPrices';
      pricesFetched: number;
      movementsUpdated: number;
      skipped: number;
      failures: number;
      errors: string[];
    }
  | { stage: 'propagation'; transactionsUpdated: number };
```

The handler accepts an optional `callbacks` parameter. When absent (JSON mode), behavior is unchanged.

### Drop `--on-missing prompt`

Remove the `prompt` value from the `onMissing` option. The schema becomes:

```typescript
onMissing: z.enum(['fail']).optional(); // default: continue (collect errors, report at end)
```

- **Default (no flag)**: Continue on failures, collect errors, report at end
- **`--on-missing fail`**: Abort on first failure with actionable error

Users fix missing prices via `prices view --missing-only` (inline set-price) then re-enrich.

### Remove Interactive FX Rate Provider

With `--on-missing prompt` removed:

- `InteractiveFxRateProvider` is no longer used by enrich
- FX rates stage always uses `StandardFxRateProvider`
- `prices-prompts.ts` functions (`promptManualPrice`, `promptManualFxRate`) are removed from the enrich flow

---

## JSON Mode (`--json`)

Bypasses the Ink TUI entirely. Same output shape as current implementation:

```json
{
  "tradePrices": {
    "transactionsUpdated": 142
  },
  "fxRates": {
    "movementsNormalized": 89,
    "movementsSkipped": 12,
    "failures": 0,
    "errors": []
  },
  "marketPrices": {
    "stats": {
      "transactionsFound": 847,
      "pricesFetched": 312,
      "movementsUpdated": 1204,
      "skipped": 14,
      "failures": 3,
      "manualEntries": 0,
      "granularity": { "minute": 280, "hour": 20, "day": 12 }
    },
    "errors": ["Transaction 2041, asset PENDLE: Coin not found"]
  },
  "propagation": {
    "transactionsUpdated": 38
  },
  "runStats": {
    "total": 315,
    "avgDuration": 31,
    "byProvider": { "coingecko": 280, "cryptocompare": 35 },
    "byEndpoint": {}
  }
}
```

---

## Command Options

```
exitbook prices enrich [options]

Options:
  --asset <currency>       Filter by asset (repeatable)
  --on-missing <behavior>  How to handle missing prices: fail (abort on first error)
  --normalize-only         Only run FX rates stage
  --derive-only            Only run trade prices stage
  --fetch-only             Only run market prices stage
  --json                   Output JSON, bypass TUI
  -h, --help               Display help
```

Removed options:

- `--on-missing prompt` — replaced by `prices view --missing-only` workflow
- `--interactive` — removed (was alias for prompt mode)
- `--dry-run` — removed (not implemented in handler)

---

## Implementation Notes

- The operation tree is a standalone Ink component, not reusing the ingestion dashboard
- Shares the same color conventions, `formatDuration`, `StatusIcon`, and `ApiFooter` components
- Market prices stage is the only stage with a live progress counter (others complete quickly)
- SIGINT handler calls `abort()` on state, re-renders with abort status, exits
- Error messages in the tree are truncated to first 5; full list available in JSON mode
- `ProviderApiStats` and `ApiFooter` are reused directly from the ingestion dashboard — same state shape, same live/final rendering, same provider-level breakdown with status codes
