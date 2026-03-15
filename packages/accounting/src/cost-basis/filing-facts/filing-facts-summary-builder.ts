import { Decimal } from 'decimal.js';

import type {
  CostBasisFilingAcquisitionFact,
  CostBasisFilingAssetSummary,
  CostBasisFilingDispositionFact,
  CostBasisFilingFactAssetIdentity,
  CostBasisFilingFactsSummary,
  CostBasisFilingTaxTreatmentSummary,
  CostBasisFilingTransferFact,
} from './filing-facts-types.js';

interface MutableTaxTreatmentSummary {
  taxTreatmentCategory: string;
  dispositionCount: number;
  totalGainLoss: Decimal;
  totalTaxableGainLoss: Decimal;
}

interface MutableAssetSummary extends CostBasisFilingFactAssetIdentity {
  assetGroupingKey: string;
  acquisitionCount: number;
  dispositionCount: number;
  transferCount: number;
  totalProceeds: Decimal;
  totalCostBasis: Decimal;
  totalGainLoss: Decimal;
  totalTaxableGainLoss: Decimal;
  totalDeniedLoss: Decimal;
  byTaxTreatment: Map<string, MutableTaxTreatmentSummary>;
}

export function buildCostBasisFilingAssetSummaries(input: {
  acquisitions: CostBasisFilingAcquisitionFact[];
  dispositions: CostBasisFilingDispositionFact[];
  transfers: CostBasisFilingTransferFact[];
}): CostBasisFilingAssetSummary[] {
  const assetSummaries = new Map<string, MutableAssetSummary>();

  for (const acquisition of input.acquisitions) {
    const summary = ensureAssetSummary(assetSummaries, acquisition);
    summary.acquisitionCount += 1;
  }

  for (const disposition of input.dispositions) {
    const summary = ensureAssetSummary(assetSummaries, disposition);
    summary.dispositionCount += 1;
    summary.totalProceeds = summary.totalProceeds.plus(disposition.totalProceeds);
    summary.totalCostBasis = summary.totalCostBasis.plus(disposition.totalCostBasis);
    summary.totalGainLoss = summary.totalGainLoss.plus(disposition.gainLoss);
    summary.totalTaxableGainLoss = summary.totalTaxableGainLoss.plus(disposition.taxableGainLoss);
    summary.totalDeniedLoss = summary.totalDeniedLoss.plus(disposition.deniedLossAmount);

    if (disposition.taxTreatmentCategory) {
      const byTaxTreatment = ensureTaxTreatmentSummary(summary.byTaxTreatment, disposition.taxTreatmentCategory);
      byTaxTreatment.dispositionCount += 1;
      byTaxTreatment.totalGainLoss = byTaxTreatment.totalGainLoss.plus(disposition.gainLoss);
      byTaxTreatment.totalTaxableGainLoss = byTaxTreatment.totalTaxableGainLoss.plus(disposition.taxableGainLoss);
    }
  }

  for (const transfer of input.transfers) {
    const summary = ensureAssetSummary(assetSummaries, transfer);
    summary.transferCount += 1;
  }

  return Array.from(assetSummaries.values())
    .sort(compareAssetSummaries)
    .map((summary) => ({
      assetGroupingKey: summary.assetGroupingKey,
      assetSymbol: summary.assetSymbol,
      ...(summary.assetId ? { assetId: summary.assetId } : {}),
      ...(summary.taxPropertyKey ? { taxPropertyKey: summary.taxPropertyKey } : {}),
      acquisitionCount: summary.acquisitionCount,
      dispositionCount: summary.dispositionCount,
      transferCount: summary.transferCount,
      totalProceeds: summary.totalProceeds,
      totalCostBasis: summary.totalCostBasis,
      totalGainLoss: summary.totalGainLoss,
      totalTaxableGainLoss: summary.totalTaxableGainLoss,
      totalDeniedLoss: summary.totalDeniedLoss,
      byTaxTreatment: toSortedTaxTreatmentSummaries(summary.byTaxTreatment),
    }));
}

