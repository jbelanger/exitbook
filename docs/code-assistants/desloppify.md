# Desloppify Guide

Repo-local notes for running `desloppify` in `exitbook`. Use this alongside the
generic skill doc when the generic happy path and the observed repo behavior
diverge.

## Resetting State

For a true clean slate, delete the full local workspace state and rebuild it:

```bash
rm -rf .desloppify
desloppify scan --path .
desloppify status
```

This wipes:

- plan history
- review packets and run artifacts
- ignores / suppressions stored in `.desloppify/config.json`
- previous subjective scores

It also regenerates `scorecard.png`, which is a tracked file in this repo.

## Recommended Codex Review Flow

Use this repo-specific sequence:

```bash
desloppify review --prepare
desloppify review --run-batches --runner codex --parallel
desloppify status
desloppify show review --status open
```

Why not `--scan-after-import` here:

- the review import succeeds
- the follow-up scan often exits `1`
- the failure is usually the queue gate, not the review import
- you still get durable subjective scores and tracked review issues

Rescan later, after the live queue is cleared:

```bash
desloppify scan --path .
```

If you intentionally need a mid-cycle rescan, use the explicit override:

```bash
desloppify scan --force-rescan --attest "I understand this resets the plan-start score and I am intentionally forcing a rescan"
```

## Which Output To Trust

Use these commands as the source of truth:

- `desloppify plan queue` for the live execution queue
- `desloppify next` for the next actionable item
- `desloppify show review --status open` for imported review findings
- `desloppify plan show` for cluster counts, including stale tracked review clusters

Important behavior:

- After review import, `next` may still point to the mechanical clusters
  (`auto/test_coverage`, `auto/exports`, `auto/security`).
- Review clusters can appear as stale tracked items until the live queue reaches
  them.
- `show review --status open` obeys a noise budget, so the first screen is not
  the full issue list.

When messages conflict, trust `desloppify plan queue` and `desloppify next`
over incidental runner text.

## Batch Retry Workflow

Batch runs write reproducible artifacts under `.desloppify/subagents/runs/<timestamp>/`.

Use these files:

- `run.log` for orchestration events
- `run_summary.json` for completion status
- `prompts/batch-*.md` for the exact per-batch prompt
- `results/batch-*.raw.txt` for raw runner output

If a specific batch fails, retry only that slice from the immutable packet:

```bash
desloppify review --run-batches \
  --runner codex \
  --packet .desloppify/review_packets/holistic_packet_<timestamp>.json \
  --only-batches <idx>
```

## Repo Quirks Worth Remembering

- `scorecard.png` is tracked, so scans dirty the worktree.
- A full reset removes local excludes and ignore rules, not just the plan.
- Review imports can succeed even when the trailing scan fails.
- `desloppify plan show` can report stale tracked review items while
  `desloppify plan queue` still shows only the top three live mechanical
  clusters.
