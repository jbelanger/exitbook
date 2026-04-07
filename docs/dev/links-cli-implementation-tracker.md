# Links CLI Phase 0 Tracker

Tracks the active semantic-cleanup slice for the `links` family before the full V3 browse migration.

## Status

Phase 0 is complete. The remaining `links` work is the full V3 browse-family migration, not more semantic cleanup of `status` vs `gaps`.

## Goal

Clarify the `links` review model so the CLI stops treating coverage gaps like a link status.

## Verified Current Facts

- Real link statuses in code are `suggested`, `confirmed`, and `rejected` in [links-option-schemas.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/links/command/links-option-schemas.ts).
- Coverage gaps are produced by separate analysis in [links-gap-analysis.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/links/command/view/links-gap-analysis.ts).
- `links view --gaps` is now the canonical gaps entrypoint in [links-view.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/links/command/view/links-view.ts).
- `links gaps` still exists, but only as a compatibility alias documented in [links.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/links/command/links.ts).
- The current links spec now matches that contract in [links-view-spec.md](/Users/joel/Dev/exitbook/docs/specs/cli/links/links-view-spec.md).

## Canonical Terms

- `status`: persisted proposal state for actual links only
  - `suggested`
  - `confirmed`
  - `rejected`
- `gaps`: coverage-analysis lens over unresolved movement coverage, not a link status
- `needs-review`: future union queue for suggested links plus gaps; not part of the current phase-0 contract

## Phase 0 Decisions

1. `status` remains `suggested | confirmed | rejected` only.
2. `gaps` is a separate coverage-analysis lens, not a status value.
3. `links view --gaps` is the canonical gaps path.
4. `links gaps` remains as a compatibility alias until the full family migration lands.
5. `needs-review` stays deferred until the unified queue shape is explicitly designed.

## Phase 0 Work Completed

- `links` docs and help no longer describe gaps as a status value.
- `links view --gaps` works in both text and JSON modes.
- `links gaps` still works and is documented as compatibility-only.
- `--gaps` is rejected when combined with links-only filters such as `--status`, confidence filters, or `--verbose`.

## Next Phase

- Normalize the family onto the V3 browse shape:
  - `links`
  - `links list`
  - `links view <fingerprint>`
  - `links explore [fingerprint]`
- Decide the default queue shape on top of the now-clean `status` / `gaps` contract.
- Revisit whether the compatibility alias can be removed after the browse migration lands.

## Still Out Of Scope

- Full `links` V3 browse-ladder migration (`links`, `links list`, `links view <fingerprint>`, `links explore [fingerprint]`)
- Changing review commands from numeric IDs to fingerprints
- Implementing a combined `--needs-review` queue