export function buildCostBasisFilingFactsSummary(input: {
  acquisitions: CostBasisFilingAcquisitionFact[];
  assetSummaries: CostBasisFilingAssetSummary[];
  dispositions: CostBasisFilingDispositionFact[];
  transfers: CostBasisFilingTransferFact[];
}): CostBasisFilingFactsSummary {
  const totalProceeds = sumDecimals(input.assetSummaries.map((item) => item.totalProceeds));
  const totalCostBasis = sumDecimals(input.assetSummaries.map((item) => item.totalCostBasis));
  const totalGainLoss = sumDecimals(input.assetSummaries.map((item) => item.totalGainLoss));
  const totalTaxableGainLoss = sumDecimals(input.assetSummaries.map((item) => item.totalTaxableGainLoss));
  const totalDeniedLoss = sumDecimals(input.assetSummaries.map((item) => item.totalDeniedLoss));
  const byTaxTreatment = new Map<string, MutableTaxTreatmentSummary>();

  for (const summary of input.assetSummaries) {
    for (const taxTreatment of summary.byTaxTreatment) {
      const aggregate = ensureTaxTreatmentSummary(byTaxTreatment, taxTreatment.taxTreatmentCategory);
      aggregate.dispositionCount += taxTreatment.dispositionCount;
      aggregate.totalGainLoss = aggregate.totalGainLoss.plus(taxTreatment.totalGainLoss);
      aggregate.totalTaxableGainLoss = aggregate.totalTaxableGainLoss.plus(taxTreatment.totalTaxableGainLoss);
    }
  }

  return {
    assetCount: input.assetSummaries.length,
    acquisitionCount: input.acquisitions.length,
    dispositionCount: input.dispositions.length,
    transferCount: input.transfers.length,
    totalProceeds,
    totalCostBasis,
    totalGainLoss,
    totalTaxableGainLoss,
    totalDeniedLoss,
    byTaxTreatment: toSortedTaxTreatmentSummaries(byTaxTreatment),
  };
}

function ensureAssetSummary(
  assetSummaries: Map<string, MutableAssetSummary>,
  fact: CostBasisFilingFactAssetIdentity
): MutableAssetSummary {
  const assetGroupingKey = buildAssetGroupingKey(fact);
  const existing = assetSummaries.get(assetGroupingKey);
  if (existing) {
    if (!existing.assetId && fact.assetId) {
      existing.assetId = fact.assetId;
    }
    if (!existing.taxPropertyKey && fact.taxPropertyKey) {
      existing.taxPropertyKey = fact.taxPropertyKey;
    }
    return existing;
  }

  const summary: MutableAssetSummary = {
    assetGroupingKey,
    assetSymbol: fact.assetSymbol,
    assetId: fact.assetId,
    taxPropertyKey: fact.taxPropertyKey,
    acquisitionCount: 0,
    dispositionCount: 0,
    transferCount: 0,
    totalProceeds: new Decimal(0),
    totalCostBasis: new Decimal(0),
    totalGainLoss: new Decimal(0),
    totalTaxableGainLoss: new Decimal(0),
    totalDeniedLoss: new Decimal(0),
    byTaxTreatment: new Map(),
  };
  assetSummaries.set(assetGroupingKey, summary);
  return summary;
}

function buildAssetGroupingKey(fact: CostBasisFilingFactAssetIdentity): string {
  return fact.taxPropertyKey ?? fact.assetId ?? String(fact.assetSymbol);
}

function ensureTaxTreatmentSummary(
  summaries: Map<string, MutableTaxTreatmentSummary>,
  taxTreatmentCategory: string
): MutableTaxTreatmentSummary {
  const existing = summaries.get(taxTreatmentCategory);
  if (existing) {
    return existing;
  }

  const summary: MutableTaxTreatmentSummary = {
    taxTreatmentCategory,
    dispositionCount: 0,
    totalGainLoss: new Decimal(0),
    totalTaxableGainLoss: new Decimal(0),
  };
  summaries.set(taxTreatmentCategory, summary);
  return summary;
}

function toSortedTaxTreatmentSummaries(
  summaries: Map<string, MutableTaxTreatmentSummary>
): CostBasisFilingTaxTreatmentSummary[] {
  return Array.from(summaries.values())
    .sort(compareTaxTreatmentSummaries)
    .map((summary) => ({
      taxTreatmentCategory: summary.taxTreatmentCategory,
      dispositionCount: summary.dispositionCount,
      totalGainLoss: summary.totalGainLoss,
      totalTaxableGainLoss: summary.totalTaxableGainLoss,
    }));
}

function compareAssetSummaries(
  left: MutableAssetSummary | CostBasisFilingAssetSummary,
  right: MutableAssetSummary | CostBasisFilingAssetSummary
): number {
  const symbolDiff = String(left.assetSymbol).localeCompare(String(right.assetSymbol));
  if (symbolDiff !== 0) {
    return symbolDiff;
  }

  return left.assetGroupingKey.localeCompare(right.assetGroupingKey);
}

function compareTaxTreatmentSummaries(left: MutableTaxTreatmentSummary, right: MutableTaxTreatmentSummary): number {
  const rankDiff =
    getTaxTreatmentSortRank(left.taxTreatmentCategory) - getTaxTreatmentSortRank(right.taxTreatmentCategory);
  if (rankDiff !== 0) {
    return rankDiff;
  }

  return left.taxTreatmentCategory.localeCompare(right.taxTreatmentCategory);
}

function getTaxTreatmentSortRank(taxTreatmentCategory: string): number {
  if (taxTreatmentCategory === 'short_term') {
    return 0;
  }
  if (taxTreatmentCategory === 'long_term') {
    return 1;
  }
  return 2;
}

function sumDecimals(values: Decimal[]): Decimal {
  return values.reduce((sum, value) => sum.plus(value), new Decimal(0));
}
