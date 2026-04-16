import { parseDecimal } from '@exitbook/foundation';
import { assertErr, assertOk } from '@exitbook/foundation/test-utils';
import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { buildCostBasisFilingFacts } from '../../filing-facts/filing-facts-builder.js';
import type { StandardCostBasisFilingFacts } from '../../filing-facts/filing-facts-types.js';
import { buildAccountLabeler, countAccountsBySourceName } from '../tax-package-builder-shared.js';
import {
  buildUsAssetLabeler,
  buildUsDispositionRows,
  buildUsLotRows,
  buildUsRowRefMaps,
  buildUsSourceLinkRows,
  buildUsTransferRows,
} from '../us-tax-package-renderers.js';

import { createStandardPackageBuildContext } from './test-utils.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function getStandardFilingFacts(): StandardCostBasisFilingFacts {
  const context = createStandardPackageBuildContext();
  const filingFacts = assertOk(buildCostBasisFilingFacts({ artifact: context.workflowResult }));
  if (filingFacts.kind !== 'standard') {
    throw new Error('Expected standard filing facts');
  }
  return filingFacts;
}

function getContextAndFilingFacts() {
  const context = createStandardPackageBuildContext();
  const filingFacts = assertOk(buildCostBasisFilingFacts({ artifact: context.workflowResult }));
  if (filingFacts.kind !== 'standard') {
    throw new Error('Expected standard filing facts');
  }
  return { context, filingFacts };
}

function getFullRenderParams() {
  const { context, filingFacts } = getContextAndFilingFacts();
  const accountLabeler = buildAccountLabeler(context);
  const assetLabeler = buildUsAssetLabeler(filingFacts);
  const rowRefMaps = assertOk(buildUsRowRefMaps({ context, filingFacts, accountLabeler, assetLabeler }));
  return { context, filingFacts, accountLabeler, assetLabeler, rowRefMaps };
}

// ---------------------------------------------------------------------------
// buildUsAssetLabeler
// ---------------------------------------------------------------------------

describe('buildUsAssetLabeler', () => {
  it('returns just the symbol when there is only one assetId per symbol', () => {
    const filingFacts = getStandardFilingFacts();
    const labeler = buildUsAssetLabeler(filingFacts);

    // All facts in test data use BTC with a single assetId variant
    expect(labeler('BTC', 'exchange:kraken:btc')).toBe('BTC');
  });

  it('returns just the symbol when assetId is undefined', () => {
    const filingFacts = getStandardFilingFacts();
    const labeler = buildUsAssetLabeler(filingFacts);

    expect(labeler('BTC', undefined)).toBe('BTC');
  });

  it('disambiguates when multiple assetIds exist for the same symbol', () => {
    const filingFacts = getStandardFilingFacts();
    // Inject a second acquisition with a different assetId but same symbol
    filingFacts.acquisitions.push({
      ...filingFacts.acquisitions[0]!,
      id: 'lot-extra',
      assetId: 'blockchain:bitcoin:native',
    });

    const labeler = buildUsAssetLabeler(filingFacts);

    expect(labeler('BTC', 'exchange:kraken:btc')).toBe('BTC (exchange:kraken:btc)');
    expect(labeler('BTC', 'blockchain:bitcoin:native')).toBe('BTC (blockchain:bitcoin:native)');
  });

  it('returns just the symbol for assets that are only in dispositions', () => {
    const filingFacts: StandardCostBasisFilingFacts = {
      ...getStandardFilingFacts(),
      acquisitions: [],
      transfers: [],
    };
    const labeler = buildUsAssetLabeler(filingFacts);

    // Dispositions still register their assetId, but only one per symbol
    expect(labeler('BTC', 'exchange:kraken:btc')).toBe('BTC');
  });

  it('returns just the symbol for unknown assetIds not in any fact', () => {
    const filingFacts = getStandardFilingFacts();
    const labeler = buildUsAssetLabeler(filingFacts);

    expect(labeler('ETH', 'exchange:kraken:eth')).toBe('ETH');
  });

  it('handles symbols registered only via transfers', () => {
    const filingFacts: StandardCostBasisFilingFacts = {
      ...getStandardFilingFacts(),
      acquisitions: [],
      dispositions: [],
    };
    const labeler = buildUsAssetLabeler(filingFacts);

    // Transfer data still registers its assetId under BTC
    expect(labeler('BTC', 'exchange:kraken:btc')).toBe('BTC');
  });
});

