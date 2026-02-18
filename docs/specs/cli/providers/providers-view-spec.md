# Providers View — Interactive TUI Spec

## Overview

`exitbook providers view` is a provider-centric TUI for inspecting blockchain API providers — their configuration, health, and runtime stats.

Where `blockchains view` answers "what providers does Bitcoin have?", this command answers "how is Alchemy performing across all my chains?" It surfaces persisted health metrics from `providers.db` alongside static registry metadata.

Single-mode design: a scrollable list of providers with a detail panel showing per-blockchain breakdown, health metrics, and configuration. Filters narrow the dataset via CLI flags.

`--json` bypasses the TUI.

---

## Two-Panel Layout

List (top) and detail panel (bottom), separated by a full-width dim `─` divider. Same shared behavior as all other TUI views.

### Scrolling

When the list exceeds the visible height:

- Visible window scrolls to keep the selected row in view
- `▲` / `▼` dim indicators appear when more items exist above/below
- No explicit scroll bar

### Navigation

| Key               | Action           | When   |
| ----------------- | ---------------- | ------ |
| `↑` / `k`         | Move cursor up   | Always |
| `↓` / `j`         | Move cursor down | Always |
| `PgUp` / `Ctrl-U` | Page up          | Always |
| `PgDn` / `Ctrl-D` | Page down        | Always |
| `Home`            | Jump to first    | Always |
| `End`             | Jump to last     | Always |
| `q` / `Esc`       | Quit             | Always |

### Controls Bar

Bottom line, dim. Read-only — no action keys.

### Loading State

```
⠋ Loading providers...
```

Brief spinner while loading registry metadata and stats DB, then TUI appears.

---

## Visual Example

```
Providers  18 total · 8 healthy · 1 degraded · 1 unhealthy · 8 no stats   4 require API key

  ✓  alchemy         5 chains   148ms    0.2%   1,247 req   ALCHEMY_API_KEY ✓
  ✓  helius          1 chain     92ms    0.0%     834 req   HELIUS_API_KEY ✓
  ✓  blockstream     1 chain    210ms    0.5%     412 req
  ✓  mempool         1 chain    185ms    0.3%     398 req
▸ ⚠  quicknode       3 chains   340ms    4.8%     256 req   QUICKNODE_API_KEY ✗
  ✓  etherscan       1 chain    125ms    0.1%     189 req
  ✓  subscan         3 chains   165ms    0.8%     156 req   SUBSCAN_API_KEY ✓
  ✗  blockdaemon     2 chains   890ms   12.1%      45 req   BLOCKDAEMON_API_KEY ✓
  ·  polygonscan     1 chain       —       —     0 req
  ·  arbiscan        1 chain       —       —     0 req

────────────────────────────────────────────────────────────────────────────────
▸ quicknode  3 chains · 256 total requests · ⚠ degraded

  Blockchains
    ethereum     txs · balance · tokens   3/sec     142 req   1.2%   145ms
    polygon      txs · balance            3/sec      78 req   8.4%   520ms   ⚠ high error rate
    arbitrum     txs · balance            3/sec      36 req   2.1%   355ms

  Config: 3/sec (default)
  API key: QUICKNODE_API_KEY ✗ missing

  Last error: 429 Too Many Requests (2 min ago)

↑↓/j/k · ^U/^D page · Home/End · q/esc quit
```

---

## Header

```
Providers  {total} total · {healthy} healthy · {degraded} degraded · {unhealthy} unhealthy · {noStats} no stats   {apiKeyCount} require API key
```

- Title: white/bold
- Total count: white
- `healthy` count: green
- `degraded` count: yellow (when > 0, omit when 0)
- `unhealthy` count: red (when > 0, omit when 0)
- `no stats` count: dim (when > 0, omit when 0)
- API key count: white
- Category labels: dim
- Dot separators: dim
- `require API key` label: dim
- Only show status categories with count > 0

When filtered:

```
Providers (ethereum)  5 total · 4 healthy · 1 degraded   2 require API key
```

