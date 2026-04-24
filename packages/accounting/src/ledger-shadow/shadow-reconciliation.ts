import type { Transaction } from '@exitbook/core';
import { err, ok, type Currency, type Result } from '@exitbook/foundation';
import type {
  AccountingJournalDraft,
  AccountingJournalKind,
  AccountingPostingRole,
  AccountingSettlement,
  SourceActivityDraft,
} from '@exitbook/ledger';
import type { Logger } from '@exitbook/logger';
import { Decimal } from 'decimal.js';

import { buildAccountingModelFromTransactions } from '../accounting-model/build-accounting-model-from-transactions.js';

interface LedgerShadowEffectIdentity {
  assetId: string;
  role: AccountingPostingRole;
  settlement?: AccountingSettlement | undefined;
  sourceKey: string;
}

export interface LedgerShadowEffect extends LedgerShadowEffectIdentity {
  assetSymbol: Currency;
  journalKinds?: readonly AccountingJournalKind[] | undefined;
  quantity: Decimal;
}

export interface LedgerShadowEffectDiff extends LedgerShadowEffectIdentity {
  assetSymbol: Currency;
  delta: Decimal;
  ledgerJournalKinds?: readonly AccountingJournalKind[] | undefined;
  ledgerQuantity?: Decimal | undefined;
  legacyQuantity?: Decimal | undefined;
}

export interface LedgerShadowReconciliationResult {
  diffs: readonly LedgerShadowEffectDiff[];
  ledgerEffects: readonly LedgerShadowEffect[];
  legacyEffects: readonly LedgerShadowEffect[];
}

export interface LedgerShadowDraft {
  journals: readonly AccountingJournalDraft[];
  sourceActivity: SourceActivityDraft;
}

function buildEffectKey(effect: LedgerShadowEffectIdentity): string {
  return `${effect.sourceKey}|${effect.assetId}|${effect.role}|${effect.settlement ?? ''}`;
}

function resolveLegacySourceKey(transaction: Transaction): string {
  const blockchainTransactionHash = transaction.blockchain?.transaction_hash?.trim();
  if (transaction.platformKind === 'blockchain' && blockchainTransactionHash) {
    return `${transaction.platformKey}:${transaction.accountId}:${blockchainTransactionHash}`;
  }

  return transaction.txFingerprint;
}

function resolveLedgerSourceKey(sourceActivity: SourceActivityDraft): string {
  const blockchainTransactionHash = sourceActivity.blockchainTransactionHash?.trim();
  if (sourceActivity.platformKind === 'blockchain' && blockchainTransactionHash) {
    return `${sourceActivity.platformKey}:${sourceActivity.ownerAccountId}:${blockchainTransactionHash}`;
  }

  return sourceActivity.sourceActivityFingerprint;
}

function pushOrAccumulateEffect(
  effectsByKey: Map<string, LedgerShadowEffect>,
  effect: LedgerShadowEffect
): Result<void, Error> {
  const key = buildEffectKey(effect);
  const existing = effectsByKey.get(key);

  if (!existing) {
    effectsByKey.set(key, effect);
    return ok(undefined);
  }

  if (existing.assetSymbol !== effect.assetSymbol) {
    return err(
      new Error(
        `Ledger shadow effect ${key} has conflicting asset symbols: ${existing.assetSymbol} vs ${effect.assetSymbol}`
      )
    );
  }

  const journalKinds =
    existing.journalKinds || effect.journalKinds
      ? Array.from(new Set([...(existing.journalKinds ?? []), ...(effect.journalKinds ?? [])])).sort()
      : undefined;

  effectsByKey.set(key, {
    ...existing,
    journalKinds,
    quantity: existing.quantity.plus(effect.quantity),
  });

  return ok(undefined);
}

function sortEffects(effects: Iterable<LedgerShadowEffect>): LedgerShadowEffect[] {
  return [...effects].sort((left, right) => {
    const sourceComparison = left.sourceKey.localeCompare(right.sourceKey);
    if (sourceComparison !== 0) {
      return sourceComparison;
    }

    const assetComparison = left.assetId.localeCompare(right.assetId);
    if (assetComparison !== 0) {
      return assetComparison;
    }

    const roleComparison = left.role.localeCompare(right.role);
    if (roleComparison !== 0) {
      return roleComparison;
    }

    return (left.settlement ?? '').localeCompare(right.settlement ?? '');
  });
}

