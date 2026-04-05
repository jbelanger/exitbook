# Providers Benchmark — Text-Progress Workflow Spec

## Overview

`exitbook providers benchmark` tests live API rate limits for one blockchain provider by sending real requests at increasing sustained and burst rates.

It is a workflow command, not a browse surface.

Rules:

- the command runs to completion and exits
- `--json` returns structured results and bypasses human-readable workflow output
- human-readable mode uses line-oriented `text-progress`
- TTY-only active-state indicators such as spinners may be shown for the current test, but they must not replace durable progress lines and final output

---

## Human-Readable Shape

The human-readable workflow has three durable sections:

1. header and provider info
2. live progress grouped into sustained and burst test sections
3. final summary with recommendation and config override

The final report should stay close to the current command output rather than being reduced to a terse footer.

### Example

```text
Benchmark alchemy · ethereum · running

Provider Info
  Current rate limit: {"burstLimit":10,"requestsPerHour":3600,"requestsPerMinute":300,"requestsPerSecond":5}
  Requests per test: 10
  Burst testing: enabled

Sustained Rate Tests
  ⠋ 0.25 req/sec
  ✓ 0.25 req/sec   avg 76ms
  · waiting 60s before next rate test
    30s remaining
  ✓ 0.5 req/sec    avg 62ms
  ✓ 1 req/sec      avg 54ms
  ✓ 2.5 req/sec    avg 66ms
  ✓ 5 req/sec      avg 58ms

Burst Limit Tests
  ✓ 10 req/min
  ✓ 15 req/min
  ✓ 20 req/min
  ✓ 30 req/min
  ✓ 60 req/min

✓ Benchmark complete

Max safe rate: 5 req/sec

Recommended configuration (80% safety margin):
  {
    "burstLimit": 8,
    "requestsPerHour": 12960,
    "requestsPerMinute": 48,
    "requestsPerSecond": 4
  }

To update the configuration, edit:
  apps/cli/config/blockchain-explorers.json

Example override for alchemy:
  {
    "ethereum": {
      "overrides": {
        "alchemy": {
          "rateLimit": {
            "burstLimit": 8,
            "requestsPerHour": 12960,
            "requestsPerMinute": 48,
            "requestsPerSecond": 4
          }
        }
      }
    }
  }
```

---

## Header And Provider Info

Initial output:

```text
Benchmark {provider} · {blockchain} · running

Provider Info
  Current rate limit: {json}
  Requests per test: {numRequests}
  Burst testing: enabled|disabled
```

Rules:

- provider name is cyan
- separators are dim
- `running` is yellow
- labels in the provider info section are dim
- current rate limit is rendered as inline JSON when available

If custom rates are supplied, they do not need a separate line as long as the tested rates are visible in the progress output.

---

## Sustained Rate Tests

Progress is grouped under:

```text
Sustained Rate Tests
```

Each sustained test produces a durable completion line:

```text
  ✓ 0.5 req/sec    avg 62ms
  ✗ 2.5 req/sec    avg 924ms
```

Rules:

- the current test may show a TTY spinner before it resolves to `✓` or `✗`
- when not using a spinner, the active test should still emit a durable start line such as `· 0.5 req/sec`
- completed rows remain visible in scrollback
- average response time is shown when available

Long waits between sustained tests are explicit:

```text
  · waiting 60s before next rate test
    45s remaining
    30s remaining
    15s remaining
```

Rules:

- waits must never be silent
- heartbeat cadence should be periodic and human-scaled
- a TTY spinner may supplement the active wait, but the wait still needs durable progress lines when it is long-running

---

## Burst Limit Tests

Shown only when burst testing is enabled:

```text
Burst Limit Tests
  ✓ 10 req/min
  ✗ 20 req/min
```

Rules:

- the section header appears only when burst tests actually run
- the current burst test may use a TTY spinner before it resolves
- completed burst rows remain visible in scrollback

---

## Final Summary

Final output:

```text
✓ Benchmark complete

Max safe rate: {rate} req/sec

Recommended configuration (80% safety margin):
  {json}

To update the configuration, edit:
  apps/cli/config/blockchain-explorers.json

Example override for {provider}:
  {json}
```

Rules:

- final summary remains rich; do not collapse it into a terse footer
- the recommendation is printed as pretty JSON
- the example override is printed as pretty JSON
- the override uses the same structure as `blockchain-explorers.json`

---

## Error Handling

### Validation Or Setup Errors

Invalid provider/blockchain/options fail through the normal CLI error boundary.

### Mid-Run Benchmark Errors

If the benchmark fails during execution:

- already-completed progress lines remain visible
- the active spinner, if any, is cleared
- the command fails with a non-zero exit
- text mode may still print a final error line, but it must not erase or replace the durable progress already emitted

---

## JSON Mode

`--json` preserves the structured benchmark payload and bypasses text-progress output.

The JSON payload includes:

- `blockchain`
- `provider`
- `currentRateLimit`
- `maxSafeRate`
- `recommended`
- `testResults`
- `burstLimits`
- `configOverride`

---

## Command Options

```text
exitbook providers benchmark [options]

Options:
  --blockchain <name>     Blockchain name (required)
  --provider <name>       Provider to test (required)
  --max-rate <number>     Maximum rate to test in req/sec (default: 5)
  --rates <rates>         Custom rates to test (comma-separated, e.g. "0.5,1,2,5")
  --num-requests <number> Requests per rate test (default: 10)
  --skip-burst            Skip burst limit testing
  --json                  Output JSON
  -h, --help              Display help
```

---

## Implementation Notes

### Data Flow

1. parse and validate CLI options
2. open a provider benchmark session and load provider metadata
3. print the workflow header and provider info
4. run sustained tests while emitting durable progress events
5. emit explicit wait progress between sustained tests when the rate window is cooling down
6. run burst tests when enabled
7. compute the recommendation and config override
8. print the final summary
9. clean up provider resources and exit

### Display Layer

The benchmark display layer is text-progress, not an Ink app.

Implementation rules:

- one command-local text-progress reporter owns human-readable benchmark output
- benchmark progress events drive both TTY and non-TTY output
- TTY mode may add spinners for the active test, but the reporter still owns durable line output

### Migration Notes

- the old benchmark Ink view is removed
- `providers benchmark` remains the only user-facing benchmark entrypoint
- JSON output stays compatible
