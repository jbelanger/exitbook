# Blockchains View — Interactive TUI Spec

## Overview

`exitbook blockchains view` replaces the legacy `list-blockchains` command. It is a read-only TUI for browsing supported blockchains and inspecting their provider configuration, API key health, and capabilities.

Single-mode design: a scrollable list of blockchains with a detail panel showing the selected blockchain's full provider breakdown (capabilities, rate limits, API key status, health stats). Filters narrow the dataset via CLI flags.

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
⠋ Loading blockchains...
```

Brief spinner, then TUI appears.

---

## Visual Example

```
Blockchains  13 total · 7 evm · 3 substrate · 1 utxo · 1 solana · 1 cosmos   18 providers

  ✓  Bitcoin       utxo        L1   2 providers   ✓ all keys configured
  ✓  Ethereum      evm         L1   3 providers   ✓ all keys configured
  ✓  Solana        solana           2 providers   ✓ all keys configured
▸ ⚠  Polygon       evm         L2   3 providers   ⚠ 1 key missing
  ✓  Arbitrum One  evm         L2   2 providers   ✓ all keys configured
  ✓  Optimism      evm         L2   2 providers   ✓ all keys configured
  ✓  Base          evm         L2   2 providers   ✓ all keys configured
  ⊘  Avalanche C   evm         L1   1 provider    ⊘ no key needed
  ⊘  BSC           evm         L1   1 provider    ⊘ no key needed
  ✓  Polkadot      substrate   L0   1 provider    ✓ all keys configured
  ✓  Kusama        substrate   L1   1 provider    ✓ all keys configured
  ✓  Bittensor     substrate   L1   1 provider    ✓ all keys configured
  ✓  Injective     cosmos      L1   1 provider    ✓ all keys configured

────────────────────────────────────────────────────────────────────────────────
▸ Polygon  evm · Layer 2   3 providers

  Providers
    ✓  alchemy        txs · balance · tokens   5/sec   ALCHEMY_API_KEY ✓
    ⚠  quicknode      txs · balance            3/sec   QUICKNODE_API_KEY ✗
    ⊘  polygonscan    txs · balance             5/sec

  Example: exitbook import --blockchain polygon --address 0x742d35Cc...

↑↓/j/k · ^U/^D page · Home/End · q/esc quit
```

---

## Header

```
Blockchains  {total} total · {evm} evm · {substrate} substrate · {utxo} utxo · {solana} solana · {cosmos} cosmos   {providerCount} providers
```

- Title: white/bold
- Total count: white
- Category counts: white
- Category labels: dim
- Provider count: white
- `providers` label: dim
- Dot separators: dim
- Only show categories with count > 0

When filtered:

```
Blockchains (evm)  7 total   12 providers
```

```
Blockchains (requires API key)  10 total   15 providers
```

---

## List Columns

```
{cursor} {icon}  {displayName}  {category}  {layer}  {providers}  {keyStatus}
```

| Column       | Width | Alignment | Content                                        |
| ------------ | ----- | --------- | ---------------------------------------------- |
| Cursor       | 1     | —         | `▸` for selected, space otherwise              |
| Icon         | 1     | —         | API key health icon                            |
| Display Name | 14    | left      | Human-readable blockchain name                 |
| Category     | 10    | left      | `evm`, `utxo`, `substrate`, `solana`, `cosmos` |
| Layer        | 4     | left      | `L0`, `L1`, `L2`, or blank                     |
| Providers    | 14    | right     | `{n} provider(s)`                              |
| Key Status   | 22    | left      | API key health summary                         |

### API Key Health Icons

| Condition                     | Icon | Color  |
| ----------------------------- | ---- | ------ |
| All required keys configured  | `✓`  | green  |
| Some required keys missing    | `⚠`  | yellow |
| No providers require API keys | `⊘`  | dim    |

### API Key Status Text

| Condition                    | Text                    | Color  |
| ---------------------------- | ----------------------- | ------ |
| All required keys configured | `✓ all keys configured` | green  |
| Some keys missing            | `⚠ {n} key(s) missing`  | yellow |
| No keys required             | `⊘ no key needed`       | dim    |

### Row Colors

| Row State         | Color                     |
| ----------------- | ------------------------- |
| Selected (cursor) | white/bold for entire row |
| Normal            | standard color scheme     |

### Standard Row Color Scheme

| Element        | Color |
| -------------- | ----- |
| Display name   | white |
| Category       | dim   |
| Layer          | dim   |
| Provider count | white |
| `provider(s)`  | dim   |

---

## Detail Panel

The detail panel shows full provider information for the selected blockchain.

### Standard Detail

```
▸ {displayName}  {category} · Layer {layer}   {providerCount} providers

  Providers
    {icon}  {providerName}   {capabilities}   {rateLimit}   {apiKeyInfo}
    {icon}  {providerName}   {capabilities}   {rateLimit}   {apiKeyInfo}
    ...

  Example: exitbook import --blockchain {name} --address {exampleAddress}
