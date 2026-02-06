# Links Run — Operation Tree Spec

## Overview

`exitbook links run` executes the transaction linking algorithm and displays progress as an Ink operation tree. No live streaming — the algorithm runs synchronously — but a rich completion summary shows what happened.

---

## Visual Examples

### Fresh Run (No Existing Links)

```
✓ Loaded 4,063 transactions (1.2s)
  ├─ 2,847 outflows (sources)
  └─ 1,216 inflows (targets)
✓ Matching (340ms)
  ├─ 47 internal (same tx hash)
  ├─ 8 confirmed (≥95%)
  └─ 4 suggested (70–95%)
✓ Saved 59 links (180ms)

✓ Done (1.7s)

Next: exitbook links view --status suggested
```

### Re-run (Existing Links Present)

```
✓ Loaded 4,063 transactions (1.1s)
  ├─ 2,847 outflows (sources)
  └─ 1,216 inflows (targets)
✓ 59 existing links cleared
✓ Matching (380ms)
  ├─ 47 internal (same tx hash)
  ├─ 12 confirmed (≥95%)
  └─ 3 suggested (70–95%)
✓ Saved 62 links (200ms)

✓ Done (1.7s)
```

### Dry Run

```
✓ Loaded 4,063 transactions (1.2s)
  ├─ 2,847 outflows (sources)
  └─ 1,216 inflows (targets)
✓ Matching — dry run (340ms)
  ├─ 47 internal (same tx hash)
  ├─ 8 confirmed (≥95%)
  └─ 4 suggested (70–95%)

✓ Done — dry run, nothing saved (1.5s)
```

### No Matches Found

```
✓ Loaded 142 transactions (200ms)
  ├─ 89 outflows (sources)
  └─ 53 inflows (targets)
✓ Matching (40ms)
  └─ No matches found

✓ Done (240ms)
```

### No Transactions

```
✓ Loaded 0 transactions (80ms)

✓ Done (80ms)
```

### Aborted (Ctrl-C)

```
✓ Loaded 4,063 transactions (1.2s)
  ├─ 2,847 outflows (sources)
  └─ 1,216 inflows (targets)
⠋ Matching · 2.1s

⚠ Aborted (3.3s)
```

### Error

```
✓ Loaded 4,063 transactions (1.2s)
  ├─ 2,847 outflows (sources)
  └─ 1,216 inflows (targets)

⚠ Failed (1.3s)
  Database is locked
```

---

## Operation Tree Structure

### Phase 1: Load Transactions

```
⠋ Loading transactions · {duration}
```

Completed:

```
✓ Loaded {count} transactions ({duration})
  ├─ {sourceCount} outflows (sources)
  └─ {targetCount} inflows (targets)
```

Sub-lines only appear when `count > 0`.

### Phase 2: Clear Existing (conditional)

Only shown when existing links are present and this is not a dry run:

```
✓ {existingCount} existing links cleared
```

### Phase 3: Matching

Active:

```
⠋ Matching · {duration}
```

Completed (with matches):

```
✓ Matching ({duration})
  ├─ {internalCount} internal (same tx hash)       ← only if > 0
  ├─ {confirmedCount} confirmed (≥95%)
  └─ {suggestedCount} suggested (70–95%)
```

Completed (no matches):

```
✓ Matching ({duration})
  └─ No matches found
```

Dry run label:

```
✓ Matching — dry run ({duration})
```

Sub-line rules:

- Internal line only appears when `internalCount > 0`
- Last sub-line uses `└─`, others use `├─`
- Threshold percentages come from the actual config values, not hardcoded

### Phase 4: Save

Only shown when not dry run and matches exist:

```
✓ Saved {totalLinks} links ({duration})
```

### Completion

Success:

```
✓ Done ({totalDuration})
```

Success (dry run):

```
✓ Done — dry run, nothing saved ({totalDuration})
```

With next steps (only when suggested > 0):

