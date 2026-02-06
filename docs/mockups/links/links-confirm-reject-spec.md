# Links Confirm / Reject — CLI Spec

## Overview

`exitbook links confirm <id>` and `exitbook links reject <id>` remain as standalone CLI commands for scripting and non-TUI workflows. They get a cleaner single-line Ink output.

---

## Visual Examples

### Confirm Success

```
✓ Confirmed m3n4o5p6 · ETH 2.0000 → 1.9970 · coinbase → ethereum (82.4%)
```

### Reject Success

```
✗ Rejected m3n4o5p6 · ETH 2.0000 → 1.9970 · coinbase → ethereum (82.4%)
```

### Already Confirmed

```
⚠ Link m3n4o5p6 is already confirmed
```

### Already Rejected

```
⚠ Link m3n4o5p6 is already rejected
```

### Link Not Found

```
⚠ Link m3n4o5p6 not found
```

---

## Output Format

Single line, no box/table. All information on one line:

```
{icon} {action} {id} · {asset} {sourceAmt} → {targetAmt} · {source} → {target} ({confidence})
```

### Colors

| Element                               | Color      |
| ------------------------------------- | ---------- |
| `✓` (confirm)                         | green      |
| `✗` (reject)                          | dim        |
| `⚠` (error/already)                   | yellow     |
| Action text (`Confirmed`, `Rejected`) | white/bold |
| ID                                    | white      |
| Asset                                 | white      |
| Amounts                               | green      |
| Arrow `→`                             | dim        |
| Source/target names                   | cyan       |
| Confidence                            | dim        |

---

## JSON Mode (`--json`)

Same structure as current implementation — no changes needed:

```json
{
  "linkId": "m3n4o5p6-...",
  "newStatus": "confirmed",
  "reviewedBy": "cli-user",
  "reviewedAt": "2024-03-15T14:30:00.000Z"
}
```

---

## Implementation Notes

- These commands fetch the link + source/target transactions to build the summary line
- The Ink render is a single `render()` → `unmount()` — no interactivity, no refresh loop
- Short IDs: display first 8 chars of UUID (same as `links view` list)
- The handler logic stays the same — only the CLI output layer changes from `console.log` to Ink
- Accepts both short IDs (first 8 chars) and full UUIDs — handler does prefix match
