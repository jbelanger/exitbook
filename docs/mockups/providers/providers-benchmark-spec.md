# Providers Benchmark — Interactive TUI Spec

## Overview

`exitbook providers benchmark` tests live API rate limits for a specific blockchain provider by sending real requests at increasing rates. It replaces the legacy `benchmark-rate-limit` top-level command.

Three-phase design: **testing** (live progress as rates are tested), **results** (summary with recommendations), **complete** (final output).

Non-interactive — runs to completion and exits. No navigation or cursor. The TUI shows live progress during the benchmark, then final results.

`--json` bypasses the TUI.

---

## Visual Example (Testing Phase)

```
Benchmark  alchemy · ethereum   testing rate limits

  Provider: alchemy
  Blockchain: ethereum
  Current rate limit: 5/sec
  Requests per test: 10

  Sustained Rate Tests
    ✓  0.5 req/sec   avg 132ms
    ✓  1.0 req/sec   avg 128ms
    ✓  2.0 req/sec   avg 145ms
    ⠋  5.0 req/sec   testing...
```

---

## Visual Example (Results Phase)

```
Benchmark  alchemy · ethereum   complete

  Provider: alchemy
  Blockchain: ethereum
  Current rate limit: 5/sec
  Requests per test: 10

  Sustained Rate Tests
    ✓  0.5 req/sec   avg 132ms
    ✓  1.0 req/sec   avg 128ms
    ✓  2.0 req/sec   avg 145ms
    ✓  5.0 req/sec   avg 161ms

  Burst Limit Tests
    ✓  30 req/min
    ✓  60 req/min
    ✗  120 req/min

  Maximum safe sustained rate: 5.0 req/sec

  Recommended configuration (80% safety margin):
    requestsPerSecond: 4
    burstLimit: 60

  Config override for blockchain-explorers.json:
    { "ethereum": { "overrides": { "alchemy": { "rateLimit": { "requestsPerSecond": 4, "burstLimit": 60 } } } } }
```

---

## Header

```
Benchmark  {provider} · {blockchain}   {status}
```

- Title: white/bold
- Provider name: cyan
- Blockchain name: cyan
- Dot separator: dim
- Status: `testing rate limits` (dim) → `complete` (green)

---

## Provider Info Section

```
  Provider: {name}
  Blockchain: {blockchain}
  Current rate limit: {rateLimit}
  Requests per test: {numRequests}
```

| Element              | Color |
| -------------------- | ----- |
| Labels (`Provider:`) | dim   |
| Provider name        | cyan  |
| Blockchain name      | cyan  |
| Rate limit value     | white |
| Request count        | white |

When custom rates specified:

```
  Custom rates: 0.5, 1, 2, 5 req/sec
```

---

## Sustained Rate Tests

Each rate test is one line, updated in place as tests complete:

```
  Sustained Rate Tests
    {icon}  {rate} req/sec   {result}
```

| State   | Icon | Result       | Color |
| ------- | ---- | ------------ | ----- |
| Pending | `·`  | (empty)      | dim   |
| Testing | `⠋`  | `testing...` | dim   |
| Passed  | `✓`  | `avg {n}ms`  | green |
| Failed  | `✗`  | `avg {n}ms`  | red   |

### Elements

| Element                | Color |
| ---------------------- | ----- |
| `Sustained Rate Tests` | dim   |
| Rate value             | white |
| `req/sec`              | dim   |
| Avg response (pass)    | green |
| Avg response (fail)    | red   |

---

## Burst Limit Tests

Shown after sustained tests complete, unless `--skip-burst` is used.

```
  Burst Limit Tests
    {icon}  {limit} req/min
```

| State  | Icon | Color |
| ------ | ---- | ----- |
| Passed | `✓`  | green |
| Failed | `✗`  | red   |

---

## Results Summary

Shown after all tests complete.

```
  Maximum safe sustained rate: {rate} req/sec

  Recommended configuration (80% safety margin):
    requestsPerSecond: {n}
    burstLimit: {n}

  Config override for blockchain-explorers.json:
    {json}
```

| Element                        | Color      |
| ------------------------------ | ---------- |
| `Maximum safe sustained rate:` | dim        |
| Max rate value                 | white/bold |
| `req/sec`                      | dim        |
| `Recommended configuration`    | white/bold |
| `(80% safety margin)`          | dim        |
| Config key names               | white      |
| Config values                  | green      |
| `Config override for`          | dim        |
| `blockchain-explorers.json`    | dim        |
| JSON override                  | dim        |

---

## Error Handling

### Provider Not Found