```
✓ Done ({totalDuration})

Next: exitbook links view --status suggested
```

Aborted:

```
⚠ Aborted ({totalDuration})
```

Failed:

```
⚠ Failed ({totalDuration})
  {errorMessage}
```

---

## Color Specification

Follows the same three-tier hierarchy as the ingestion dashboard:

### Signal tier (icons)

| Icon | Color  | Meaning          |
| ---- | ------ | ---------------- |
| `✓`  | green  | Completed        |
| `⠋`  | cyan   | Active (spinner) |
| `⚠`  | yellow | Warning/failure  |

### Content tier (what you read)

| Element                                      | Color      |
| -------------------------------------------- | ---------- |
| Phase labels: `Loading`, `Matching`, `Saved` | white/bold |
| Counts: `4,063`, `59`, `12`                  | green      |
| `dry run` label                              | yellow     |
| `No matches found`                           | dim        |

### Context tier (recedes)

| Element                                                              | Color |
| -------------------------------------------------------------------- | ----- |
| Durations                                                            | dim   |
| Tree chars `├─` `└─`                                                 | dim   |
| Parentheticals: `(sources)`, `(targets)`, `(same tx hash)`, `(≥95%)` | dim   |
| `Next:` hint line                                                    | dim   |

---

## State Model

```typescript
interface LinksRunState {
  // Phase 1: Load
  load?: {
    status: OperationStatus;
    startedAt: number;
    completedAt?: number;
    totalTransactions: number;
    sourceCount: number;
    targetCount: number;
  };

  // Phase 2: Clear existing
  existingCleared?: number; // undefined = not applicable, number = count cleared

  // Phase 3: Match
  match?: {
    status: OperationStatus;
    startedAt: number;
    completedAt?: number;
    internalCount: number;
    confirmedCount: number;
    suggestedCount: number;
  };

  // Phase 4: Save
  save?: {
    status: OperationStatus;
    startedAt: number;
    completedAt?: number;
    totalSaved: number;
  };

  // Completion
  isComplete: boolean;
  aborted?: boolean;
  errorMessage?: string;
  totalDurationMs?: number;
  dryRun: boolean;
}
```

---

## Interactive Mode

When no flags are provided, `links run` prompts before executing:

```
◆ Run in dry-run mode?
│ ○ Yes / ● No
│
◆ Minimum confidence score (0-1):
│ 0.7
│
◆ Auto-confirm threshold (0-1):
│ 0.95
│
◆ Start transaction linking?
│ ● Yes / ○ No
```

After confirmation, the Ink operation tree takes over. The prompts use @clack/prompts (same as today) — Ink renders only during execution.

---

## JSON Mode (`--json`)

Bypasses the Ink TUI entirely. Outputs structured JSON:

```json
{
  "existingLinksCleared": 59,
  "internalLinksCount": 47,
  "confirmedLinksCount": 12,
  "suggestedLinksCount": 3,
  "totalSourceTransactions": 2847,
  "totalTargetTransactions": 1216,
  "unmatchedSourceCount": 2788,
  "unmatchedTargetCount": 1154,
  "totalSaved": 62,
  "dryRun": false
}
```

---

## Handler Changes Required

The current `LinksRunHandler` needs to:

1. **Count existing links before clearing** — `linkRepo.countAll()` before `linkRepo.deleteAll()`
2. **Clear existing links before saving** — full re-link, not incremental (avoids stale/duplicate links)
3. **Report internal vs cross-source counts separately** — the `LinkingResult` already distinguishes these, but the handler collapses them
4. **Return richer result** — `existingLinksCleared`, `internalLinksCount` as separate fields

---

## Implementation Notes

- The operation tree is a standalone Ink component, not reusing the ingestion dashboard
- Shares the same color conventions and `formatDuration` utility
- No refresh loop needed — phases are sequential, render updates happen between phases
- SIGINT handler calls `abort()` on state, re-renders, exits
