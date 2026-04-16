# Links Command

## Surface

`links` is a mixed browse/workflow/review family.

- `links` / `links list` render static proposal lists by default
- `links view <link-ref>` renders one static proposal detail card
- `links explore [link-ref]` opens the interactive proposal explorer
- `links create <source-ref> <target-ref> --asset <symbol>` creates a confirmed manual link when no suggestion exists
- `links create-grouped --source ... --target ... --asset <symbol>` creates confirmed grouped manual links for exact many-to-one or one-to-many transfers
- `links gaps` renders the static gap list
- `links gaps view <gap-ref>` renders one static gap detail card
- `links gaps explore [gap-ref]` opens the interactive gaps explorer
- `links gaps resolve <gap-ref>` records a resolved gap exception
- `links gaps reopen <gap-ref>` removes a prior resolved gap exception

## Subcommands

| Command                        | Spec                                                           | Nature                                                                     |
| ------------------------------ | -------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `links` / `links list`         | [links-view-spec.md](./links-view-spec.md)                     | Static browse list for transfer proposals                                  |
| `links view <link-ref>`        | [links-view-spec.md](./links-view-spec.md)                     | Static detail for one proposal                                             |
| `links explore`                | [links-view-spec.md](./links-view-spec.md)                     | Interactive explorer for proposals                                         |
| `links create <src> <dst>`     | [links-create-spec.md](./links-create-spec.md)                 | Confirm an exact manual transfer link between two known transactions       |
| `links create-grouped`         | [links-create-grouped-spec.md](./links-create-grouped-spec.md) | Confirm exact grouped manual transfer links for many-to-one or one-to-many |
| `links gaps`                   | [links-view-spec.md](./links-view-spec.md)                     | Static browse list for unresolved gap rows with `GAP-REF` selectors        |
| `links gaps view <gap-ref>`    | [links-view-spec.md](./links-view-spec.md)                     | Static detail for one selected `GAP-REF` in the gaps workflow              |
| `links gaps explore [gap-ref]` | [links-view-spec.md](./links-view-spec.md)                     | Interactive gaps explorer                                                  |
| `links gaps resolve <gap-ref>` | [links-view-spec.md](./links-view-spec.md)                     | Record a resolved gap exception without creating a link                    |
| `links gaps reopen <gap-ref>`  | [links-view-spec.md](./links-view-spec.md)                     | Reopen a previously-resolved gap exception                                 |
| `links run`                    | [links-run-spec.md](./links-run-spec.md)                       | Workflow command that refreshes proposals                                  |
| `links confirm <link-ref>`     | [links-confirm-reject-spec.md](./links-confirm-reject-spec.md) | Review mutation using the same derived `LINK-REF` as browse surfaces       |
| `links reject <link-ref>`      | [links-confirm-reject-spec.md](./links-confirm-reject-spec.md) | Review mutation using the same derived `LINK-REF` as browse surfaces       |

## Design Principles

- **JSON mode always bypasses TUI** — `--json` produces structured output for scripting
- **Static first, explorer second** — `links` and `links view <link-ref>` are durable text/JSON surfaces; `links explore` is the interactive layer
- **Manual exact links stay scriptable** — `links create` is the no-proposal path when the user already knows the correct source/target pair
- **Grouped manual links stay narrow** — `links create-grouped` handles exact `N:1` / `1:N` only, plus one exact explained target residual on `N:1`, and does not become a general allocator
- **Confirm/reject stay as standalone commands** — the explorer is for triage, but review mutations remain scriptable
- **`gaps` is a first-class sub-workflow** — coverage analysis stays distinct from the link proposal lifecycle and now has its own command family
- **Gap exceptions stay gap-specific** — resolving a gap hides one `txFingerprint + assetId + direction` gap row from the open-gaps lens without inventing a synthetic link
