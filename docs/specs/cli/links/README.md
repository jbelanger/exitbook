# Links Command

## Surface

`links` is a mixed browse/workflow/review family.

- `links` / `links list` render static proposal lists by default
- `links view <ref>` renders one static proposal detail card
- `links explore [ref]` opens the interactive proposal explorer
- `links create <source-ref> <target-ref> --asset <symbol>` creates a confirmed manual link when no suggestion exists
- `links gaps` renders the static gap list
- `links gaps view <ref>` renders one static gap detail card
- `links gaps explore [ref]` opens the interactive gaps explorer
- `links gaps resolve <ref>` records a transaction-level reviewed exception
- `links gaps reopen <ref>` removes a prior transaction-level exception

## Subcommands

| Command                    | Spec                                                           | Nature                                                                      |
| -------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `links` / `links list`     | [links-view-spec.md](./links-view-spec.md)                     | Static browse list for transfer proposals                                   |
| `links view <ref>`         | [links-view-spec.md](./links-view-spec.md)                     | Static detail for one proposal                                              |
| `links explore`            | [links-view-spec.md](./links-view-spec.md)                     | Interactive explorer for proposals                                          |
| `links create <src> <dst>` | [links-create-spec.md](./links-create-spec.md)                 | Confirm an exact manual transfer link between two known transactions        |
| `links gaps`               | [links-view-spec.md](./links-view-spec.md)                     | Static browse list for unresolved gap rows with transaction-level selectors |
| `links gaps view <ref>`    | [links-view-spec.md](./links-view-spec.md)                     | Static detail for one selected transaction ref in the gaps workflow         |
| `links gaps explore [ref]` | [links-view-spec.md](./links-view-spec.md)                     | Interactive gaps explorer                                                   |
| `links gaps resolve <ref>` | [links-view-spec.md](./links-view-spec.md)                     | Record a transaction-level gap exception without creating a link            |
| `links gaps reopen <ref>`  | [links-view-spec.md](./links-view-spec.md)                     | Reopen a previously-resolved transaction-level gap exception                |
| `links run`                | [links-run-spec.md](./links-run-spec.md)                       | Workflow command that refreshes proposals                                   |
| `links confirm <ref>`      | [links-confirm-reject-spec.md](./links-confirm-reject-spec.md) | Review mutation using the same derived proposal ref as browse surfaces      |
| `links reject <ref>`       | [links-confirm-reject-spec.md](./links-confirm-reject-spec.md) | Review mutation using the same derived proposal ref as browse surfaces      |

## Design Principles

- **JSON mode always bypasses TUI** — `--json` produces structured output for scripting
- **Static first, explorer second** — `links` and `links view <ref>` are durable text/JSON surfaces; `links explore` is the interactive layer
- **Manual exact links stay scriptable** — `links create` is the no-proposal path when the user already knows the correct source/target pair
- **Confirm/reject stay as standalone commands** — the explorer is for triage, but review mutations remain scriptable
- **`gaps` is a first-class sub-workflow** — coverage analysis stays distinct from the link proposal lifecycle and now has its own command family
- **Gap exceptions are transaction-level** — resolving a gap hides the transaction from the open-gaps lens without inventing a synthetic link