```
Providers (missing API key)  1 total
```

---

## List Columns

```
{cursor} {icon}  {name}  {chains}  {avgResponse}  {errorRate}  {totalReqs}  {apiKeyInfo}
```

| Column       | Width | Alignment | Content                                         |
| ------------ | ----- | --------- | ----------------------------------------------- |
| Cursor       | 1     | —         | `▸` for selected, space otherwise               |
| Icon         | 1     | —         | Health status icon                              |
| Name         | 16    | left      | Provider name                                   |
| Chains       | 10    | left      | `{n} chain(s)`                                  |
| Avg Response | 7     | right     | `{n}ms` or `—`                                  |
| Error Rate   | 7     | right     | `{n}%` or `—`                                   |
| Total Reqs   | 12    | right     | `{n} req` or `0 req`                            |
| API Key Info | 22    | left      | env var + status (only for providers requiring) |

### Health Status Icons

| Condition                    | Icon | Color  |
| ---------------------------- | ---- | ------ |
| Healthy (error rate < 2%)    | `✓`  | green  |
| Degraded (error rate 2–10%)  | `⚠`  | yellow |
| Unhealthy (error rate ≥ 10%) | `✗`  | red    |
| No stats (never used)        | `·`  | dim    |

### Row Colors

| Row State         | Color                     |
| ----------------- | ------------------------- |
| Selected (cursor) | white/bold for entire row |
| No stats          | dim for entire row        |
| Normal            | standard color scheme     |

### Standard Row Color Scheme

| Element                      | Color                                              |
| ---------------------------- | -------------------------------------------------- |
| Provider name                | white                                              |
| Chain count                  | white                                              |
| `chain(s)`                   | dim                                                |
| Avg response                 | green (< 200ms), yellow (200–500ms), red (> 500ms) |
| Error rate                   | green (< 2%), yellow (2–10%), red (> 10%)          |
| Total reqs                   | white                                              |
| `req`                        | dim                                                |
| API key env var (configured) | green                                              |
| `✓` (configured)             | green                                              |
| API key env var (missing)    | yellow                                             |
| `✗` (missing)                | red                                                |
| `—` (no stats)               | dim                                                |

---

## Detail Panel

The detail panel shows full per-blockchain breakdown and health metrics for the selected provider.

### Standard Detail

```
▸ {name}  {chainCount} chains · {totalReqs} total requests · {healthLabel}

  Blockchains
    {blockchain}   {capabilities}   {rateLimit}   {reqCount}   {errorRate}   {avgResponse}   {alert}
    {blockchain}   {capabilities}   {rateLimit}   {reqCount}   {errorRate}   {avgResponse}   {alert}
    ...

  Config: {rateLimit} ({configSource})
  API key: {envVar} {status}

  Last error: {message} ({timeAgo})
```

### Detail Panel Elements

| Element                     | Color                                 |
| --------------------------- | ------------------------------------- |
| Provider name               | white/bold                            |
| Chain count                 | white                                 |
| `chains` label              | dim                                   |
| Total request count         | white                                 |
| `total requests` label      | dim                                   |
| Health label (healthy)      | green                                 |
| Health label (degraded)     | yellow                                |
| Health label (unhealthy)    | red                                   |
| `Blockchains` section label | dim                                   |
| Blockchain names            | cyan                                  |
| Capabilities list           | white                                 |
| Rate limit                  | dim                                   |
| Per-chain request count     | white                                 |
| Per-chain error rate        | colored (green/yellow/red thresholds) |
| Per-chain avg response      | colored (green/yellow/red thresholds) |
| Alert text                  | yellow or red                         |
| `Config:` label             | dim                                   |
| Config rate limit value     | white                                 |
| Config source               | dim                                   |
| `API key:` label            | dim                                   |
| Configured env var          | green                                 |
| Missing env var             | yellow                                |
| `✓` (configured)            | green                                 |
| `✗` (missing)               | red                                   |
| `missing` label             | yellow                                |
| `Last error:` label         | dim                                   |
| Error message               | yellow                                |
| Time ago                    | dim                                   |
| Dot separator `·`           | dim                                   |

