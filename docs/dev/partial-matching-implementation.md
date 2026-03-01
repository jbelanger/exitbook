# N:1 / 1:N Partial Matching — Implementation Guide

## What This Feature Does

Currently, the transaction linking algorithm matches withdrawals to deposits **1:1 only**: one outflow matches one inflow. This means it can't handle:

- **1:N (splits):** You withdraw 10 ETH from an exchange, and it arrives as two deposits of 5 ETH each on-chain (e.g., different wallets).
- **N:1 (consolidations):** You send 5 ETH from two exchange accounts, and it arrives as a single 10 ETH deposit on-chain.

This feature replaces the existing 1:1 greedy deduplication with a **capacity-based deduplication** algorithm. The new algorithm is a strict superset: for any case where results are 1:1, it produces identical output (via a restoration pass). It only diverges when a genuine split or consolidation exists.

There is no feature flag. The capacity algorithm runs unconditionally. Safety is provided by `minPartialMatchFraction` — an internal config constant (default 0.1 = 10%) that rejects matches where the consumed amount is too small relative to the original.

---

## Architecture Overview

The matching pipeline has 4 stages. This feature touches stages 2, 3, and 4.

```
Stage 1: findPotentialMatches()        — generates all candidate pairs (source→target)
Stage 2: deduplicateAndConfirm()       — picks the best non-overlapping subset  ← MAIN CHANGE
Stage 3: createTransactionLink()       — converts matches into link records      ← uses consumed amounts
Stage 4: validateLinkAmountsForMatch() — validates link amounts before persist   ← uses consumed amounts
```

**Key idea:** Instead of "each source/target used at most once" (1:1), the new algorithm tracks **remaining capacity** per source/target. A source with amount=10 can match target1=5 and target2=5, consuming 5+5=10 of its capacity.

---

## File-by-File Changes

### 1. Schema Changes

**File:** `packages/accounting/src/linking/schemas.ts`

#### 1a. Add `minPartialMatchFraction` to `MatchingConfigSchema`

Find the `MatchingConfigSchema` definition (line 63-69). Add one new field:

```typescript
// BEFORE:
export const MatchingConfigSchema = z.object({
  maxTimingWindowHours: z.number().positive(),
  clockSkewToleranceHours: z.number().nonnegative().default(2),
  minAmountSimilarity: DecimalSchema,
  minConfidenceScore: DecimalSchema,
  autoConfirmThreshold: DecimalSchema,
});

// AFTER:
export const MatchingConfigSchema = z.object({
  maxTimingWindowHours: z.number().positive(),
  clockSkewToleranceHours: z.number().nonnegative().default(2),
  minAmountSimilarity: DecimalSchema,
  minConfidenceScore: DecimalSchema,
  autoConfirmThreshold: DecimalSchema,
  minPartialMatchFraction: DecimalSchema.default('0.1'),
});
```

**What it means:** The consumed amount for a partial match must be at least this fraction of the **larger** original amount (source or target). Default 0.1 means at least 10%. This prevents garbage matches where a tiny target consumes a sliver of a large source.

**Example:** source=10, target=0.5, consumed=0.5. `largerOriginal = max(10, 0.5) = 10`. Threshold = `10 × 0.1 = 1.0`. Since `0.5 < 1.0`, this match is rejected.

#### 1b. Add consumed amount to `PotentialMatchSchema`

Find the `PotentialMatchSchema` definition (line 52-58). Add one optional field:

```typescript
// BEFORE:
export const PotentialMatchSchema = z.object({
  sourceTransaction: TransactionCandidateSchema,
  targetTransaction: TransactionCandidateSchema,
  confidenceScore: UnitIntervalDecimalSchema,
  matchCriteria: MatchCriteriaSchema,
  linkType: LinkTypeSchema,
});

// AFTER:
export const PotentialMatchSchema = z.object({
  sourceTransaction: TransactionCandidateSchema,
  targetTransaction: TransactionCandidateSchema,
  confidenceScore: UnitIntervalDecimalSchema,
  matchCriteria: MatchCriteriaSchema,
  linkType: LinkTypeSchema,
  consumedAmount: DecimalSchema.optional(),
});
```

**What it means:** When a match is partial (part of a 1:N or N:1 split), `consumedAmount` records how much capacity was used by _this specific link_. It is always `undefined` for 1:1 matches (including 1:1 with fees) — the restoration pass in dedup ensures this.

**Design note:** A single field suffices because the capacity algorithm always sets `consumed = min(remainingSource, remainingTarget)` — source and target consume the same amount per link. Two separate fields would suggest they can differ, creating a misleading API surface.

#### 1c. Imports

`DecimalSchema` is already imported from `@exitbook/core` (line 4). No change needed.

---

### 2. Default Config Changes

**File:** `packages/accounting/src/linking/matching-utils.ts`

Find `DEFAULT_MATCHING_CONFIG` (line 18-24). Add the new field:

```typescript
// BEFORE:
export const DEFAULT_MATCHING_CONFIG: MatchingConfig = {
  maxTimingWindowHours: 48,
  clockSkewToleranceHours: 2,
  minAmountSimilarity: parseDecimal('0.95'),
  minConfidenceScore: parseDecimal('0.7'),
  autoConfirmThreshold: parseDecimal('0.95'),
};

// AFTER:
export const DEFAULT_MATCHING_CONFIG: MatchingConfig = {
  maxTimingWindowHours: 48,
  clockSkewToleranceHours: 2,
  minAmountSimilarity: parseDecimal('0.95'),
  minConfidenceScore: parseDecimal('0.7'),
  autoConfirmThreshold: parseDecimal('0.95'),
  minPartialMatchFraction: parseDecimal('0.1'),
};
```

---

### 3. Amount Similarity Changes

**File:** `packages/accounting/src/linking/matching-utils.ts`

#### 3a. Add `allowPartialAmounts` parameter to `calculateAmountSimilarity`

Currently (line 34-58), this function returns 0 when target > source (beyond rounding tolerance). For partial matching, we need to allow any non-zero pair through — the capacity algorithm handles amount accounting.

Add a third parameter with a default of `false`:

```typescript
// BEFORE (line 34):
export function calculateAmountSimilarity(sourceAmount: Decimal, targetAmount: Decimal): Decimal {

// AFTER:
export function calculateAmountSimilarity(
  sourceAmount: Decimal,
  targetAmount: Decimal,
  allowPartialAmounts = false,
): Decimal {
```

Then add an early return right after the zero check (after line 37):

```typescript
if (sourceAmount.isZero() || targetAmount.isZero()) {
  return parseDecimal('0');
}

// NEW: When partial matching is enabled, any non-zero pair has full similarity
// (the capacity algorithm handles amount accounting in deduplication)
if (allowPartialAmounts) {
  return parseDecimal('1');
}

// ... rest of function unchanged ...
```