// ---------------------------------------------------------------------------
// buildUsRowRefMaps
// ---------------------------------------------------------------------------

describe('buildUsRowRefMaps', () => {
  it('assigns sequential LOT refs sorted by date then asset then id', () => {
    const { context, filingFacts } = getContextAndFilingFacts();
    const accountLabeler = buildAccountLabeler(context);
    const assetLabeler = buildUsAssetLabeler(filingFacts);

    const refMaps = assertOk(buildUsRowRefMaps({ context, filingFacts, accountLabeler, assetLabeler }));

    // lot-1 acquired 2023-01-05, lot-2 acquired 2024-06-01 => lot-1 first
    expect(refMaps.lotRefById.get('lot-1')).toBe('LOT-0001');
    expect(refMaps.lotRefById.get('lot-2')).toBe('LOT-0002');
  });

  it('assigns sequential DISP refs sorted by treatment then date', () => {
    const { context, filingFacts } = getContextAndFilingFacts();
    const accountLabeler = buildAccountLabeler(context);
    const assetLabeler = buildUsAssetLabeler(filingFacts);

    const refMaps = assertOk(buildUsRowRefMaps({ context, filingFacts, accountLabeler, assetLabeler }));

    // disp-2 is short_term (rank 0), disp-1 is long_term (rank 1)
    expect(refMaps.dispositionRefById.get('disp-2')).toBe('DISP-0001');
    expect(refMaps.dispositionRefById.get('disp-1')).toBe('DISP-0002');
  });

  it('assigns DISP-GROUP refs that group by transaction+asset', () => {
    const { context, filingFacts } = getContextAndFilingFacts();
    const accountLabeler = buildAccountLabeler(context);
    const assetLabeler = buildUsAssetLabeler(filingFacts);

    const refMaps = assertOk(buildUsRowRefMaps({ context, filingFacts, accountLabeler, assetLabeler }));

    // Both disposals share the same disposal transaction (3) and asset (BTC)
    // so they should belong to the same group
    expect(refMaps.dispositionGroupRefById.size).toBe(1);
    const groupRef = [...refMaps.dispositionGroupRefById.values()][0];
    expect(groupRef).toBe('DISP-GROUP-0001');
  });

  it('assigns sequential XFER refs sorted by date then asset', () => {
    const { context, filingFacts } = getContextAndFilingFacts();
    const accountLabeler = buildAccountLabeler(context);
    const assetLabeler = buildUsAssetLabeler(filingFacts);

    const refMaps = assertOk(buildUsRowRefMaps({ context, filingFacts, accountLabeler, assetLabeler }));

    expect(refMaps.transferRefById.get('transfer-1')).toBe('XFER-0001');
  });

  it('returns an error when a lot references a missing transaction', () => {
    const { context, filingFacts } = getContextAndFilingFacts();
    const accountLabeler = buildAccountLabeler(context);
    const assetLabeler = buildUsAssetLabeler(filingFacts);

    // Sabotage: remove the transaction referenced by lot-1
    context.sourceContext.transactionsById.delete(1);

    const error = assertErr(buildUsRowRefMaps({ context, filingFacts, accountLabeler, assetLabeler }));
    expect(error.message).toContain('Missing source transaction');
  });
});

// ---------------------------------------------------------------------------
// buildUsLotRows
// ---------------------------------------------------------------------------