### Blockchain Line Format

Each blockchain served by the provider is one line:

```
  {name}   {cap1} · {cap2} · {cap3}   {rate}/sec   {reqCount} req   {errorRate}   {avgResponse}   {alert}
```

- Capabilities: shortened operations joined by `·` (e.g., `txs · balance · tokens`)
- Rate limit: `{n}/sec` in dim
- Request count: from persisted stats (per blockchain), or `—` if no stats
- Error rate and avg response: per-blockchain from stats, colored by threshold
- Alert: only shown for anomalies (e.g., `⚠ high error rate`, `⚠ slow`)

### Config Source

| Source               | Display      |
| -------------------- | ------------ |
| Registry default     | `(default)`  |
| Config file override | `(override)` |

### Health Labels

| Condition                          | Label         | Color  |
| ---------------------------------- | ------------- | ------ |
| Healthy (all chains < 2% errors)   | `✓ healthy`   | green  |
| Degraded (any chain 2–10% errors)  | `⚠ degraded`  | yellow |
| Unhealthy (any chain ≥ 10% errors) | `✗ unhealthy` | red    |
| No stats                           | `no stats`    | dim    |

### Provider Without API Key

Omit the `API key:` line entirely for providers that don't require one.

### Provider Without Stats

When no stats exist (provider never used):

```
▸ {name}  {chainCount} chains · no stats

  Blockchains
    {blockchain}   {capabilities}   {rateLimit}
    ...

  Config: {rateLimit} ({configSource})

  No usage data. Run an import to generate stats:
  exitbook import --blockchain {blockchain} --address {placeholder}
```

### Last Error

Only shown when the provider has a recorded error. Time-ago format: `just now`, `1 min ago`, `5 min ago`, `1 hr ago`, `3 hrs ago`, `1 day ago`, etc.

When no error recorded, omit the line entirely.

---

## Sorting

Default: by total requests descending (most-used first). Providers with no stats sort to the bottom, then alphabetically.

---

## Filters

### Blockchain Filter (`--blockchain`)

```bash
exitbook providers view --blockchain ethereum     # Providers serving Ethereum
exitbook providers view --blockchain bitcoin       # Providers serving Bitcoin
```

Shows only providers that serve the specified blockchain. Per-blockchain detail still shows all chains for the filtered providers.

### Health Filter (`--health`)

```bash
exitbook providers view --health degraded          # Degraded or unhealthy only
exitbook providers view --health unhealthy         # Unhealthy only
```

### API Key Filter (`--missing-api-key`)

```bash
exitbook providers view --missing-api-key          # Providers with missing API keys
```

---

## Empty States

### No Providers

```
Providers  0 total

  No providers registered.

  This likely means provider registration failed.
  Run: pnpm blockchain-providers:validate

q quit
```

### No Providers Matching Filter

```
Providers (ethereum)  0 total

  No providers found for ethereum.

q quit
```

### No Providers with Stats

When all providers exist but none have stats:

```
Providers  18 total · 18 no stats   4 require API key

  ·  alchemy         5 chains      —       —     0 req   ALCHEMY_API_KEY ✓
  ·  helius          1 chain       —       —     0 req   HELIUS_API_KEY ✓
  ...
```

Normal TUI — not a special empty state. Detail panel shows "No usage data" hint.

---

## JSON Mode (`--json`)

Bypasses the TUI. Returns structured provider data.