**Why:** Without this, a 10 ETH source and a 5 ETH target would get similarity 0.5, which is below the default 0.95 threshold and would be rejected before ever reaching the capacity algorithm.

#### 3b. Pass the flag through `buildMatchCriteria`

Find `buildMatchCriteria` (line 275-293). It already receives `config`. Update the `calculateAmountSimilarity` call:

```typescript
// BEFORE:
const amountSimilarity = calculateAmountSimilarity(source.amount, target.amount);

// AFTER:
const amountSimilarity = calculateAmountSimilarity(source.amount, target.amount, true);
```

**Note:** We always pass `true` here because the capacity algorithm always runs. The `minAmountSimilarity` hard threshold in `findPotentialMatches` is the remaining gate for non-partial pairs, and the capacity dedup handles partial pairs.

Wait — this changes behavior for _all_ matches, not just partial ones. Let me reconsider.

Actually, the correct approach: always pass `true` to `calculateAmountSimilarity` (so it returns 1.0 for all non-zero pairs). Then in `findPotentialMatches`, remove the `minAmountSimilarity` hard filter. The capacity algorithm in `deduplicateAndConfirm` now handles all amount-based filtering via `minPartialMatchFraction`.

**But this changes the confidence score calculation.** `calculateConfidenceScore` uses `amountSimilarity` as a weight. If it's always 1.0, all matches get higher confidence than they should.