describe('buildUsLotRows', () => {
  it('produces one row per acquisition lot', () => {
    const { context, filingFacts, accountLabeler, assetLabeler, rowRefMaps } = getFullRenderParams();

    const rows = assertOk(buildUsLotRows({ context, filingFacts, accountLabeler, assetLabeler, rowRefMaps }));

    expect(rows).toHaveLength(2);
  });

  it('sorts lots by acquisition date', () => {
    const { context, filingFacts, accountLabeler, assetLabeler, rowRefMaps } = getFullRenderParams();

    const rows = assertOk(buildUsLotRows({ context, filingFacts, accountLabeler, assetLabeler, rowRefMaps }));

    expect(rows[0]!.lot_ref).toBe('LOT-0001');
    expect(rows[0]!.date_acquired).toBe('2023-01-05');
    expect(rows[1]!.lot_ref).toBe('LOT-0002');
    expect(rows[1]!.date_acquired).toBe('2024-06-01');
  });

  it('renders lot_status correctly for fully_disposed and open lots', () => {
    const { context, filingFacts, accountLabeler, assetLabeler, rowRefMaps } = getFullRenderParams();

    const rows = assertOk(buildUsLotRows({ context, filingFacts, accountLabeler, assetLabeler, rowRefMaps }));

    expect(rows[0]!.lot_status).toBe('fully_disposed');
    expect(rows[1]!.lot_status).toBe('open'); // partially_disposed => open
  });

  it('sets origin_period based on tax year', () => {
    const { context, filingFacts, accountLabeler, assetLabeler, rowRefMaps } = getFullRenderParams();

    const rows = assertOk(buildUsLotRows({ context, filingFacts, accountLabeler, assetLabeler, rowRefMaps }));

    // lot-1 acquired 2023 < taxYear 2024 => prior_year
    expect(rows[0]!.origin_period).toBe('prior_year');
    // lot-2 acquired 2024 == taxYear 2024 => current_year
    expect(rows[1]!.origin_period).toBe('current_year');
  });

  it('formats monetary and quantity fields correctly', () => {
    const { context, filingFacts, accountLabeler, assetLabeler, rowRefMaps } = getFullRenderParams();

    const rows = assertOk(buildUsLotRows({ context, filingFacts, accountLabeler, assetLabeler, rowRefMaps }));

    // lot-1: quantity=1, costBasisPerUnit=10000, totalCostBasis=10000, remainingQuantity=0
    expect(rows[0]!.quantity_acquired).toBe('1');
    expect(rows[0]!.cost_basis_per_unit).toBe('10000');
    expect(rows[0]!.total_cost_basis).toBe('10000.00');
    expect(rows[0]!.remaining_quantity).toBe('0');

    // lot-2: quantity=1, costBasisPerUnit=15000, totalCostBasis=15000, remainingQuantity=0.35
    expect(rows[1]!.quantity_acquired).toBe('1');
    expect(rows[1]!.cost_basis_per_unit).toBe('15000');
    expect(rows[1]!.total_cost_basis).toBe('15000.00');
    expect(rows[1]!.remaining_quantity).toBe('0.35');
  });

  it('includes the tax currency in every row', () => {
    const { context, filingFacts, accountLabeler, assetLabeler, rowRefMaps } = getFullRenderParams();

    const rows = assertOk(buildUsLotRows({ context, filingFacts, accountLabeler, assetLabeler, rowRefMaps }));

    for (const row of rows) {
      expect(row.tax_currency).toBe('USD');
    }
  });

  it('includes account label in each row', () => {
    const { context, filingFacts, accountLabeler, assetLabeler, rowRefMaps } = getFullRenderParams();

    const rows = assertOk(buildUsLotRows({ context, filingFacts, accountLabeler, assetLabeler, rowRefMaps }));

    // Both lots come from accounts with platformKey 'kraken', but there are
    // two kraken accounts (spot-wallet and trading-wallet) so labels are disambiguated
    expect(rows[0]!.account_label).toContain('kraken');
    expect(rows[1]!.account_label).toContain('kraken');
  });

  it('returns an error when a lot ref is missing', () => {
    const { context, filingFacts, accountLabeler, assetLabeler, rowRefMaps } = getFullRenderParams();

    // Remove one lot ref to trigger the error path
    rowRefMaps.lotRefById.delete('lot-1');

    const error = assertErr(buildUsLotRows({ context, filingFacts, accountLabeler, assetLabeler, rowRefMaps }));
    expect(error.message).toContain('Missing lot_ref');
  });

  it('returns an error when a transaction is missing', () => {
    const { context, filingFacts, accountLabeler, assetLabeler, rowRefMaps } = getFullRenderParams();

    // Remove a transaction that lot-1 references
    context.sourceContext.transactionsById.delete(1);

    const error = assertErr(buildUsLotRows({ context, filingFacts, accountLabeler, assetLabeler, rowRefMaps }));
    expect(error.message).toContain('Missing source transaction');
  });
});

