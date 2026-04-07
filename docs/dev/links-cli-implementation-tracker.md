# Links CLI Phase 0 Tracker

Tracks the active semantic-cleanup slice for the `links` family before the full V3 browse migration.

## Goal

Clarify the `links` review model so the CLI stops treating coverage gaps like a link status.

## Verified Current Facts

- Real link statuses in code are `suggested`, `confirmed`, and `rejected` in [links-option-schemas.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/links/command/links-option-schemas.ts).
- Coverage gaps are produced by separate analysis in [links-gap-analysis.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/links/command/view/links-gap-analysis.ts).
- The current spec still documents `--status gaps` in [links-view-spec.md](/Users/joel/Dev/exitbook/docs/specs/cli/links/links-view-spec.md), which no longer matches the live schema.
- The current CLI still exposes `links gaps` as a separate browse entrypoint in [links.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/links/command/links.ts).

## Canonical Terms

- `status`: persisted proposal state for actual links only
  - `suggested`
  - `confirmed`
  - `rejected`
- `gaps`: coverage-analysis lens over unresolved movement coverage, not a link status
- `needs-review`: future union queue for suggested links plus gaps; not part of the current phase-0 contract

## Phase 0 Scope

1. Make `links view --gaps` the canonical gaps entrypoint.
2. Keep `links gaps` as a compatibility alias during migration.
3. Remove `gap` / `gaps` from status-oriented language in current docs and help.
4. Add strict validation so `--gaps` cannot be combined with links-only filters such as `--status`, confidence filters, or `--verbose`.

## Exit Criteria

- `links` docs and help no longer describe gaps as a status value.
- `links view --gaps` works in both text and JSON modes.
- `links gaps` still works, but is documented as compatibility-only.
- `needs-review` stays explicitly deferred until the unified queue shape is designed.

## Out Of Scope

- Full `links` V3 browse-ladder migration (`links`, `links list`, `links view <fingerprint>`, `links explore [fingerprint]`)
- Changing review commands from numeric IDs to fingerprints
- Implementing a combined `--needs-review` queue