**Better approach:** Keep `calculateAmountSimilarity` unchanged (don't add the parameter). Instead, only relax the **hard filter** in `findPotentialMatches`:

```typescript
// BEFORE (around line 413 in findPotentialMatches):
// Enforce minimum amount similarity as a hard threshold
if (criteria.amountSimilarity.lessThan(config.minAmountSimilarity)) {
  continue;
}

// AFTER:
// Skip minimum amount similarity filter — capacity dedup handles amount matching.
// Amount similarity still contributes to confidence score for ranking.
```

Delete (or comment out) those 3 lines. The amount similarity score still gets computed by `buildMatchCriteria` → `calculateAmountSimilarity` using the original formula, so confidence scores still reflect how close the amounts are. The capacity algorithm then handles the actual accounting.

This means:

- A 10→5 match gets `amountSimilarity = 0.5` → lower confidence → processed later in the capacity dedup (which is greedy by confidence). Good.
- A 10→9.99 match gets `amountSimilarity = 0.999` → high confidence → processed first. Good.
- No garbage matches slip through because `minPartialMatchFraction` in dedup catches them.

#### 3c. Remove the hard filter in `findPotentialMatches`

Find `findPotentialMatches` (line 303-432). Remove the minimum amount similarity check (around line 411-414):

```typescript
// DELETE these lines:
// Enforce minimum amount similarity as a hard threshold
if (criteria.amountSimilarity.lessThan(config.minAmountSimilarity)) {
  continue;
}
```

**Why safe to remove:** The capacity dedup's `minPartialMatchFraction` check provides a stronger guarantee. And for 1:1 matches that get the restoration pass, confidence-based sorting already ensures the best match wins.

**Performance note:** Removing this filter increases the candidate set. For N outflows and M inflows of the same asset within the timing window, candidates grow from ~matched-pairs to O(N×M). The capacity algorithm is O(N) over sorted candidates, so dedup itself isn't a bottleneck, but `findPotentialMatches` produces more candidates to sort. In practice, N and M are typically <1000 per asset, and the `minConfidenceScore` threshold (0.7) still filters pairs with poor timing/address scores. Monitor candidate counts in production — if they become an issue, a lightweight pre-filter (e.g., reject pairs where `target > source × 3`) can be added without changing the algorithm.

---

### 4. Deduplication Changes (the core algorithm)

**File:** `packages/accounting/src/linking/matching-utils.ts`

This is the biggest change. Replace the entire `deduplicateAndConfirm` function (line 841-911).

#### 4a. The new `deduplicateAndConfirm`

The sorting and confirm/suggest split stay. The middle section (the greedy loop) is completely replaced with capacity logic.

```typescript
export function deduplicateAndConfirm(
  matches: PotentialMatch[],
  config: MatchingConfig
): {
  confirmed: PotentialMatch[];
  suggested: PotentialMatch[];
  decisions: DeduplicationDecision[];
} {
  // Sort all matches by confidence (highest first), with hash matches prioritized as tiebreaker.
  // This ensures the best matches consume capacity first.
  const sortedMatches = [...matches].sort((a, b) => {
    const confidenceComparison = b.confidenceScore.comparedTo(a.confidenceScore);
    if (confidenceComparison !== 0) return confidenceComparison;

    const aIsHash = a.matchCriteria.hashMatch === true;
    const bIsHash = b.matchCriteria.hashMatch === true;
    if (aIsHash && !bIsHash) return -1;
    if (!aIsHash && bIsHash) return 1;
    return 0;
  });

  const { matches: deduplicatedMatches, decisions } = deduplicateWithCapacity(sortedMatches, config);

  // Separate into confirmed vs suggested based on confidence threshold
  const suggested: PotentialMatch[] = [];
  const confirmed: PotentialMatch[] = [];

  for (const match of deduplicatedMatches) {
    if (shouldAutoConfirm(match, config)) {
      confirmed.push(match);
    } else {
      suggested.push(match);
    }
  }

  return { suggested, confirmed, decisions };
}
```

#### 4b. Add `deduplicateWithCapacity` (new private function)

Add this **before** `deduplicateAndConfirm` in the file. **Export it** for direct unit testing — the function is pure and deterministic, ideal for isolated capacity logic tests.

```typescript
/** Decision trace from capacity-based deduplication. Logged at debug level for audit. */
export interface DeduplicationDecision {
  sourceId: number;
  targetId: number;
  asset: string;
  action: 'accepted' | 'rejected_no_capacity' | 'rejected_fraction' | 'restored_1to1';
  consumed?: string;
  remainingSource?: string;
  remainingTarget?: string;
}

/**
 * Capacity-based deduplication for transaction matching.
 *
 * Each source/target has a "remaining capacity" equal to its original amount.
 * When a match is accepted, the consumed amount (= min of remaining source capacity,
 * remaining target capacity) is subtracted from both sides.
 *
 * For 1:1 results (source and target each appear in exactly one link), consumed amounts
 * are stripped so that original amount semantics are preserved (important for gap analysis
 * and fee handling).
 *
 * Invariant: Each (sourceId, targetId, assetSymbol) triple produces at most one link,
 * so override fingerprints remain unique.
 *
 * Known limitation: The greedy approach (process by confidence, consume capacity) is not
 * globally optimal. A min-cost-flow algorithm could produce better overall matches when
 * multiple sources compete for the same target. In practice, confidence scoring already
 * prioritizes exact matches (amountSimilarity 1.0), and hash matches get confidence 1.0,
 * so the greedy result is near-optimal for real-world data. Can be upgraded later if needed.
 */
export function deduplicateWithCapacity(
  sortedMatches: PotentialMatch[],
  config: MatchingConfig
): { matches: PotentialMatch[]; decisions: DeduplicationDecision[] } {
  // Track remaining capacity per (transactionId, assetSymbol)
  const sourceCapacity = new Map<string, Decimal>();
  const targetCapacity = new Map<string, Decimal>();

  const makeKey = (txId: number, assetSymbol: string): string => `${txId}:${assetSymbol}`;

  const deduplicatedMatches: PotentialMatch[] = [];
  const decisions: DeduplicationDecision[] = [];

  for (const match of sortedMatches) {
    const sourceKey = makeKey(match.sourceTransaction.id, match.sourceTransaction.assetSymbol);
    const targetKey = makeKey(match.targetTransaction.id, match.targetTransaction.assetSymbol);

    // Initialize capacity on first encounter
    if (!sourceCapacity.has(sourceKey)) {
      sourceCapacity.set(sourceKey, match.sourceTransaction.amount);
    }
    if (!targetCapacity.has(targetKey)) {
      targetCapacity.set(targetKey, match.targetTransaction.amount);
    }

    const remainingSource = sourceCapacity.get(sourceKey)!;
    const remainingTarget = targetCapacity.get(targetKey)!;

    // Both must have remaining capacity
    if (remainingSource.lte(0) || remainingTarget.lte(0)) {
      decisions.push({
        sourceId: match.sourceTransaction.id,
        targetId: match.targetTransaction.id,
        asset: match.sourceTransaction.assetSymbol,
        action: 'rejected_no_capacity',
        remainingSource: remainingSource.toFixed(),
        remainingTarget: remainingTarget.toFixed(),
      });
      continue;
    }

    // Consumed = min(remaining source, remaining target)
    const consumed = Decimal.min(remainingSource, remainingTarget);

    // Reject if consumed amount is too small relative to the larger original amount.
    // This prevents garbage matches (e.g., source=10 matching a target=0.01).
    const largerOriginal = Decimal.max(match.sourceTransaction.amount, match.targetTransaction.amount);
    if (consumed.lt(largerOriginal.times(config.minPartialMatchFraction))) {
      decisions.push({
        sourceId: match.sourceTransaction.id,
        targetId: match.targetTransaction.id,
        asset: match.sourceTransaction.assetSymbol,
        action: 'rejected_fraction',
        consumed: consumed.toFixed(),
        remainingSource: remainingSource.toFixed(),
        remainingTarget: remainingTarget.toFixed(),
      });
      continue;
    }

    // Accept this match with consumed amount
    deduplicatedMatches.push({
      ...match,
      consumedAmount: consumed,
    });

    decisions.push({
      sourceId: match.sourceTransaction.id,
      targetId: match.targetTransaction.id,
      asset: match.sourceTransaction.assetSymbol,
      action: 'accepted',
      consumed: consumed.toFixed(),
      remainingSource: remainingSource.minus(consumed).toFixed(),
      remainingTarget: remainingTarget.minus(consumed).toFixed(),
    });

    // Subtract consumed capacity
    sourceCapacity.set(sourceKey, remainingSource.minus(consumed));
    targetCapacity.set(targetKey, remainingTarget.minus(consumed));
  }

  // --- 1:1 Restoration Pass ---
  //
  // For matches where both the source and target participate in exactly ONE link,
  // strip consumed amounts. This preserves original 1:1 semantics:
  //
  //   - Fee handling: source=1.0, target=0.999 → link stores (1.0, 0.999), not (0.999, 0.999)
  //   - Gap analysis: sums link.sourceAmount against outflow totals. If we stored consumed=0.999
  //     but the outflow was 1.0, gap analysis would see 0.001 uncovered → false gap.
  //
  // Only actual splits (1:N or N:1) retain consumed amounts.

  const sourceMatchCount = new Map<string, number>();
  const targetMatchCount = new Map<string, number>();

  for (const match of deduplicatedMatches) {
    const sourceKey = makeKey(match.sourceTransaction.id, match.sourceTransaction.assetSymbol);
    const targetKey = makeKey(match.targetTransaction.id, match.targetTransaction.assetSymbol);
    sourceMatchCount.set(sourceKey, (sourceMatchCount.get(sourceKey) ?? 0) + 1);
    targetMatchCount.set(targetKey, (targetMatchCount.get(targetKey) ?? 0) + 1);
  }

  const restoredMatches = deduplicatedMatches.map((match) => {
    const sourceKey = makeKey(match.sourceTransaction.id, match.sourceTransaction.assetSymbol);
    const targetKey = makeKey(match.targetTransaction.id, match.targetTransaction.assetSymbol);
    const isPure1to1 = (sourceMatchCount.get(sourceKey) ?? 0) === 1 && (targetMatchCount.get(targetKey) ?? 0) === 1;

    if (isPure1to1) {
      // Strip consumed amount — use original 1:1 semantics
      const { consumedAmount, ...rest } = match;
      decisions.push({
        sourceId: match.sourceTransaction.id,
        targetId: match.targetTransaction.id,
        asset: match.sourceTransaction.assetSymbol,
        action: 'restored_1to1',
      });
      return rest;
    }
    return match;
  });

  return { matches: restoredMatches, decisions };
}
```

**Why the 1:1 restoration pass matters (detailed example):**

Without the restoration pass, a 1:1 fee match would break:

1. Source withdraws 1.0 BTC, target deposits 0.999 BTC (0.001 fee).
2. Capacity algorithm: `consumed = min(1.0, 0.999) = 0.999`.
3. Link stores `sourceAmount=0.999, targetAmount=0.999`.
4. Gap analysis sums `link.sourceAmount` (0.999) against outflow total (1.0) → sees 0.001 uncovered → **false gap**.

With the restoration pass:

1. Same match, but it's the only link for both source and target → `isPure1to1 = true`.
2. Consumed amounts stripped → link stores `sourceAmount=1.0, targetAmount=0.999` (original amounts).
3. Gap analysis: 1.0 vs 1.0 → no gap. Correct.

---

### 5. Link Creation Changes

**File:** `packages/accounting/src/linking/matching-utils.ts`

#### 5a. Update `createTransactionLink` to use consumed amounts

Find `createTransactionLink` (line 923-972). Replace the function body:

```typescript
export function createTransactionLink(
  match: PotentialMatch,
  status: 'suggested' | 'confirmed',
  now: Date
): Result<NewTransactionLink, Error> {
  const assetSymbol = match.sourceTransaction.assetSymbol;

  // For partial matches (1:N or N:1), use consumed amount for both sides.
  // For 1:1 matches (no consumed amount), use original transaction amounts.
  const isPartialMatch = match.consumedAmount !== undefined;
  const sourceAmount = isPartialMatch ? match.consumedAmount! : match.sourceTransaction.amount;
  const targetAmount = isPartialMatch ? match.consumedAmount! : match.targetTransaction.amount;

  // Validate amounts
  const validationResult = validateLinkAmountsForMatch(match);
  if (validationResult.isErr()) {
    return err(validationResult.error);
  }

  // Build metadata
  const validationInfo = validationResult.value;
  const metadata: Record<string, unknown> = {};

  if (isPartialMatch) {
    // Partial match: record full original amounts for audit trail.
    // No impliedFee — it's meaningless for splits/consolidations.
    metadata.partialMatch = true;
    metadata.fullSourceAmount = match.sourceTransaction.amount.toFixed();
    metadata.fullTargetAmount = match.targetTransaction.amount.toFixed();
    metadata.consumedAmount = sourceAmount.toFixed();
  } else {
    // 1:1 match: variance/implied fee (original behavior, unchanged)
    const varianceMetadata = calculateVarianceMetadata(sourceAmount, targetAmount);
    Object.assign(metadata, varianceMetadata);
  }

  if (validationInfo.allowTargetExcess) {
    metadata.targetExcessAllowed = true;
    metadata.targetExcess = validationInfo.allowTargetExcess.excess.toFixed();
    metadata.targetExcessPct = validationInfo.allowTargetExcess.excessPct.toFixed(2);
  }

  return ok({
    sourceTransactionId: match.sourceTransaction.id,
    targetTransactionId: match.targetTransaction.id,
    assetSymbol,
    sourceAssetId: match.sourceTransaction.assetId,
    targetAssetId: match.targetTransaction.assetId,
    sourceAmount,
    targetAmount,
    linkType: match.linkType,
    confidenceScore: match.confidenceScore,
    matchCriteria: match.matchCriteria,
    status,
    reviewedBy: status === 'confirmed' ? 'auto' : undefined,
    reviewedAt: status === 'confirmed' ? now : undefined,
    createdAt: now,
    updatedAt: now,
    metadata,
  });
}
```

#### 5b. Update `validateLinkAmountsForMatch`

Find `validateLinkAmountsForMatch` (line 547-582). Use consumed amounts when present:

```typescript
export function validateLinkAmountsForMatch(match: PotentialMatch): Result<LinkAmountValidationInfo, Error> {
  // Use consumed amount if present (partial match), otherwise original amounts
  const sourceAmount = match.consumedAmount ?? match.sourceTransaction.amount;
  const targetAmount = match.consumedAmount ?? match.targetTransaction.amount;

  const baseValidation = validateLinkAmounts(sourceAmount, targetAmount);
  if (baseValidation.isOk()) {
    return ok({});
  }

  if (sourceAmount.lte(0) || targetAmount.lte(0)) {
    return err(baseValidation.error);
  }

  // Only consider override when target exceeds source and hash match is true
  if (!targetAmount.gt(sourceAmount)) {
    return err(baseValidation.error);
  }

  if (match.matchCriteria.hashMatch !== true) {
    return err(baseValidation.error);
  }

  const excess = targetAmount.minus(sourceAmount);
  const excessPct = excess.div(sourceAmount).times(100);

  if (excessPct.gt(MAX_HASH_MATCH_TARGET_EXCESS_PCT)) {
    return err(baseValidation.error);
  }

  return ok({
    allowTargetExcess: {
      excess,
      excessPct,
    },
  });
}
```

---

### 6. Orchestrator Changes

**File:** `packages/accounting/src/linking/linking-orchestrator.ts`

#### 6a. Wire `minPartialMatchFraction` through `runMatchingAlgorithm`

Find `runMatchingAlgorithm` (line 189-220). Add the new field to the config object:

```typescript
// BEFORE:
const service = new TransactionLinkingEngine(logger, {
  maxTimingWindowHours: 48,
  clockSkewToleranceHours: DEFAULT_MATCHING_CONFIG.clockSkewToleranceHours,
  minAmountSimilarity: DEFAULT_MATCHING_CONFIG.minAmountSimilarity,
  minConfidenceScore: params.minConfidenceScore,
  autoConfirmThreshold: params.autoConfirmThreshold,
});

// AFTER:
const service = new TransactionLinkingEngine(logger, {
  maxTimingWindowHours: 48,
  clockSkewToleranceHours: DEFAULT_MATCHING_CONFIG.clockSkewToleranceHours,
  minAmountSimilarity: DEFAULT_MATCHING_CONFIG.minAmountSimilarity,
  minConfidenceScore: params.minConfidenceScore,
  autoConfirmThreshold: params.autoConfirmThreshold,
  minPartialMatchFraction: DEFAULT_MATCHING_CONFIG.minPartialMatchFraction,
});
```

No changes to `LinkingRunParams` — the fraction is not user-facing, it comes from `DEFAULT_MATCHING_CONFIG`.

#### 6b. Log deduplication decisions in `TransactionLinkingEngine`

The `deduplicateAndConfirm` return value now includes `decisions`. In the engine's matching method, log them at `debug` level for audit:

```typescript
const { confirmed, suggested, decisions } = deduplicateAndConfirm(potentialMatches, config);

if (decisions.length > 0) {
  logger.debug(
    { decisions, confirmedCount: confirmed.length, suggestedCount: suggested.length },
    'Capacity deduplication decisions'
  );
}
```

This provides a full audit trail of why each match was accepted, rejected, or restored to 1:1 — critical for debugging production matching in a financial system.

---

### 7. No CLI or Prereqs Changes

Since there's no feature flag, **no changes** are needed in:

- `apps/cli/src/features/links/links-run.ts`
- `apps/cli/src/features/shared/schemas.ts`
- `apps/cli/src/features/shared/prereqs.ts`

---

### 8. Downstream Consumer Changes

The matching pipeline (sections 1-7) produces links with partial amounts (`link.sourceAmount` = `consumedAmount`, not the full outflow amount). Three downstream systems read `link.sourceAmount` and `link.targetAmount` after persistence and must be updated.

#### Current invariant (1:1 only):

- `link.sourceAmount` = `outflow.netAmount ?? outflow.grossAmount` (or UTXO-adjusted override)
- `link.targetAmount` = `inflow.netAmount ?? inflow.grossAmount`

#### New invariant (with partial matching):

- For 1:1 links: unchanged (restoration pass strips `consumedAmount`)
- For partial links: `link.sourceAmount = link.targetAmount = consumedAmount` — a fraction of the original outflow/inflow

#### 8a. `LinkIndex` — source key lookup mismatch

**File:** `packages/accounting/src/linking/link-index.ts`

**Problem:** `findBySource(txId, assetId, amount)` builds a key `${txId}:${assetId}:${amount.toFixed()}`. The caller passes `outflow.netAmount ?? outflow.grossAmount` as the lookup amount. For a partial link, `link.sourceAmount = consumedAmount` (e.g., 5), but the outflow amount is 10. The key won't match.

The existing fallback `findAnyBySource(txId, assetId)` catches this — it uses `sourceByTxAssetMap` which is keyed by `txId:assetId` only. **But** `findAnyBySource` returns only the _first_ link. For 1:N splits (one source → two links), it would find the first and lose the second.

**Changes:**

1. Add `findAllBySource(txId: number, assetId: string): TransactionLink[]` — returns all links for a given source transaction + asset, regardless of amount. Uses the existing `sourceByTxAssetMap`.

2. In `lot-matcher.ts`, update `findEffectiveSourceLink` to handle multi-link results (see 8c below).

```typescript
// In LinkIndex:
findAllBySource(txId: number, assetId: string): TransactionLink[] {
  const key = buildTxAssetKey(txId, assetId);
  return this.sourceByTxAssetMap.get(key) ?? [];
}
```

#### 8b. `processTransferSource` — variance validation against partial `link.targetAmount`

**File:** `packages/accounting/src/cost-basis/lot-transfer-processing-utils.ts`

**Problem:** `processTransferSource` calls `validateTransferVariance(netTransferAmount, link.targetAmount, ...)`. For a partial link where `link.targetAmount = 5` and the outflow's net amount is 10, variance = 50% — instant failure.

**Changes:**

When the link has `metadata.partialMatch === true`, the effective transfer amount is `link.sourceAmount` (= `consumedAmount`), not the full outflow amount. The variance check should compare `link.sourceAmount` against `link.targetAmount`:

```typescript
// In processTransferSource, before variance check:
const isPartialLink = link.metadata?.partialMatch === true;
const netTransferAmount = isPartialLink
  ? link.sourceAmount // For partial links, the transfer is the consumed amount
  : (effectiveAmount ?? calculateNetTransferAmount(outflow));

const varianceResult = validateTransferVariance(
  netTransferAmount,
  link.targetAmount,
  tx.source,
  tx.id,
  outflow.assetSymbol,
  varianceTolerance
);
```

For partial links, `sourceAmount === targetAmount === consumedAmount`, so variance is always 0%. This is correct — fees are not attributed in partial matches (documented in section 5).

#### 8c. `lot-matcher.ts` — multi-link processing for 1:N splits

**File:** `packages/accounting/src/cost-basis/lot-matcher.ts`

**Problem:** `findEffectiveSourceLink` returns a single `SourceLinkResult`. For 1:N splits, one outflow has multiple cross-source links. The current single-link path processes only one.

**Changes:**

Update `findEffectiveSourceLink` to return an array when the source has multiple links:

```typescript
// Option A: Process each partial link as a separate "disposal" of consumedAmount
//
// For outflow of 10 ETH with two links (consumed=5 each):
//   - Process link 1: dispose 5 ETH, transfer 5 lots to target 1
//   - Process link 2: dispose 5 ETH, transfer 5 lots to target 2
//
// The lot-matcher already processes one outflow → one link in sequence.
// For multi-link, iterate over each link and process with effectiveAmount = link.sourceAmount.
```

The key insight: `link.sourceAmount` for a partial link is the consumed amount. Pass it as `effectiveAmount` to `processTransferSource`, which already supports an `effectiveAmount` override (used for UTXO partial outflows). The machinery exists — we just need to invoke it multiple times.

Concrete changes to `findEffectiveSourceLink` and its call site in the disposal loop:

```typescript
// In the disposal loop (around line 185-200):
const links = this.findEffectiveSourceLinks(tx, outflow, linkIndex);
// links is now SourceLinkResult[] instead of SourceLinkResult | null

for (const linkResult of links) {
  if (linkResult.type === 'transfer') {
    const { link } = linkResult;
    // For partial links, effectiveAmount = consumedAmount (= link.sourceAmount)
    const effectiveAmount = link.metadata?.partialMatch ? link.sourceAmount : undefined;
    const transferResult = this.handleTransferSource(tx, outflow, link, assetState.lots, config, effectiveAmount);
    // ... handle result
  }
}
```

#### 8d. Target-side processing for N:1 consolidations

**Problem (less severe):** For N:1 consolidation, one target receives two links. The inflow side in `processTransferTarget` processes one link at a time — each link's `targetAmount` is the consumed portion. The lot matcher processes inflows by finding the target link via `LinkIndex.findByTarget(txId, assetId)`.

**Current behavior:** `findByTarget` returns one link (the first found). For N:1, the target has multiple links.

**Changes:** `findByTarget` should return all links for the target. Each link carries `link.targetAmount = consumedAmount`, and the lot transfer from each source is processed independently. Since lot transfers are additive (each contributes lots to the target), processing them sequentially is correct.

```typescript
// In LinkIndex:
findAllByTarget(txId: number, assetId: string): TransactionLink[] {
  const key = buildTxAssetKey(txId, assetId);
  return this.targetByTxAssetMap.get(key) ?? [];
}
```

#### 8e. Summary of downstream changes

| File                               | Change                                                           | Why                                              |
| ---------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------ |
| `link-index.ts`                    | Add `findAllBySource()` and `findAllByTarget()`                  | Return all links for multi-link sources/targets  |
| `lot-matcher.ts`                   | Multi-link iteration in disposal loop                            | Process each partial link as a separate transfer |
| `lot-transfer-processing-utils.ts` | Use `link.sourceAmount` as `netTransferAmount` for partial links | Avoid variance failure on partial amounts        |

---

### 9. Imports

In `matching-utils.ts`, you need `Decimal` imported for `Decimal.min` / `Decimal.max` in `deduplicateWithCapacity`. Check if it's already imported:

```typescript
// At top of matching-utils.ts, ensure this exists:
import { Decimal } from 'decimal.js';
```

If only `parseDecimal` is imported from `@exitbook/core`, you also need the direct `Decimal` import from `decimal.js` for the static methods.

---

## Test Plan

All test files are in `packages/accounting/src/linking/__tests__/`.

Use the existing helpers from `./test-utils.ts`:

- `createCandidate(overrides)` — creates a `TransactionCandidate`
- `createLink(params)` — creates a `TransactionLink`

The standard test config:

```typescript
const config: MatchingConfig = {
  ...DEFAULT_MATCHING_CONFIG,
  // Override specific fields as needed per test
};
```

### Test file: `matching-utils.test.ts`

#### Test Group: `deduplicateAndConfirm` — capacity-based matching

**Test 1: 1:N split — one source matches two targets**

Scenario: Exchange withdrawal of 10 ETH arrives as two 5 ETH deposits.

```typescript
it('should split one source across two targets (1:N)', () => {
  const source = createCandidate({ id: 1, amount: parseDecimal('10'), direction: 'out' });
  const target1 = createCandidate({
    id: 2,
    amount: parseDecimal('5'),
    direction: 'in',
    sourceName: 'blockchain',
    sourceType: 'blockchain',
  });
  const target2 = createCandidate({
    id: 3,
    amount: parseDecimal('5'),
    direction: 'in',
    sourceName: 'blockchain',
    sourceType: 'blockchain',
  });

  const matches: PotentialMatch[] = [
    {
      sourceTransaction: source,
      targetTransaction: target1,
      confidenceScore: parseDecimal('0.9'),
      matchCriteria: { assetMatch: true, amountSimilarity: parseDecimal('0.5'), timingValid: true, timingHours: 1 },
      linkType: 'exchange_to_blockchain',
    },
    {
      sourceTransaction: source,
      targetTransaction: target2,
      confidenceScore: parseDecimal('0.85'),
      matchCriteria: { assetMatch: true, amountSimilarity: parseDecimal('0.5'), timingValid: true, timingHours: 2 },
      linkType: 'exchange_to_blockchain',
    },
  ];

  const { confirmed, suggested } = deduplicateAndConfirm(matches, DEFAULT_MATCHING_CONFIG);
  const all = [...confirmed, ...suggested];

  // Both matches accepted — source has capacity for both
  expect(all).toHaveLength(2);

  // Both are partial (source appears in 2 links) → consumed amounts present
  expect(all[0].consumedAmount?.toFixed()).toBe('5');
  expect(all[1].consumedAmount?.toFixed()).toBe('5');
});
```

**Test 2: N:1 consolidation — two sources match one target**

Scenario: Two 5 ETH exchange withdrawals arrive as one 10 ETH blockchain deposit.

```typescript
it('should consolidate two sources into one target (N:1)', () => {
  const source1 = createCandidate({ id: 1, amount: parseDecimal('5'), direction: 'out' });
  const source2 = createCandidate({ id: 2, amount: parseDecimal('5'), direction: 'out' });
  const target = createCandidate({
    id: 3,
    amount: parseDecimal('10'),
    direction: 'in',
    sourceName: 'blockchain',
    sourceType: 'blockchain',
  });

  const matches: PotentialMatch[] = [
    {
      sourceTransaction: source1,
      targetTransaction: target,
      confidenceScore: parseDecimal('0.9'),
      matchCriteria: { assetMatch: true, amountSimilarity: parseDecimal('0.5'), timingValid: true, timingHours: 1 },
      linkType: 'exchange_to_blockchain',
    },
    {
      sourceTransaction: source2,
      targetTransaction: target,
      confidenceScore: parseDecimal('0.85'),
      matchCriteria: { assetMatch: true, amountSimilarity: parseDecimal('0.5'), timingValid: true, timingHours: 2 },
      linkType: 'exchange_to_blockchain',
    },
  ];

  const { confirmed, suggested } = deduplicateAndConfirm(matches, DEFAULT_MATCHING_CONFIG);
  const all = [...confirmed, ...suggested];

  // Both matches accepted — target has capacity for both
  expect(all).toHaveLength(2);

  // Both are partial (target appears in 2 links) → consumed amounts present
  expect(all[0].consumedAmount?.toFixed()).toBe('5');
  expect(all[1].consumedAmount?.toFixed()).toBe('5');
});
```

**Test 3: minPartialMatchFraction rejects tiny matches**

Scenario: source=10, target=0.5. `consumed=0.5`, `largerOriginal=10`, threshold=`10×0.1=1.0`. Since `0.5 < 1.0`, rejected.

```typescript
it('should reject match when consumed is below minPartialMatchFraction of larger original', () => {
  const source = createCandidate({ id: 1, amount: parseDecimal('10'), direction: 'out' });
  const target = createCandidate({
    id: 2,
    amount: parseDecimal('0.5'),
    direction: 'in',
    sourceName: 'blockchain',
    sourceType: 'blockchain',
  });

  const matches: PotentialMatch[] = [
    {
      sourceTransaction: source,
      targetTransaction: target,
      confidenceScore: parseDecimal('0.9'),
      matchCriteria: { assetMatch: true, amountSimilarity: parseDecimal('0.05'), timingValid: true, timingHours: 1 },
      linkType: 'exchange_to_blockchain',
    },
  ];

  const config = { ...DEFAULT_MATCHING_CONFIG, minPartialMatchFraction: parseDecimal('0.1') };
  const { confirmed, suggested } = deduplicateAndConfirm(matches, config);

  expect([...confirmed, ...suggested]).toHaveLength(0);
});
```

**Test 4: 1:1 fee match preserves original amounts (restoration pass)**

This is the critical regression test. A 1:1 match with fees must NOT have consumed amounts.

```typescript
it('should preserve original amounts for 1:1 matches (restoration pass)', () => {
  const source = createCandidate({ id: 1, amount: parseDecimal('1.0'), direction: 'out' });
  const target = createCandidate({
    id: 2,
    amount: parseDecimal('0.999'),
    direction: 'in',
    sourceName: 'blockchain',
    sourceType: 'blockchain',
  });

  const matches: PotentialMatch[] = [
    {
      sourceTransaction: source,
      targetTransaction: target,
      confidenceScore: parseDecimal('0.95'),
      matchCriteria: { assetMatch: true, amountSimilarity: parseDecimal('0.999'), timingValid: true, timingHours: 1 },
      linkType: 'exchange_to_blockchain',
    },
  ];

  const { confirmed } = deduplicateAndConfirm(matches, DEFAULT_MATCHING_CONFIG);

  expect(confirmed).toHaveLength(1);
  // No consumed amounts — this is a pure 1:1 match
  expect(confirmed[0].consumedAmount).toBeUndefined();
});
```

**Test 5: Capacity exhaustion — partial consumption**

Scenario: source=10 matches target1=6 and target2=6. After target1 consumes 6, only 4 remains. target2 gets 4 (not 6).

```typescript
it('should partially consume remaining capacity when exhausted', () => {
  const source = createCandidate({ id: 1, amount: parseDecimal('10'), direction: 'out' });
  const target1 = createCandidate({
    id: 2,
    amount: parseDecimal('6'),
    direction: 'in',
    sourceName: 'blockchain',
    sourceType: 'blockchain',
  });
  const target2 = createCandidate({
    id: 3,
    amount: parseDecimal('6'),
    direction: 'in',
    sourceName: 'blockchain',
    sourceType: 'blockchain',
  });

  const matches: PotentialMatch[] = [
    {
      sourceTransaction: source,
      targetTransaction: target1,
      confidenceScore: parseDecimal('0.95'),
      matchCriteria: { assetMatch: true, amountSimilarity: parseDecimal('0.6'), timingValid: true, timingHours: 1 },
      linkType: 'exchange_to_blockchain',
    },
    {
      sourceTransaction: source,
      targetTransaction: target2,
      confidenceScore: parseDecimal('0.85'),
      matchCriteria: { assetMatch: true, amountSimilarity: parseDecimal('0.6'), timingValid: true, timingHours: 2 },
      linkType: 'exchange_to_blockchain',
    },
  ];

  const { confirmed, suggested } = deduplicateAndConfirm(matches, DEFAULT_MATCHING_CONFIG);
  const all = [...confirmed, ...suggested];

  // Both accepted: first gets 6, second gets min(4, 6) = 4
  // 4 >= max(10, 6) * 0.1 = 1.0 → passes minPartialMatchFraction
  expect(all).toHaveLength(2);
  expect(all[0].consumedAmount?.toFixed()).toBe('6');
  expect(all[1].consumedAmount?.toFixed()).toBe('4');
});
```

**Test 6: Exact 1:1 match — no consumed amounts**

```typescript
it('should not set consumed amounts for exact 1:1 match', () => {
  const source = createCandidate({ id: 1, amount: parseDecimal('5'), direction: 'out' });
  const target = createCandidate({
    id: 2,
    amount: parseDecimal('5'),
    direction: 'in',
    sourceName: 'blockchain',
    sourceType: 'blockchain',
  });

  const matches: PotentialMatch[] = [
    {
      sourceTransaction: source,
      targetTransaction: target,
      confidenceScore: parseDecimal('0.99'),
      matchCriteria: { assetMatch: true, amountSimilarity: parseDecimal('1'), timingValid: true, timingHours: 0.5 },
      linkType: 'exchange_to_blockchain',
    },
  ];

  const { confirmed } = deduplicateAndConfirm(matches, DEFAULT_MATCHING_CONFIG);

  expect(confirmed).toHaveLength(1);
  expect(confirmed[0].consumedAmount).toBeUndefined();
});
```

#### Test Group: `createTransactionLink` — partial matching

**Test 7: Partial match link uses consumed amounts and partial metadata**

```typescript
it('should use consumed amounts and partial metadata for partial match', () => {
  const source = createCandidate({ id: 1, amount: parseDecimal('10'), direction: 'out' });
  const target = createCandidate({
    id: 2,
    amount: parseDecimal('5'),
    direction: 'in',
    sourceName: 'blockchain',
    sourceType: 'blockchain',
  });

  const match: PotentialMatch = {
    sourceTransaction: source,
    targetTransaction: target,
    confidenceScore: parseDecimal('0.9'),
    matchCriteria: { assetMatch: true, amountSimilarity: parseDecimal('0.5'), timingValid: true, timingHours: 1 },
    linkType: 'exchange_to_blockchain',
    consumedAmount: parseDecimal('5'),
  };

  const result = createTransactionLink(match, 'confirmed', new Date());
  expect(result.isOk()).toBe(true);

  const link = result._unsafeUnwrap();
  // Link amounts use consumed, not original
  expect(link.sourceAmount.toFixed()).toBe('5');
  expect(link.targetAmount.toFixed()).toBe('5');
  // Partial metadata present
  expect(link.metadata?.partialMatch).toBe(true);
  expect(link.metadata?.fullSourceAmount).toBe('10');
  expect(link.metadata?.fullTargetAmount).toBe('5');
  expect(link.metadata?.consumedAmount).toBe('5');
  // No impliedFee for partial matches
  expect(link.metadata?.impliedFee).toBeUndefined();
});
```

**Test 8: N:1 metadata doesn't produce negative implied fee**

```typescript
it('should not produce negative impliedFee for N:1 partial match', () => {
  const source = createCandidate({ id: 1, amount: parseDecimal('5'), direction: 'out' });
  const target = createCandidate({
    id: 2,
    amount: parseDecimal('10'),
    direction: 'in',
    sourceName: 'blockchain',
    sourceType: 'blockchain',
  });

  const match: PotentialMatch = {
    sourceTransaction: source,
    targetTransaction: target,
    confidenceScore: parseDecimal('0.85'),
    matchCriteria: { assetMatch: true, amountSimilarity: parseDecimal('0.5'), timingValid: true, timingHours: 1 },
    linkType: 'exchange_to_blockchain',
    consumedAmount: parseDecimal('5'),
  };

  const result = createTransactionLink(match, 'confirmed', new Date());
  expect(result.isOk()).toBe(true);

  const link = result._unsafeUnwrap();
  expect(link.metadata?.impliedFee).toBeUndefined();
  expect(link.metadata?.partialMatch).toBe(true);
});
```

**Test 9: 1:1 match still has variance/impliedFee metadata (unchanged behavior)**

```typescript
it('should include variance metadata for 1:1 match (no consumed amounts)', () => {
  const source = createCandidate({ id: 1, amount: parseDecimal('1.0'), direction: 'out' });
  const target = createCandidate({
    id: 2,
    amount: parseDecimal('0.999'),
    direction: 'in',
    sourceName: 'blockchain',
    sourceType: 'blockchain',
  });

  const match: PotentialMatch = {
    sourceTransaction: source,
    targetTransaction: target,
    confidenceScore: parseDecimal('0.95'),
    matchCriteria: { assetMatch: true, amountSimilarity: parseDecimal('0.999'), timingValid: true, timingHours: 1 },
    linkType: 'exchange_to_blockchain',
    // No consumed amounts — 1:1 match
  };

  const result = createTransactionLink(match, 'confirmed', new Date());
  expect(result.isOk()).toBe(true);

  const link = result._unsafeUnwrap();
  expect(link.sourceAmount.toFixed()).toBe('1');
  expect(link.targetAmount.toFixed()).toBe('0.999');
  expect(link.metadata?.impliedFee).toBe('0.001');
  expect(link.metadata?.partialMatch).toBeUndefined();
});
```

### Test file: `schemas.test.ts`

**Test 10: MatchingConfigSchema accepts and defaults minPartialMatchFraction**

```typescript
it('should default minPartialMatchFraction to 0.1', () => {
  const result = MatchingConfigSchema.parse({
    maxTimingWindowHours: 48,
    minAmountSimilarity: '0.95',
    minConfidenceScore: '0.7',
    autoConfirmThreshold: '0.95',
  });
  expect(result.minPartialMatchFraction.toFixed(1)).toBe('0.1');
});
```

**Test 11: PotentialMatchSchema accepts optional consumedAmount**

```typescript
it('should accept optional consumedAmount', () => {
  // Build a valid match without consumed amount
  const baseMatch = {
    /* valid PotentialMatch fields */
  };
  const result1 = PotentialMatchSchema.safeParse(baseMatch);
  expect(result1.success).toBe(true);

  // With consumed amount
  const result2 = PotentialMatchSchema.safeParse({
    ...baseMatch,
    consumedAmount: '5',
  });
  expect(result2.success).toBe(true);
});
```

### Test file: `link-index.test.ts` (or existing test location)

**Test 13: findAllBySource returns multiple links for same source**

```typescript
it('should return all links for a source with multiple partial links', () => {
  const link1 = createLink({
    sourceTransactionId: 1,
    targetTransactionId: 2,
    assetSymbol: 'ETH',
    sourceAmount: parseDecimal('5'),
    targetAmount: parseDecimal('5'),
    metadata: { partialMatch: true },
  });
  const link2 = createLink({
    sourceTransactionId: 1,
    targetTransactionId: 3,
    assetSymbol: 'ETH',
    sourceAmount: parseDecimal('5'),
    targetAmount: parseDecimal('5'),
    metadata: { partialMatch: true },
  });

  const index = new LinkIndex([link1, link2]);
  const results = index.findAllBySource(1, 'ETH');

  expect(results).toHaveLength(2);
});
```

**Test 14: findAllByTarget returns multiple links for same target**

```typescript
it('should return all links for a target with multiple partial links', () => {
  const link1 = createLink({
    sourceTransactionId: 1,
    targetTransactionId: 3,
    assetSymbol: 'ETH',
    sourceAmount: parseDecimal('5'),
    targetAmount: parseDecimal('5'),
    metadata: { partialMatch: true },
  });
  const link2 = createLink({
    sourceTransactionId: 2,
    targetTransactionId: 3,
    assetSymbol: 'ETH',
    sourceAmount: parseDecimal('5'),
    targetAmount: parseDecimal('5'),
    metadata: { partialMatch: true },
  });

  const index = new LinkIndex([link1, link2]);
  const results = index.findAllByTarget(3, 'ETH');

  expect(results).toHaveLength(2);
});
```

### Test file: `transaction-linking-engine.test.ts`

**Test 12: Engine accepts minPartialMatchFraction in config**

```typescript
it('should accept minPartialMatchFraction in config', () => {
  const engine = new TransactionLinkingEngine(logger, {
    ...DEFAULT_MATCHING_CONFIG,
    minPartialMatchFraction: parseDecimal('0.05'),
  });
  expect(engine).toBeDefined();
});
```

---

## Verification Checklist

Run in this order:

```bash
# 1. Type check — catches missing config fields everywhere
pnpm build

# 2. Unit tests for changed files (matching pipeline)
pnpm vitest run packages/accounting/src/linking/__tests__/matching-utils.test.ts
pnpm vitest run packages/accounting/src/linking/__tests__/schemas.test.ts
pnpm vitest run packages/accounting/src/linking/__tests__/transaction-linking-engine.test.ts

# 3. Unit tests for downstream consumers
pnpm vitest run packages/accounting/src/linking/__tests__/link-index.test.ts
pnpm vitest run packages/accounting/src/cost-basis/

# 4. Full test suite — catch regressions
pnpm test

# 5. Lint
pnpm lint

# 6. Manual smoke test (requires imported data in apps/cli/data/)
pnpm run dev links run --dry-run

# 7. End-to-end: run cost-basis after linking to verify downstream path
pnpm run dev cost-basis run
```

---

## Summary of All Files Changed

| #   | File                                                                           | What Changes                                                                                                                                                                                                                                                                                                                                                             |
| --- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `packages/accounting/src/linking/schemas.ts`                                   | Add `minPartialMatchFraction` to `MatchingConfigSchema`. Add `consumedAmount` to `PotentialMatchSchema`.                                                                                                                                                                                                                                                                 |
| 2   | `packages/accounting/src/linking/matching-utils.ts`                            | Update `DEFAULT_MATCHING_CONFIG`. Remove `minAmountSimilarity` hard filter from `findPotentialMatches`. Add exported `deduplicateWithCapacity` + `DeduplicationDecision` type. Replace `deduplicateAndConfirm` internals (returns `decisions`). Update `createTransactionLink` for consumed amount + metadata. Update `validateLinkAmountsForMatch` for consumed amount. |
| 3   | `packages/accounting/src/linking/linking-orchestrator.ts`                      | Add `minPartialMatchFraction` to config in `runMatchingAlgorithm`.                                                                                                                                                                                                                                                                                                       |
| 4   | `packages/accounting/src/linking/transaction-linking-engine.ts`                | Log `decisions` from `deduplicateAndConfirm` at debug level.                                                                                                                                                                                                                                                                                                             |
| 5   | `packages/accounting/src/linking/link-index.ts`                                | Add `findAllBySource()` and `findAllByTarget()` methods.                                                                                                                                                                                                                                                                                                                 |
| 6   | `packages/accounting/src/cost-basis/lot-matcher.ts`                            | Multi-link iteration in disposal loop for 1:N splits.                                                                                                                                                                                                                                                                                                                    |
| 7   | `packages/accounting/src/cost-basis/lot-transfer-processing-utils.ts`          | Use `link.sourceAmount` as `netTransferAmount` for partial links.                                                                                                                                                                                                                                                                                                        |
| 8   | `packages/accounting/src/linking/__tests__/matching-utils.test.ts`             | Add tests 1-9.                                                                                                                                                                                                                                                                                                                                                           |
| 9   | `packages/accounting/src/linking/__tests__/schemas.test.ts`                    | Add tests 10-11.                                                                                                                                                                                                                                                                                                                                                         |
| 10  | `packages/accounting/src/linking/__tests__/transaction-linking-engine.test.ts` | Add test 12.                                                                                                                                                                                                                                                                                                                                                             |

**Not changed** (no CLI flag):

- `apps/cli/src/features/links/links-run.ts`
- `apps/cli/src/features/shared/schemas.ts`
- `apps/cli/src/features/shared/prereqs.ts`

## Implementation Order

1. **Schemas** (section 1) — types first, everything depends on them
2. **Default config** (section 2) — `pnpm build` will fail without this
3. **Orchestrator** (section 6) — wire `minPartialMatchFraction` through
4. **Run `pnpm build`** — verify type-check passes
5. **Amount similarity + findPotentialMatches** (section 3) — relax filtering
6. **Deduplication** (section 4) — the core algorithm change
7. **Link creation + validation** (section 5) — consumed amount handling
8. **Downstream consumers** (section 8) — LinkIndex, lot-matcher, processTransferSource
9. **Tests** — all 12 tests
10. **Run `pnpm test`** — full regression
11. **Run `pnpm lint`** — style check
