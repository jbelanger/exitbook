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
- `desloppify plan queue --cluster auto/review-...` can still look empty while
  review issues remain open, if triage has not been completed yet.
- `show review --status open` obeys a noise budget, so the first screen is not
  the full issue list.

When messages conflict, trust `desloppify plan queue` and `desloppify next`
over incidental runner text.

## Recording Progress After Fixes

Use this when code has already been changed and you want `desloppify` to reflect
the progress without re-analysing the workflow from scratch.

### 1. Confirm the open review issues you actually fixed

```bash
desloppify show review --status open
```

Use the full review IDs printed at the end of each issue block, not the short
display hashes from triage summaries.

### 2. Finish triage if review issues are still gated

If `desloppify plan queue` only shows mechanical clusters but `show review`
still lists the architecture findings you fixed, the missing step is usually
triage, not more coding.

```bash
desloppify plan triage --run-stages --runner codex
```

This promotes the imported review work into coherent execution plan state. You
do **not** need to clear `auto/exports` or `auto/security` first just to record
completed review fixes.

If objective backlog is still open, `desloppify` may block staged triage unless
you override it explicitly:

```bash
desloppify plan triage --run-stages --runner codex \
  --attestation "I am intentionally recording completed architecture review work while objective backlog remains open."
```

Observed repo behavior: the staged Codex runner can still fail during the first
`observe` stage even with the attestation override. When that happens, do not
re-analyse the whole workflow from scratch. Use one of these fallbacks:

- Full/manual path: record the first triage via the explicit `--stage observe`,
  `--stage reflect`, `--stage organize`, `--stage enrich`, and
  `--stage sense-check` commands.
- Progress-recording shortcut: if you already finished concrete code fixes and
  only need plan state to catch up, resolve the addressed review issues with
  `--force-resolve`, then return to full triage later.

### 3. Resolve the review findings you completed

After triage, resolve the exact review IDs you addressed:

```bash
desloppify plan resolve <review-id> <review-id> ... \
  --note "what changed and why it resolves the finding" \
  --confirm
```

Notes:

- Prefer resolving only findings you can tie to a concrete code change.
- `--confirm` is the normal path; it generates the required attestation from the
  note.
- If triage is still incomplete or the staged runner failed and you need to
  record finished work anyway, `--force-resolve` bypasses the triage guardrail.
  Treat that as the exception, not the default.

### 4. Record the commit after the code lands

Resolution marks plan state. Commit tracking is separate:

```bash
desloppify plan commit-log record
```

Run that after the commit exists so the fix history and PR notes stay aligned.

### 5. Rescan only if you want refreshed score/mechanical state now

Resolving review findings does **not** require a rescan. A rescan is only for
refreshing score, mechanical detectors, and `scorecard.png`.

Recommended after the live queue is cleared:

```bash
desloppify scan --path .
```

If you intentionally need a checkpoint mid-cycle:

```bash
desloppify scan --force-rescan --attest "I understand this resets the plan-start score and I am intentionally forcing a rescan"
```

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
