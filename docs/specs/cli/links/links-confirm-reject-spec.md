# Links Confirm / Reject — CLI Spec

## Overview

`exitbook links confirm <link-ref>` and `exitbook links reject <link-ref>` remain as standalone CLI commands for scripting and non-TUI workflows. They use the same `LINK-REF` contract as `links view` and `links explore`.

These commands operate on a reviewable transfer proposal, not just an untouched
suggestion:

- `confirm` moves any non-confirmed legs in the selected proposal to
  `confirmed`
- `reject` moves any non-rejected legs in the selected proposal to `rejected`
- re-running the same command against an already-satisfied proposal is
  idempotent

---

## Visual Examples

### Confirm Success

```
✓ Confirmed a1b2c3d4e5 · ETH 2.0000 → 1.9970 · coinbase → ethereum (82.4%)
```

### Reject Success

```
✗ Rejected a1b2c3d4e5 · ETH 2.0000 → 1.9970 · coinbase → ethereum (82.4%)
```

### Already Confirmed

```
⚠ Link a1b2c3d4e5 is already confirmed
```

### Already Rejected

```
⚠ Link a1b2c3d4e5 is already rejected
```

### Link Not Found

```
⚠ Link a1b2c3d4e5 not found
```

---

## Output Format

Single line, no box/table. All information on one line:

```
{icon} {action} {ref} · {asset} {sourceAmt} → {targetAmt} · {source} → {target} ({confidence})
```

### Colors

| Element                               | Color      |
| ------------------------------------- | ---------- |
| `✓` (confirm)                         | green      |
| `✗` (reject)                          | dim        |
| `⚠` (error/already)                   | yellow     |
| Action text (`Confirmed`, `Rejected`) | white/bold |
| Link ref                              | white      |
| Asset                                 | white      |
| Amounts                               | green      |
| Arrow `→`                             | dim        |
| Source/target names                   | cyan       |
| Confidence                            | dim        |

---

## JSON Mode (`--json`)

Current implementation:

```json
{
  "proposalRef": "a1b2c3d4e5",
  "affectedLinkCount": 1,
  "affectedLinkIds": [123],
  "newStatus": "confirmed",
  "reviewedBy": "cli-user",
  "reviewedAt": "2024-03-15T14:30:00.000Z"
}
```

---

## Implementation Notes

- These commands fetch the link + source/target transactions to build the summary line
- The Ink render is a single `render()` → `unmount()` — no interactivity, no refresh loop
- Proposal selectors use the same `LINK-REF` shown by `links`, `links view`, and `links explore`
- The handler logic still operates on the representative numeric link ID internally after CLI ref resolution
- Accepts `LINK-REF` prefixes and fails on ambiguous prefixes the same way the browse commands do
- `confirm` and `reject` are symmetric review mutations; a rejected proposal can
  be restored through `links confirm <link-ref>`
