---
last_verified: 2026-04-16
status: active
---

# CLI Issue Investigation Log

Owner: Codex + Joel

Purpose:

- record what it is like to investigate and solve real accounting issues using
  only the shipped CLI surface
- capture repeatable workflows that may later become a user-facing skill
- surface command friction, missing affordances, ambiguous wording, and places
  where the CLI leaks implementation knowledge

Scope rules:

- use only `pnpm run dev ...` command flows
- do not inspect SQLite directly
- do not patch state outside the command surface
- if a workflow requires internal access to succeed, record that as a surface
  gap instead of working around it silently

What belongs here:

- issue family investigated
- exact CLI commands used
- whether the workflow was discoverable without guessing
- whether the command output was sufficient to continue
- any missing or misleading command examples
- any point where the user would reasonably get stuck
- any fix we ship because of what the CLI investigation revealed

What does not belong here:

- canonical behavioral rules that should live in specs
- long-term execution tracking that belongs in a feature implementation plan
- temporary shell transcripts without conclusions

## Pass 1: Baseline Live Validation

Date: 2026-04-16

Goal:

- verify that the `issues` queue, `links gaps`, and a real reporting command
  behave coherently through the CLI alone
- verify that a real profile-owned corrective action updates the persisted issue
  projection immediately without any manual rebuild step

Commands used:

```bash
pnpm run dev issues --json
pnpm run dev links gaps --json
pnpm run dev cost-basis --jurisdiction CA --tax-year 2024 --method average-cost --json
pnpm run dev links gaps resolve --help
pnpm run dev links gaps reopen --help
pnpm run dev issues view 0bc2408d69 --json
pnpm run dev links gaps resolve 65e2da44fb --reason "CLI-only refresh validation" --json
pnpm run dev issues view 0bc2408d69 --json
pnpm run dev links gaps reopen 65e2da44fb --reason "CLI-only refresh validation cleanup" --json
pnpm run dev issues view 0bc2408d69 --json
```

Findings:

- `issues` and `links gaps` are now coherent:
  - `issues` surfaced `73` blocking issues
  - `links gaps` surfaced `65` transfer gaps
  - the transfer-gap burden shown in `issues` matches the specialized gap lens
- `cost-basis` failed cleanly and routed to the exact scoped
  `issues cost-basis ...` command instead of leaving the user at a dead end
- resolving gap `65e2da44fb` through `links gaps resolve` made issue
  `0bc2408d69` disappear immediately on the next `issues view`, without any
  manual rebuild command
- reopening the same gap through `links gaps reopen` restored the issue
  immediately, confirming that profile-owned issue projection refresh now works
  through the shipped CLI surface

Command-surface assessment:

- `links gaps resolve/reopen --help` is discoverable enough for a reversible
  validation workflow
- `issues view` for transfer-gap issues gives enough routing information to find
  the owning workflow without guessing
- the scoped `cost-basis` failure path is now strong enough for user recovery

Open observations:

- the next CLI-only investigation should target a real unresolved issue, not
  just surface coherence
- the current live workspace still has two main burdens:
  - many `asset_review_blocker` issues
  - many `transfer_gap` issues
- the failed scoped cost-basis lens is the best candidate for later CLI-only
  investigation of cross-command reporting workflows