```

### Detail Panel Elements

| Element                      | Color      |
| ---------------------------- | ---------- |
| Display name                 | white/bold |
| Category                     | dim        |
| `Layer {n}`                  | dim        |
| Provider count               | white      |
| `providers` label            | dim        |
| `Providers` section label    | dim        |
| Provider name                | cyan       |
| Capabilities list            | white      |
| Rate limit                   | dim        |
| API key env var (configured) | green      |
| `✓` (configured)             | green      |
| API key env var (missing)    | yellow     |
| `✗` (missing)                | red        |
| Provider without API key     | dim (`⊘`)  |
| `Example:` label             | dim        |
| CLI command                  | dim        |

### Provider Line Format

Each provider is one line:

```
  {icon}  {name}   {cap1} · {cap2} · {cap3}   {rate}/sec   {envVar} {status}
```

- Icon: `✓` green (key configured), `⚠` yellow (key missing), `⊘` dim (no key needed)
- Capabilities: shortened operations joined by `·` (e.g., `txs · balance · tokens`)
- Rate limit: `{n}/sec` in dim
- API key: env var name + `✓`/`✗` status, or omitted if no key needed

### Provider Icons

| Condition       | Icon | Color  |
| --------------- | ---- | ------ |
| Key configured  | `✓`  | green  |
| Key missing     | `⚠`  | yellow |
| No key required | `⊘`  | dim    |

### No Providers

When a blockchain has zero registered providers:

```
▸ {displayName}  {category} · Layer {layer}   0 providers

  No providers registered for this blockchain.

  Example: exitbook import --blockchain {name} --address {exampleAddress}
```

---

## Sorting

Default: popularity order (bitcoin, ethereum, solana, then EVM L2s, then substrate/cosmos, then alphabetical for unlisted).

Same order as the existing `sortBlockchains()` utility.

---

## Filters

### Category Filter (`--category`)

```bash
exitbook blockchains view --category evm         # Only EVM blockchains
exitbook blockchains view --category substrate    # Only Substrate blockchains
exitbook blockchains view --category utxo         # Only UTXO blockchains
```

### API Key Filter (`--requires-api-key`)

```bash
exitbook blockchains view --requires-api-key      # Only blockchains that require API keys
```

---

## Empty States

### No Blockchains

```
Blockchains  0 total

  No blockchains registered.

  This likely means provider registration failed.
  Run: pnpm blockchain-providers:validate

q quit
```

### No Blockchains Matching Filter

```
Blockchains (cosmos)  0 total

  No blockchains found for category cosmos.

q quit
```

---

## JSON Mode (`--json`)

Bypasses the TUI. Returns structured blockchain data.

```json
{
  "data": {
    "blockchains": [
      {
        "name": "bitcoin",
        "displayName": "Bitcoin",
        "category": "utxo",
        "layer": "1",
        "providers": [
          {
            "name": "mempool",
            "displayName": "Mempool",
            "requiresApiKey": false,
            "capabilities": ["txs", "balance"],
            "rateLimit": "5/sec"
          },
          {
            "name": "blockstream",
            "displayName": "Blockstream",
            "requiresApiKey": false,
            "capabilities": ["txs", "balance"],
            "rateLimit": "3/sec"
          }
        ],
        "providerCount": 2,
        "exampleAddress": "bc1q..."
      }
    ]
  },
  "meta": {
    "total": 13,
    "byCategory": { "evm": 7, "substrate": 3, "utxo": 1, "solana": 1, "cosmos": 1 },
    "totalProviders": 18,
    "filters": {}
  }
}
```

---

## Color Specification

### Three-Tier Hierarchy

Same conventions as all other TUI views.

**Signal tier (icons + cursor):**

| Icon | Color  | Meaning             |
| ---- | ------ | ------------------- |
| `✓`  | green  | Key configured / OK |
| `⚠`  | yellow | Key missing         |
| `⊘`  | dim    | No key needed       |
| `▸`  | —      | Cursor (bold)       |

**Content tier (what you read):**

| Element             | Color  |
| ------------------- | ------ |
| Blockchain names    | white  |
| Provider names      | cyan   |
| Provider counts     | white  |
| Capabilities        | white  |
| Configured env vars | green  |
| Missing env vars    | yellow |

**Context tier (recedes):**

| Element                         | Color |
| ------------------------------- | ----- |
| Category labels                 | dim   |
| Layer labels                    | dim   |
| Divider `─`                     | dim   |
| Dot separator `·`               | dim   |
| Rate limits                     | dim   |
| `provider(s)` label             | dim   |
| `Providers` section label       | dim   |
| `Example:` label                | dim   |
| CLI command                     | dim   |
| `⊘` icon and no-key-needed text | dim   |
| Controls bar                    | dim   |
| Scroll indicators               | dim   |

---

## State Model

```typescript
interface BlockchainsViewState {
  // Data
  blockchains: BlockchainViewItem[];
  categoryCounts: Record<string, number>;
  totalCount: number;
  totalProviders: number;