export function buildLegacyLedgerShadowEffects(
  transactions: readonly Transaction[],
  logger: Logger
): Result<LedgerShadowEffect[], Error> {
  const accountingModelResult = buildAccountingModelFromTransactions([...transactions], logger);
  if (accountingModelResult.isErr()) {
    return err(accountingModelResult.error);
  }

  const effectsByKey = new Map<string, LedgerShadowEffect>();

  for (const transactionView of accountingModelResult.value.accountingTransactionViews) {
    const sourceKey = resolveLegacySourceKey(transactionView.processedTransaction);

    for (const inflow of transactionView.inflows) {
      const quantity = inflow.netQuantity ?? inflow.grossQuantity;
      const pushResult = pushOrAccumulateEffect(effectsByKey, {
        sourceKey,
        assetId: inflow.assetId,
        assetSymbol: inflow.assetSymbol,
        quantity,
        role: inflow.role,
      });
      if (pushResult.isErr()) {
        return err(pushResult.error);
      }
    }

    for (const outflow of transactionView.outflows) {
      const quantity = (outflow.netQuantity ?? outflow.grossQuantity).negated();
      const pushResult = pushOrAccumulateEffect(effectsByKey, {
        sourceKey,
        assetId: outflow.assetId,
        assetSymbol: outflow.assetSymbol,
        quantity,
        role: outflow.role,
      });
      if (pushResult.isErr()) {
        return err(pushResult.error);
      }
    }

    for (const fee of transactionView.fees) {
      const pushResult = pushOrAccumulateEffect(effectsByKey, {
        sourceKey,
        assetId: fee.assetId,
        assetSymbol: fee.assetSymbol,
        quantity: fee.quantity.negated(),
        role: 'fee',
        settlement: fee.feeSettlement,
      });
      if (pushResult.isErr()) {
        return err(pushResult.error);
      }
    }
  }

  return ok(sortEffects(effectsByKey.values()));
}

export function buildLedgerDraftShadowEffects(
  drafts: readonly LedgerShadowDraft[]
): Result<LedgerShadowEffect[], Error> {
  const effectsByKey = new Map<string, LedgerShadowEffect>();

  for (const draft of drafts) {
    const sourceKey = resolveLedgerSourceKey(draft.sourceActivity);

    for (const journal of draft.journals) {
      for (const posting of journal.postings) {
        const pushResult = pushOrAccumulateEffect(effectsByKey, {
          sourceKey,
          assetId: posting.assetId,
          assetSymbol: posting.assetSymbol,
          journalKinds: [journal.journalKind],
          quantity: posting.quantity,
          role: posting.role,
          settlement: posting.settlement,
        });
        if (pushResult.isErr()) {
          return err(pushResult.error);
        }
      }
    }
  }

  return ok(sortEffects(effectsByKey.values()));
}

export function reconcileLegacyAccountingToLedgerDrafts(
  transactions: readonly Transaction[],
  drafts: readonly LedgerShadowDraft[],
  logger: Logger
): Result<LedgerShadowReconciliationResult, Error> {
  const legacyEffectsResult = buildLegacyLedgerShadowEffects(transactions, logger);
  if (legacyEffectsResult.isErr()) {
    return err(legacyEffectsResult.error);
  }

  const ledgerEffectsResult = buildLedgerDraftShadowEffects(drafts);
  if (ledgerEffectsResult.isErr()) {
    return err(ledgerEffectsResult.error);
  }

  const legacyEffects = legacyEffectsResult.value;
  const ledgerEffects = ledgerEffectsResult.value;
  const legacyByKey = new Map(legacyEffects.map((effect) => [buildEffectKey(effect), effect] as const));
  const ledgerByKey = new Map(ledgerEffects.map((effect) => [buildEffectKey(effect), effect] as const));
  const allKeys = new Set([...legacyByKey.keys(), ...ledgerByKey.keys()]);
  const diffs: LedgerShadowEffectDiff[] = [];

  for (const key of [...allKeys].sort()) {
    const legacyEffect = legacyByKey.get(key);
    const ledgerEffect = ledgerByKey.get(key);
    const legacyQuantity = legacyEffect?.quantity;
    const ledgerQuantity = ledgerEffect?.quantity;

    if (legacyQuantity && ledgerQuantity && legacyQuantity.eq(ledgerQuantity)) {
      continue;
    }

    const referenceEffect = legacyEffect ?? ledgerEffect;
    if (!referenceEffect) {
      continue;
    }

    diffs.push({
      sourceKey: referenceEffect.sourceKey,
      assetId: referenceEffect.assetId,
      assetSymbol: referenceEffect.assetSymbol,
      role: referenceEffect.role,
      settlement: referenceEffect.settlement,
      legacyQuantity,
      ledgerQuantity,
      delta: (ledgerQuantity ?? new Decimal(0)).minus(legacyQuantity ?? new Decimal(0)),
      ledgerJournalKinds: ledgerEffect?.journalKinds,
    });
  }

  return ok({
    diffs,
    legacyEffects,
    ledgerEffects,
  });
}
