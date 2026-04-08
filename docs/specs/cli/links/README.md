# Links Command

## Surface

`links` is a mixed browse/workflow/review family.

- `links` / `links list` render static proposal lists by default
- `links --gaps` / `links list --gaps` render static gap lists
- `links view <ref>` renders one static proposal detail card
- `links view <ref> --gaps` renders one static gap detail card
- `links explore [ref]` opens the interactive explorer
- `links explore --gaps [ref]` opens the interactive gaps explorer

## Subcommands

| Command              | Spec                                                           | Nature                                                         |
| -------------------- | -------------------------------------------------------------- | -------------------------------------------------------------- |
| `links` / `list`     | [links-view-spec.md](./links-view-spec.md)                     | Static browse list for proposals or gaps                       |
| `links view <ref>`   | [links-view-spec.md](./links-view-spec.md)                     | Static detail for one proposal or one gap                      |
| `links explore`      | [links-view-spec.md](./links-view-spec.md)                     | Interactive explorer for proposals or gaps                     |
| `links run`          | [links-run-spec.md](./links-run-spec.md)                       | Workflow command that refreshes proposals                      |
| `links confirm <id>` | [links-confirm-reject-spec.md](./links-confirm-reject-spec.md) | Review mutation; still targets numeric representative link IDs |
| `links reject <id>`  | [links-confirm-reject-spec.md](./links-confirm-reject-spec.md) | Review mutation; still targets numeric representative link IDs |

## Design Principles

- **JSON mode always bypasses TUI** — `--json` produces structured output for scripting
- **Static first, explorer second** — `links` and `links view <ref>` are durable text/JSON surfaces; `links explore` is the interactive layer
- **Confirm/reject stay as standalone commands** — the explorer is for triage, but review mutations remain scriptable
- **`gaps` is a lens, not a status** — coverage analysis stays distinct from the link proposal lifecycle