```json
{
  "data": {
    "providers": [
      {
        "name": "alchemy",
        "displayName": "Alchemy",
        "requiresApiKey": true,
        "apiKeyEnvVar": "ALCHEMY_API_KEY",
        "apiKeyConfigured": true,
        "blockchains": [
          {
            "name": "ethereum",
            "capabilities": ["txs", "balance", "tokens"],
            "rateLimit": "5/sec",
            "configSource": "default"
          },
          {
            "name": "polygon",
            "capabilities": ["txs", "balance", "tokens"],
            "rateLimit": "5/sec",
            "configSource": "default"
          }
        ],
        "chainCount": 5,
        "stats": {
          "totalRequests": 1247,
          "totalSuccesses": 1244,
          "totalFailures": 3,
          "avgResponseTime": 148,
          "errorRate": 0.2,
          "isHealthy": true,
          "lastChecked": "2024-11-28T16:20:45Z",
          "lastError": null,
          "perBlockchain": {
            "ethereum": {
              "totalSuccesses": 834,
              "totalFailures": 2,
              "avgResponseTime": 132,
              "errorRate": 0.2
            },
            "polygon": {
              "totalSuccesses": 410,
              "totalFailures": 1,
              "avgResponseTime": 178,
              "errorRate": 0.2
            }
          }
        }
      }
    ]
  },
  "meta": {
    "total": 18,
    "byHealth": { "healthy": 8, "degraded": 1, "unhealthy": 1, "noStats": 8 },
    "requireApiKey": 4,
    "filters": {}
  }
}
```

---

## Color Specification

### Three-Tier Hierarchy

Same conventions as all other TUI views.

**Signal tier (icons + cursor):**

| Icon | Color  | Meaning       |
| ---- | ------ | ------------- |
| `✓`  | green  | Healthy       |
| `⚠`  | yellow | Degraded      |
| `✗`  | red    | Unhealthy     |
| `·`  | dim    | No stats      |
| `▸`  | —      | Cursor (bold) |

**Content tier (what you read):**

| Element                     | Color  |
| --------------------------- | ------ |
| Provider names              | white  |
| Blockchain names            | cyan   |
| Chain counts                | white  |
| Request counts              | white  |
| Avg response (< 200ms)      | green  |
| Avg response (200–500ms)    | yellow |
| Avg response (> 500ms)      | red    |
| Error rate (< 2%)           | green  |
| Error rate (2–10%)          | yellow |
| Error rate (≥ 10%)          | red    |
| Capabilities                | white  |
| Configured API key env vars | green  |
| Missing API key env vars    | yellow |

**Context tier (recedes):**

| Element                                  | Color |
| ---------------------------------------- | ----- |
| `chain(s)` / `req` / `total requests`    | dim   |
| Divider `─`                              | dim   |
| Dot separator `·`                        | dim   |
| Rate limits                              | dim   |
| `Blockchains` section label              | dim   |
| `Config:` / `API key:` labels            | dim   |
| Config source `(default)` / `(override)` | dim   |
| `Last error:` label                      | dim   |
| Time ago                                 | dim   |
| `no stats` label                         | dim   |
| Controls bar                             | dim   |
| Scroll indicators                        | dim   |
| CLI hints                                | dim   |

---

## State Model

```typescript
interface ProvidersViewState {
  // Data
  providers: ProviderViewItem[];
  healthCounts: {
    healthy: number;
    degraded: number;
    unhealthy: number;
    noStats: number;
  };
  totalCount: number;
  apiKeyRequiredCount: number;

  // Navigation
  selectedIndex: number;
  scrollOffset: number;

  // Filters (applied from CLI args, read-only in TUI)
  blockchainFilter?: string | undefined;
  healthFilter?: string | undefined;
  missingApiKeyFilter?: boolean | undefined;
}

/** Per-provider display item */
interface ProviderViewItem {
  name: string;
  displayName: string;
  requiresApiKey: boolean;
  apiKeyEnvVar?: string | undefined;
  apiKeyConfigured?: boolean | undefined;

  blockchains: ProviderBlockchainItem[];
  chainCount: number;

  // Aggregate health (worst-of across all chains)
  healthStatus: 'healthy' | 'degraded' | 'unhealthy' | 'no-stats';

  // Aggregate stats (across all chains)
  stats?: ProviderAggregateStats | undefined;

  // Config
  rateLimit?: string | undefined;
  configSource: 'default' | 'override';

  // Last error
  lastError?: string | undefined;
  lastErrorTime?: number | undefined;
}

/** Per-blockchain breakdown within a provider */
interface ProviderBlockchainItem {
  name: string;
  capabilities: string[];
  rateLimit?: string | undefined;

  // Per-chain stats (from provider_stats table)
  stats?:
    | {
        totalSuccesses: number;
        totalFailures: number;
        avgResponseTime: number;
        errorRate: number;
        isHealthy: boolean;
      }
    | undefined;
}

/** Aggregate stats across all blockchains */
interface ProviderAggregateStats {
  totalRequests: number;
  avgResponseTime: number;
  errorRate: number;
  lastChecked: number;
}
```