```
Benchmark  ✗ Provider 'badname' not found for blockchain 'ethereum'

  Available providers: alchemy, etherscan, quicknode
```

### Benchmark Failure

If tests fail mid-run, show partial results up to the failure point:

```
  Sustained Rate Tests
    ✓  0.5 req/sec   avg 132ms
    ✓  1.0 req/sec   avg 128ms
    ✗  Error: Connection refused

  Benchmark incomplete. Partial results shown above.
```

---

## JSON Mode (`--json`)

Bypasses the TUI. Returns structured benchmark data.

```json
{
  "data": {
    "blockchain": "ethereum",
    "provider": "alchemy",
    "currentRateLimit": { "requestsPerSecond": 5, "burstLimit": 30 },
    "maxSafeRate": 5,
    "recommended": {
      "requestsPerSecond": 4,
      "burstLimit": 60
    },
    "testResults": [
      { "rate": 0.5, "success": true, "responseTimeMs": 132 },
      { "rate": 1.0, "success": true, "responseTimeMs": 128 },
      { "rate": 2.0, "success": true, "responseTimeMs": 145 },
      { "rate": 5.0, "success": true, "responseTimeMs": 161 }
    ],
    "burstLimits": [
      { "limit": 30, "success": true },
      { "limit": 60, "success": true },
      { "limit": 120, "success": false }
    ],
    "configOverride": {
      "ethereum": {
        "overrides": {
          "alchemy": {
            "rateLimit": {
              "requestsPerSecond": 4,
              "burstLimit": 60
            }
          }
        }
      }
    }
  }
}
```

---

## Color Specification

### Three-Tier Hierarchy

**Signal tier (icons):**

| Icon | Color | Meaning     |
| ---- | ----- | ----------- |
| `✓`  | green | Test passed |
| `✗`  | red   | Test failed |
| `·`  | dim   | Pending     |
| `⠋`  | dim   | In progress |

**Content tier:**

| Element                   | Color      |
| ------------------------- | ---------- |
| Provider name             | cyan       |
| Blockchain name           | cyan       |
| Rate values               | white      |
| Max safe rate             | white/bold |
| Avg response (pass)       | green      |
| Avg response (fail)       | red        |
| Recommended config values | green      |
| `complete` status         | green      |

**Context tier:**

| Element                              | Color |
| ------------------------------------ | ----- |
| Labels (`Provider:`, `Config:`)      | dim   |
| `req/sec` / `req/min`                | dim   |
| `(80% safety margin)`                | dim   |
| Section labels                       | dim   |
| JSON config override                 | dim   |
| `testing...` / `testing rate limits` | dim   |

---

## Command Options

```
exitbook providers benchmark [options]

Options:
  --blockchain <name>     Blockchain name (required)
  --provider <name>       Provider to test (required)
  --max-rate <number>     Maximum rate to test in req/sec (default: 5)
  --rates <rates>         Custom rates to test (comma-separated, e.g. "0.5,1,2,5")
  --num-requests <number> Requests per rate test (default: 10)
  --skip-burst            Skip burst limit testing
  --json                  Output JSON, bypass TUI
  -h, --help              Display help
```

---

## Implementation Notes

### Data Flow

1. Parse and validate CLI options at the boundary
2. Create `BlockchainProviderManager`, auto-register target provider
3. Validate provider exists, gather metadata (current rate limit)
4. Render Ink TUI with initial state (provider info, empty test results)
5. Run sustained rate tests sequentially, updating TUI after each
6. Run burst limit tests (unless `--skip-burst`), updating TUI after each
7. Compute recommendations (80% of max safe rate)
8. Build config override JSON
9. Display final results
10. Cleanup provider manager, exit

### Reuse from benchmark-rate-limit

The existing `BenchmarkRateLimitHandler` and `benchmark-rate-limit-utils.ts` (pure functions: `buildBenchmarkParams`, `parseMaxRate`, `parseNumRequests`, `parseCustomRates`, `buildConfigOverride`) are reused directly. The only change is the display layer — Ink TUI replaces `console.log` text output.

### Migration from benchmark-rate-limit

- `benchmark-rate-limit` top-level command removed
- All functionality moves to `providers benchmark`
- CLI options preserved (same flags, same defaults)
- JSON output structure preserved for backward compatibility
- Handler and utils reused, only command registration and display layer change

### Non-Interactive Design

Unlike `providers view`, the benchmark command is non-interactive. It runs to completion and exits — no navigation, no cursor, no quit key. The TUI is purely for live progress display. This matches the nature of the task: you kick it off and wait for results.

If the user interrupts (`Ctrl-C`), clean up the provider manager and exit gracefully.