// ---------------------------------------------------------------------------
// buildUsDispositionRows
// ---------------------------------------------------------------------------

describe('buildUsDispositionRows', () => {
  it('produces one row per disposition', () => {
    const { context, filingFacts, accountLabeler, assetLabeler, rowRefMaps } = getFullRenderParams();

    const rows = assertOk(buildUsDispositionRows({ context, filingFacts, accountLabeler, assetLabeler, rowRefMaps }));

    expect(rows).toHaveLength(2);
  });

  it('sorts short_term before long_term', () => {
    const { context, filingFacts, accountLabeler, assetLabeler, rowRefMaps } = getFullRenderParams();

    const rows = assertOk(buildUsDispositionRows({ context, filingFacts, accountLabeler, assetLabeler, rowRefMaps }));

    expect(rows[0]!.tax_treatment).toBe('short_term');
    expect(rows[1]!.tax_treatment).toBe('long_term');
  });

  it('renders monetary fields with two decimal places', () => {
    const { context, filingFacts, accountLabeler, assetLabeler, rowRefMaps } = getFullRenderParams();

    const rows = assertOk(buildUsDispositionRows({ context, filingFacts, accountLabeler, assetLabeler, rowRefMaps }));

    // short_term disposal (disp-2): grossProceeds=6000, sellingExpenses=30, netProceeds=5970,
    // costBasis=6000, gainLoss=-30
    const shortTerm = rows[0]!;
    expect(shortTerm.proceeds_gross).toBe('6000.00');
    expect(shortTerm.selling_expenses).toBe('30.00');
    expect(shortTerm.net_proceeds).toBe('5970.00');
    expect(shortTerm.cost_basis).toBe('6000.00');
    expect(shortTerm.gain_loss).toBe('-30.00');
  });

  it('omits selling_expenses when zero', () => {
    const { context, filingFacts, accountLabeler, assetLabeler, rowRefMaps } = getFullRenderParams();

    // Modify a disposal to have zero selling expenses
    const disposal = filingFacts.dispositions.find((d) => d.id === 'disp-2');
    if (disposal) {
      (disposal as { sellingExpenses: Decimal }).sellingExpenses = parseDecimal('0');
    }

    const rows = assertOk(buildUsDispositionRows({ context, filingFacts, accountLabeler, assetLabeler, rowRefMaps }));

    const shortTerm = rows.find((r) => r.disposition_ref === 'DISP-0001');
    expect(shortTerm!.selling_expenses).toBe('');
  });

  it('includes holding_period_days as a string', () => {
    const { context, filingFacts, accountLabeler, assetLabeler, rowRefMaps } = getFullRenderParams();

    const rows = assertOk(buildUsDispositionRows({ context, filingFacts, accountLabeler, assetLabeler, rowRefMaps }));

    // disp-1 has holdingPeriodDays=666, disp-2 has holdingPeriodDays=153
    const longTerm = rows.find((r) => r.tax_treatment === 'long_term')!;
    const shortTerm = rows.find((r) => r.tax_treatment === 'short_term')!;

    expect(longTerm.holding_period_days).toBe('666');
    expect(shortTerm.holding_period_days).toBe('153');
  });

  it('links back to the correct lot ref', () => {
    const { context, filingFacts, accountLabeler, assetLabeler, rowRefMaps } = getFullRenderParams();

    const rows = assertOk(buildUsDispositionRows({ context, filingFacts, accountLabeler, assetLabeler, rowRefMaps }));

    // disp-1 -> lot-1 (LOT-0001), disp-2 -> lot-2 (LOT-0002)
    const longTerm = rows.find((r) => r.tax_treatment === 'long_term')!;
    const shortTerm = rows.find((r) => r.tax_treatment === 'short_term')!;

    expect(longTerm.lot_ref).toBe('LOT-0001');
    expect(shortTerm.lot_ref).toBe('LOT-0002');
  });

  it('includes the acquired date from the lot in the disposition row', () => {
    const { context, filingFacts, accountLabeler, assetLabeler, rowRefMaps } = getFullRenderParams();

    const rows = assertOk(buildUsDispositionRows({ context, filingFacts, accountLabeler, assetLabeler, rowRefMaps }));

    const longTerm = rows.find((r) => r.tax_treatment === 'long_term')!;
    expect(longTerm.date_acquired).toBe('2023-01-05');
    expect(longTerm.date_disposed).toBe('2024-11-01');
  });

  it('assigns disposition group refs for rows sharing the same transaction and asset', () => {
    const { context, filingFacts, accountLabeler, assetLabeler, rowRefMaps } = getFullRenderParams();

    const rows = assertOk(buildUsDispositionRows({ context, filingFacts, accountLabeler, assetLabeler, rowRefMaps }));

    // Both disposals share disposal transaction 3 + BTC => same group
    expect(rows[0]!.disposition_group).toBe(rows[1]!.disposition_group);
  });

  it('returns an error when disposition refs are missing', () => {
    const { context, filingFacts, accountLabeler, assetLabeler, rowRefMaps } = getFullRenderParams();

    rowRefMaps.dispositionRefById.clear();

    const error = assertErr(buildUsDispositionRows({ context, filingFacts, accountLabeler, assetLabeler, rowRefMaps }));
    expect(error.message).toContain('Missing disposition refs');
  });

  it('returns an error for unsupported tax treatment category', () => {
    const { context, filingFacts, accountLabeler, assetLabeler, rowRefMaps } = getFullRenderParams();

    // Set a non-canonical treatment
    (filingFacts.dispositions[0] as { taxTreatmentCategory: string | undefined }).taxTreatmentCategory = undefined;

    const error = assertErr(buildUsDispositionRows({ context, filingFacts, accountLabeler, assetLabeler, rowRefMaps }));
    expect(error.message).toContain('Missing canonical US tax treatment');
  });
});

