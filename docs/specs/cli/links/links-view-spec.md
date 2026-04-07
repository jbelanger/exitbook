# Links Browse Spec

## Overview

The `links` family now follows the standard browse contract:

- `exitbook links` / `exitbook links list` -> static list
- `exitbook links view <ref>` -> static detail
- `exitbook links explore [ref]` -> interactive explorer

`links` has two browse lenses:

- proposals (default)
- gaps (`--gaps`)

`links run`, `links confirm`, and `links reject` remain separate workflow/review commands.

## Selector Model

### Proposal Selectors

`links view <ref>` and `links explore <ref>` target a transfer proposal.

- The selector is the prefix of the representative proposal leg's persisted resolved-link fingerprint.
- The displayed `REF` column uses that shortened prefix.
- Ambiguous prefixes must fail and tell the user to provide a longer ref.

### Gap Selectors

`links view <ref> --gaps` and `links explore <ref> --gaps` target one gap issue.

- The selector is the prefix of the persisted transaction fingerprint for the gap row.
- The displayed `REF` column uses that shortened prefix.

## Proposal Lens

### Static List

Commands:

```text
exitbook links
exitbook links list
exitbook links --status suggested
exitbook links --min-confidence 0.8
exitbook links --json
```

Behavior:

- Shows proposal rows, not raw link legs.
- Groups all legs in the same transfer proposal into one row.
- Root and `list` are equivalent.

Filters:

- `--status suggested|confirmed|rejected`
- `--min-confidence`
- `--max-confidence`

List columns:

- `REF`
- `DATE`
- `ASSET`
- `STATUS`
- `ROUTE`
- `CONF`
- `LEGS`

### Static Detail

Commands:

```text
exitbook links view <proposal_ref>
exitbook links view <proposal_ref> --verbose
exitbook links view <proposal_ref> --json
```

Behavior:

- Renders one durable proposal detail card.
- Includes proposal ref, status, route, confidence, matched amount, representative link ID, and leg list.
- `--verbose` adds full address details where available.
- Suggested proposals include `links confirm <id>` and `links reject <id>` next-step hints using the representative link ID.

Invalid combinations:

- proposal selector + `--status`
- proposal selector + confidence filters

### Interactive Explorer

Commands:

```text
exitbook links explore
exitbook links explore --status suggested
exitbook links explore <proposal_ref>
```

Behavior:

- Opens the existing proposal-review TUI.
- Selector preselects the target proposal.
- Confirm/reject actions remain inline and proposal-scoped.
- Off-TTY or `--json` falls back to durable static/detail output.

## Gaps Lens

### Static List

Commands:

```text
exitbook links --gaps
exitbook links list --gaps
exitbook links --gaps --json
```

Behavior:

- Shows coverage-gap issues, not proposals.
- Each row corresponds to one unresolved movement coverage issue.

List columns:

- `REF`
- `DATE`
- `SOURCE`
- `DIR`
- `ASSET`
- `MISSING`
- `COVERAGE`
- `READINESS`

### Static Detail

Commands:

```text
exitbook links view <gap_ref> --gaps
exitbook links view <gap_ref> --gaps --json
```

Behavior:

- Renders one gap detail card with transaction ref, fingerprint, source, date, operation, gap amount, coverage, and readiness.
- Includes next-step guidance:
  - review suggested proposals with `links explore --status suggested` when suggestions exist
  - rerun `links run` when no suggestions exist yet

### Interactive Explorer

Commands:

```text
exitbook links explore --gaps
exitbook links explore <gap_ref> --gaps
```

Behavior:

- Opens the read-only gaps TUI.
- Selector preselects the gap row.
- Off-TTY or `--json` falls back to durable static/detail output.

## Compatibility Aliases

The family keeps two compatibility paths for now:

- `exitbook links gaps` -> compatibility alias for `exitbook links explore --gaps`
- `exitbook links view --gaps` -> compatibility alias for `exitbook links explore --gaps`

These exist to avoid breaking the phase-0 semantic cleanup path while the family settles on the normalized surface.

## JSON Contract

### Lists

- Proposal lists return proposal summary rows.
- Gap lists return gap summary rows.
- JSON list output includes standard view metadata with active filters.

### Detail

- Proposal detail returns one proposal object with leg-level detail.
- Gap detail returns one gap object.
- Detail metadata includes the selected ref.

## Review Commands

`links confirm <id>` and `links reject <id>` are intentionally unchanged in this migration.

- They still target numeric representative link IDs.
- They remain standalone review mutations rather than becoming selector-based browse commands.

## Semantic Rules

- `status` applies only to persisted proposals: `suggested`, `confirmed`, `rejected`
- `gaps` is a separate coverage-analysis lens, not a status
- `needs-review` remains deferred until a unified queue shape is explicitly designed