### Actions

```typescript
type ProvidersViewAction =
  // Navigation
  | { type: 'NAVIGATE_UP'; visibleRows: number }
  | { type: 'NAVIGATE_DOWN'; visibleRows: number }
  | { type: 'PAGE_UP'; visibleRows: number }
  | { type: 'PAGE_DOWN'; visibleRows: number }
  | { type: 'HOME' }
  | { type: 'END'; visibleRows: number };
```

Read-only view — no mutation actions.

---

## Component Structure

```
ProvidersViewApp
├── Header (total + health counts + API key count)
├── ProviderList
│   └── ProviderRow
├── Divider
├── ProviderDetailPanel
│   ├── BlockchainBreakdown
│   ├── ConfigSection
│   ├── ApiKeySection
│   └── LastErrorSection
└── ControlsBar
```

---

## Command Options

```
exitbook providers view [options]

Options:
  --blockchain <name>    Filter by blockchain (providers serving this chain)
  --health <status>      Filter by health (healthy, degraded, unhealthy)
  --missing-api-key      Show only providers with missing API keys
  --json                 Output JSON, bypass TUI
  -h, --help             Display help
```

---

## Implementation Notes

### Data Flow

1. Parse and validate CLI options at the boundary
2. Get all providers from `ProviderRegistry.getAllProviders()`
3. Get provider metadata (API key env vars, supported chains) from `ProviderRegistry.getMetadata()`
4. Load config overrides from `loadExplorerConfig()`
5. Open `providers.db`, load persisted stats from `createProviderStatsQueries(db).getAll()`
6. Group providers by name (deduplicate multi-chain providers into single rows)
7. Merge registry metadata + config overrides + persisted stats into `ProviderViewItem[]`
8. Check API key status via env vars
9. Compute aggregate health per provider (worst-of across chains)
10. Apply filters, sort by total requests descending
11. Render Ink TUI with dataset in memory
12. Close stats DB on exit

### Provider Grouping

Multi-chain providers (e.g., Alchemy serving ethereum, polygon, arbitrum) appear as a single row in the list. The `ProviderRegistry` stores separate entries per `{blockchain}:{provider}` key. Group by provider name, collecting all blockchain entries.

### Stats Aggregation

Per-provider aggregate stats are computed from per-blockchain rows in `provider_stats`:

- `totalRequests` = sum of `total_successes + total_failures` across all blockchain rows
- `avgResponseTime` = weighted average by request count
- `errorRate` = `totalFailures / totalRequests * 100`
- `healthStatus` = worst-of across all chains (any chain unhealthy → provider unhealthy)

### Graceful Degradation

If `providers.db` doesn't exist or fails to open, all providers show "no stats". The TUI still renders with registry metadata and config — just without runtime health data. Log a warning but don't error.

### Config Source Detection

For each provider, check if `loadExplorerConfig()` returns an override for that provider's rate limit. If yes, display `(override)`; otherwise `(default)`.

### Terminal Size

- List panel: fills available height minus fixed chrome (header ~3, divider 1, detail panel ~10, controls ~2, scroll indicators ~2 = ~18 lines)
- Detail panel height varies by chain count (~5 lines base + 1 per blockchain)
- Minimum terminal width: 80 columns

### Accessibility

- Vim keys (`j`/`k`) alongside arrows
- No color-only information — icons and text labels always accompany colors
- Health status always shown as text + icon, not just color-coded
- Response times and error rates use both color and numeric values