// ---------------------------------------------------------------------------
// buildUsTransferRows
// ---------------------------------------------------------------------------

describe('buildUsTransferRows', () => {
  it('produces one row per transfer', () => {
    const { context, filingFacts, accountLabeler, assetLabeler, rowRefMaps } = getFullRenderParams();

    const rows = assertOk(buildUsTransferRows({ context, filingFacts, accountLabeler, assetLabeler, rowRefMaps }));

    expect(rows).toHaveLength(1);
  });

  it('renders the transfer date correctly', () => {
    const { context, filingFacts, accountLabeler, assetLabeler, rowRefMaps } = getFullRenderParams();

    const rows = assertOk(buildUsTransferRows({ context, filingFacts, accountLabeler, assetLabeler, rowRefMaps }));

    expect(rows[0]!.date_transferred).toBe('2024-12-15');
  });

  it('sets transfer_direction to internal_transfer', () => {
    const { context, filingFacts, accountLabeler, assetLabeler, rowRefMaps } = getFullRenderParams();

    const rows = assertOk(buildUsTransferRows({ context, filingFacts, accountLabeler, assetLabeler, rowRefMaps }));

    expect(rows[0]!.transfer_direction).toBe('internal_transfer');
  });

  it('sets transfer_status to verified for confirmed-link provenance', () => {
    const { context, filingFacts, accountLabeler, assetLabeler, rowRefMaps } = getFullRenderParams();

    const rows = assertOk(buildUsTransferRows({ context, filingFacts, accountLabeler, assetLabeler, rowRefMaps }));

    expect(rows[0]!.transfer_status).toBe('verified');
  });

  it('sets transfer_status to review_needed_inbound for internal-transfer-carryover provenance', () => {
    const { context, filingFacts, accountLabeler, assetLabeler, rowRefMaps } = getFullRenderParams();

    // Change provenance to internal-transfer-carryover
    const transfer = filingFacts.transfers[0]!;
    (transfer as { provenanceKind: string }).provenanceKind = 'internal-transfer-carryover';

    const rows = assertOk(buildUsTransferRows({ context, filingFacts, accountLabeler, assetLabeler, rowRefMaps }));

    expect(rows[0]!.transfer_status).toBe('review_needed_inbound');
  });

  it('includes fee amount in cost_basis_carried', () => {
    const { context, filingFacts, accountLabeler, assetLabeler, rowRefMaps } = getFullRenderParams();

    const rows = assertOk(buildUsTransferRows({ context, filingFacts, accountLabeler, assetLabeler, rowRefMaps }));

    // Transfer: costBasisPerUnit=15000, quantity=0.25, totalCostBasis=3750, sameAssetFeeAmount=12.50
    // cost_basis_carried = totalCostBasis + sameAssetFeeAmount = 3750 + 12.50 = 3762.50
    expect(rows[0]!.cost_basis_carried).toBe('3762.50');
  });

  it('computes effective cost_basis_per_unit including fees', () => {
    const { context, filingFacts, accountLabeler, assetLabeler, rowRefMaps } = getFullRenderParams();

    const rows = assertOk(buildUsTransferRows({ context, filingFacts, accountLabeler, assetLabeler, rowRefMaps }));

    // effectiveCostBasisPerUnit = costBasisCarried / quantity = 3762.50 / 0.25 = 15050
    expect(rows[0]!.cost_basis_per_unit).toBe('15050');
  });

  it('uses original costBasisPerUnit when quantity is zero', () => {
    const { context, filingFacts, accountLabeler, assetLabeler, rowRefMaps } = getFullRenderParams();

    // Set quantity to zero on the transfer
    const transfer = filingFacts.transfers[0]!;
    (transfer as { quantity: Decimal }).quantity = parseDecimal('0');

    const rows = assertOk(buildUsTransferRows({ context, filingFacts, accountLabeler, assetLabeler, rowRefMaps }));

    // When quantity is zero, should fall back to the raw costBasisPerUnit
    expect(rows[0]!.cost_basis_per_unit).toBe('15000');
  });

  it('sets basis_source to lot_carryover', () => {
    const { context, filingFacts, accountLabeler, assetLabeler, rowRefMaps } = getFullRenderParams();

    const rows = assertOk(buildUsTransferRows({ context, filingFacts, accountLabeler, assetLabeler, rowRefMaps }));

    expect(rows[0]!.basis_source).toBe('lot_carryover');
  });

  it('includes source and target account labels', () => {
    const { context, filingFacts, accountLabeler, assetLabeler, rowRefMaps } = getFullRenderParams();

    const rows = assertOk(buildUsTransferRows({ context, filingFacts, accountLabeler, assetLabeler, rowRefMaps }));

    // Source is kraken (trading-wallet), target is bitcoin blockchain
    expect(rows[0]!.source_account_label).toContain('kraken');
    expect(rows[0]!.target_account_label).toContain('bitcoin');
  });

  it('links back to the source lot ref', () => {
    const { context, filingFacts, accountLabeler, assetLabeler, rowRefMaps } = getFullRenderParams();

    const rows = assertOk(buildUsTransferRows({ context, filingFacts, accountLabeler, assetLabeler, rowRefMaps }));

    // transfer-1 has sourceLotId = lot-2 => LOT-0002
    expect(rows[0]!.source_lot_ref).toBe('LOT-0002');
  });

  it('returns an error when a transfer ref is missing', () => {
    const { context, filingFacts, accountLabeler, assetLabeler, rowRefMaps } = getFullRenderParams();

    rowRefMaps.transferRefById.clear();

    const error = assertErr(buildUsTransferRows({ context, filingFacts, accountLabeler, assetLabeler, rowRefMaps }));
    expect(error.message).toContain('Missing package-local refs');
  });

  it('returns an error when source transaction is missing', () => {
    const { context, filingFacts, accountLabeler, assetLabeler, rowRefMaps } = getFullRenderParams();

    // Transfer source transaction ID is 4
    context.sourceContext.transactionsById.delete(4);

    const error = assertErr(buildUsTransferRows({ context, filingFacts, accountLabeler, assetLabeler, rowRefMaps }));
    expect(error.message).toContain('Missing source transaction');
  });

  it('handles transfer with no sameAssetFeeAmount gracefully', () => {
    const { context, filingFacts, accountLabeler, assetLabeler, rowRefMaps } = getFullRenderParams();

    // Remove fee amount
    const transfer = filingFacts.transfers[0]!;
    (transfer as { sameAssetFeeAmount: Decimal | undefined }).sameAssetFeeAmount = undefined;

    const rows = assertOk(buildUsTransferRows({ context, filingFacts, accountLabeler, assetLabeler, rowRefMaps }));

    // Without fee: cost_basis_carried = totalCostBasis = 3750.00
    expect(rows[0]!.cost_basis_carried).toBe('3750.00');
  });
});