  // Navigation
  selectedIndex: number;
  scrollOffset: number;

  // Filters (applied from CLI args, read-only in TUI)
  categoryFilter?: string | undefined;
  requiresApiKeyFilter?: boolean | undefined;
}

/** Per-blockchain display item */
interface BlockchainViewItem {
  name: string;
  displayName: string;
  category: string;
  layer?: string | undefined;

  providers: ProviderViewItem[];
  providerCount: number;

  // API key health
  keyStatus: 'all-configured' | 'some-missing' | 'none-needed';
  missingKeyCount: number;

  exampleAddress: string;
}

/** Per-provider display item */
interface ProviderViewItem {
  name: string;
  displayName: string;
  requiresApiKey: boolean;
  apiKeyEnvVar?: string | undefined;
  apiKeyConfigured?: boolean | undefined; // only when requiresApiKey is true
  capabilities: string[];
  rateLimit?: string | undefined;
}
```

### Actions

```typescript
type BlockchainsViewAction =
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
BlockchainsViewApp
├── Header (total + category counts + provider count)
├── BlockchainList
│   └── BlockchainRow
├── Divider
├── BlockchainDetailPanel
│   ├── ProviderListSection
│   └── ExampleSection
└── ControlsBar
```

---

## Command Options

```
exitbook blockchains view [options]

Options:
  --category <type>      Filter by category (evm, substrate, cosmos, utxo, solana)
  --requires-api-key     Show only blockchains that require API keys
  --json                 Output JSON, bypass TUI
  -h, --help             Display help
```

Note: `--detailed` is removed — the detail panel always shows full provider information including rate limits and capabilities. The TUI replaces the need for a separate verbosity flag.

---

## Implementation Notes

### Data Flow

1. Parse and validate CLI options at the boundary
2. Get supported blockchains from `getAllBlockchains()`
3. Get providers per blockchain from `ProviderRegistry.getAvailable(blockchain)`
4. Transform into `BlockchainViewItem[]` using existing `buildBlockchainInfo()` utility
5. Check API key status by reading env vars (existing pattern from `displayTextOutput`)
6. Apply category/API-key filters
7. Sort using existing `sortBlockchains()` utility
8. Render Ink TUI with dataset in memory
9. No database access needed — all data comes from the static provider registry and env vars

### API Key Health Check

For each provider that requires an API key:

1. Get `apiKeyEnvVar` from `ProviderRegistry.getMetadata(blockchain, providerName)`
2. Check `!!process.env[envVar]`
3. Aggregate per-blockchain: if all required keys present → `all-configured`, if some missing → `some-missing`, if no providers need keys → `none-needed`

### Migration from `list-blockchains`

- `list-blockchains` command removed and replaced by `blockchains view`
- All existing utility functions (`buildBlockchainInfo`, `filterByCategory`, `sortBlockchains`, etc.) reused
- `--detailed` flag removed (detail panel always shows full info)
- Text output (`displayTextOutput`) removed in favor of Ink TUI
- JSON output structure slightly restructured to match other view commands

### Terminal Size

- List panel: fills available height minus fixed chrome (header ~3, divider 1, detail panel ~8, controls ~2, scroll indicators ~2 = ~16 lines)
- Detail panel height varies by provider count (~3 lines base + 1 per provider)
- Minimum terminal width: 80 columns

### Accessibility

- Vim keys (`j`/`k`) alongside arrows
- No color-only information — icons and text labels always accompany colors
- API key status always shown as text + icon, not just color-coded