// ---------------------------------------------------------------------------
// buildUsSourceLinkRows
// ---------------------------------------------------------------------------

describe('buildUsSourceLinkRows', () => {
  it('produces source link rows for lots, dispositions, and transfers', () => {
    const { context, filingFacts, rowRefMaps } = getFullRenderParams();
    const sourceNameCounts = countAccountsBySourceName(context);

    const rows = assertOk(buildUsSourceLinkRows({ context, filingFacts, rowRefMaps, sourceNameCounts }));

    // Should have rows covering lots, dispositions, and transfers
    const artifacts = new Set(rows.map((r) => r.package_artifact));
    expect(artifacts.has('lots.csv')).toBe(true);
    expect(artifacts.has('dispositions.csv')).toBe(true);
    expect(artifacts.has('transfers.csv')).toBe(true);
  });

  it('sorts by package_artifact, then package_ref, then tx_fingerprint', () => {
    const { context, filingFacts, rowRefMaps } = getFullRenderParams();
    const sourceNameCounts = countAccountsBySourceName(context);

    const rows = assertOk(buildUsSourceLinkRows({ context, filingFacts, rowRefMaps, sourceNameCounts }));

    // Verify ordering: dispositions.csv < lots.csv < transfers.csv
    const artifactOrder = rows.map((r) => r.package_artifact);
    const dispositionEnd = artifactOrder.lastIndexOf('dispositions.csv');
    const lotsStart = artifactOrder.indexOf('lots.csv');
    const transfersStart = artifactOrder.indexOf('transfers.csv');

    if (dispositionEnd >= 0 && lotsStart >= 0) {
      expect(dispositionEnd).toBeLessThan(lotsStart);
    }
    if (lotsStart >= 0 && transfersStart >= 0) {
      expect(lotsStart).toBeLessThan(transfersStart);
    }
  });

  it('deduplicates rows with the same composite key', () => {
    const { context, filingFacts, rowRefMaps } = getFullRenderParams();
    const sourceNameCounts = countAccountsBySourceName(context);

    const rows = assertOk(buildUsSourceLinkRows({ context, filingFacts, rowRefMaps, sourceNameCounts }));

    // Each row should be unique on (package_ref, package_artifact, source_type, source_venue_label, source_account_label, tx_fingerprint)
    const keys = rows.map((r) =>
      [
        r.package_ref,
        r.package_artifact,
        r.source_type,
        r.source_venue_label,
        r.source_account_label,
        r.tx_fingerprint,
      ].join('|')
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('includes tx_fingerprint for each linked transaction', () => {
    const { context, filingFacts, rowRefMaps } = getFullRenderParams();
    const sourceNameCounts = countAccountsBySourceName(context);

    const rows = assertOk(buildUsSourceLinkRows({ context, filingFacts, rowRefMaps, sourceNameCounts }));

    for (const row of rows) {
      expect(row.tx_fingerprint).toBeTruthy();
      expect(typeof row.tx_fingerprint).toBe('string');
    }
  });

  it('skips lots with missing refs without erroring', () => {
    const { context, filingFacts, rowRefMaps } = getFullRenderParams();
    const sourceNameCounts = countAccountsBySourceName(context);

    // Remove one lot ref — should skip it rather than error
    rowRefMaps.lotRefById.delete('lot-1');

    const rows = assertOk(buildUsSourceLinkRows({ context, filingFacts, rowRefMaps, sourceNameCounts }));

    const lotRows = rows.filter((r) => r.package_artifact === 'lots.csv');
    // Should only have rows for lot-2 now
    expect(lotRows.every((r) => r.package_ref === 'LOT-0002')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Sorting behavior (integration via buildUsDispositionRows)
// ---------------------------------------------------------------------------

describe('disposition sorting', () => {
  it('sorts by disposal date within the same tax treatment', () => {
    const { context, filingFacts, accountLabeler, assetLabeler, rowRefMaps } = getFullRenderParams();

    // Make both disposals short_term but with different disposal dates
    const disp1 = filingFacts.dispositions.find((d) => d.id === 'disp-1')!;
    const disp2 = filingFacts.dispositions.find((d) => d.id === 'disp-2')!;
    (disp1 as { taxTreatmentCategory: string }).taxTreatmentCategory = 'short_term';
    (disp2 as { taxTreatmentCategory: string }).taxTreatmentCategory = 'short_term';
    (disp1 as { disposedAt: Date }).disposedAt = new Date('2024-12-01T00:00:00.000Z');
    (disp2 as { disposedAt: Date }).disposedAt = new Date('2024-10-01T00:00:00.000Z');

    const rows = assertOk(buildUsDispositionRows({ context, filingFacts, accountLabeler, assetLabeler, rowRefMaps }));

    // disp-2 disposed earlier => should come first
    expect(rows[0]!.date_disposed).toBe('2024-10-01');
    expect(rows[1]!.date_disposed).toBe('2024-12-01');
  });
});

// ---------------------------------------------------------------------------
// Full round-trip: buildUsRowRefMaps + buildUsLotRows
// ---------------------------------------------------------------------------

describe('round-trip ref consistency', () => {
  it('lot row refs match the refs from buildUsRowRefMaps', () => {
    const { context, filingFacts, accountLabeler, assetLabeler, rowRefMaps } = getFullRenderParams();

    const lotRows = assertOk(buildUsLotRows({ context, filingFacts, accountLabeler, assetLabeler, rowRefMaps }));

    const lotRefsFromRows = lotRows.map((r) => r.lot_ref);
    const lotRefsFromMaps = [...rowRefMaps.lotRefById.values()].sort();

    expect(lotRefsFromRows.sort()).toEqual(lotRefsFromMaps);
  });

  it('disposition row refs match the refs from buildUsRowRefMaps', () => {
    const { context, filingFacts, accountLabeler, assetLabeler, rowRefMaps } = getFullRenderParams();

    const dispRows = assertOk(
      buildUsDispositionRows({ context, filingFacts, accountLabeler, assetLabeler, rowRefMaps })
    );

    const dispRefsFromRows = dispRows.map((r) => r.disposition_ref);
    const dispRefsFromMaps = [...rowRefMaps.dispositionRefById.values()].sort();

    expect(dispRefsFromRows.sort()).toEqual(dispRefsFromMaps);
  });

  it('transfer row refs match the refs from buildUsRowRefMaps', () => {
    const { context, filingFacts, accountLabeler, assetLabeler, rowRefMaps } = getFullRenderParams();

    const transferRows = assertOk(
      buildUsTransferRows({ context, filingFacts, accountLabeler, assetLabeler, rowRefMaps })
    );

    const xferRefsFromRows = transferRows.map((r) => r.transfer_ref);
    const xferRefsFromMaps = [...rowRefMaps.transferRefById.values()].sort();

    expect(xferRefsFromRows.sort()).toEqual(xferRefsFromMaps);
  });
});
