import type { Account } from '@exitbook/core';
import { parseDecimal, type Currency } from '@exitbook/foundation';
import { assertErr, assertOk } from '@exitbook/foundation/test-utils';
import { describe, expect, it } from 'vitest';

import type {
  CostBasisLedgerContext,
  CostBasisLedgerJournal,
  CostBasisLedgerPosting,
  CostBasisLedgerRelationship,
  CostBasisLedgerSourceActivity,
} from '../../../../ports/cost-basis-ledger-persistence.js';
import { validateTaxPackageLedgerSourceCoverage } from '../../../export/tax-package-ledger-source-coverage.js';
import { createStandardLedgerWorkflowArtifact } from '../../../filing-facts/__tests__/test-utils.js';
import { collectStandardLedgerTaxPackageSourceCoverage } from '../standard-ledger-tax-package-source-coverage.js';

describe('standard ledger tax package source coverage', () => {
  it('collects and validates ledger-native source refs without transaction ids', () => {
    const coverage = assertOk(collectStandardLedgerTaxPackageSourceCoverage(createStandardLedgerWorkflowArtifact()));

    expect(JSON.stringify(coverage)).not.toContain('transactionId');
    expect(coverage.postingRefs.map((ref) => ref.postingFingerprint)).toEqual(
      expect.arrayContaining(['posting:buy-old', 'posting:buy-new', 'posting:sell', 'posting:carry-target'])
    );
    expect(coverage.relationshipRefs.map((ref) => ref.relationshipStableKey)).toEqual(
      expect.arrayContaining(['relationship:bridge'])
    );
    assertOk(validateTaxPackageLedgerSourceCoverage(createLedgerContext(), coverage));
  });

  it('fails validation when a referenced ledger posting is absent', () => {
    const coverage = assertOk(collectStandardLedgerTaxPackageSourceCoverage(createStandardLedgerWorkflowArtifact()));
    const context = createLedgerContext({
      postings: createLedgerPostings().filter((posting) => posting.postingFingerprint !== 'posting:sell'),
    });

    const error = assertErr(validateTaxPackageLedgerSourceCoverage(context, coverage));

    expect(error.message).toContain('Missing ledger posting posting:sell');
    expect(error.message).toContain('standard ledger disposal standard-ledger-disposal:sell');
  });

  it('fails validation when a referenced ledger relationship is absent', () => {
    const coverage = assertOk(collectStandardLedgerTaxPackageSourceCoverage(createStandardLedgerWorkflowArtifact()));
    const context = createLedgerContext({ relationships: [] });

    const error = assertErr(validateTaxPackageLedgerSourceCoverage(context, coverage));

    expect(error.message).toContain('Missing ledger relationship relationship:bridge');
  });

  it('fails collection when a disposal slice references a missing lot', () => {
    const base = createStandardLedgerWorkflowArtifact();
    const artifact = createStandardLedgerWorkflowArtifact({
      engineResult: {
        ...base.engineResult,
        disposals: [
          {
            ...base.engineResult.disposals[0]!,
            slices: [
              {
                ...base.engineResult.disposals[0]!.slices[0]!,
                lotId: 'standard-ledger-lot:missing',
              },
            ],
          },
        ],
      },
    });

    const error = assertErr(collectStandardLedgerTaxPackageSourceCoverage(artifact));

    expect(error.message).toContain('Missing source lot standard-ledger-lot:missing');
    expect(error.message).toContain('standard ledger disposal standard-ledger-disposal:sell');
  });
});

function createLedgerContext(overrides: Partial<CostBasisLedgerContext> = {}): CostBasisLedgerContext {
  return {
    accounts: overrides.accounts ?? [createAccount(1)],
    sourceActivities: overrides.sourceActivities ?? [
      createSourceActivity('activity:buy-old'),
      createSourceActivity('activity:buy-new'),
      createSourceActivity('activity:sell'),
      createSourceActivity('activity:carry-source'),
      createSourceActivity('activity:carry-target'),
    ],
    journals: overrides.journals ?? [
      createJournal('journal:buy-old', 'activity:buy-old'),
      createJournal('journal:buy-new', 'activity:buy-new'),
      createJournal('journal:sell', 'activity:sell'),
      createJournal('journal:carry-source', 'activity:carry-source'),
      createJournal('journal:carry-target', 'activity:carry-target'),
    ],
    postings: overrides.postings ?? createLedgerPostings(),
    relationships: overrides.relationships ?? [createRelationship('relationship:bridge')],
  };
}

function createAccount(id: number): Account {
  return {
    id,
    profileId: 1,
    accountType: 'exchange-api',
    platformKey: 'kraken',
    identifier: `account:${id}`,
    accountFingerprint: `account:${id}`,
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
  };
}

function createSourceActivity(sourceActivityFingerprint: string): CostBasisLedgerSourceActivity {
  return {
    id: sourceActivityFingerprint.length,
    ownerAccountId: 1,
    sourceActivityOrigin: 'provider_event',
    sourceActivityStableKey: sourceActivityFingerprint,
    sourceActivityFingerprint,
    platformKey: 'kraken',
    platformKind: 'exchange',
    activityStatus: 'success',
    activityDatetime: new Date('2024-01-01T00:00:00.000Z'),
  };
}

function createJournal(journalFingerprint: string, sourceActivityFingerprint: string): CostBasisLedgerJournal {
  return {
    id: journalFingerprint.length,
    sourceActivityId: sourceActivityFingerprint.length,
    sourceActivityFingerprint,
    journalFingerprint,
    journalStableKey: journalFingerprint,
    journalKind: journalFingerprint.includes('carry') ? 'transfer' : 'trade',
    diagnostics: [],
  };
}

function createLedgerPostings(): CostBasisLedgerPosting[] {
  return [
    createPosting('posting:buy-old', 'journal:buy-old', '1'),
    createPosting('posting:buy-new', 'journal:buy-new', '1'),
    createPosting('posting:sell', 'journal:sell', '-1.5'),
    createPosting('posting:carry-source', 'journal:carry-source', '-0.25'),
    createPosting('posting:carry-target', 'journal:carry-target', '0.25'),
  ];
}

function createPosting(
  postingFingerprint: string,
  journalFingerprint: string,
  quantity: string
): CostBasisLedgerPosting {
  return {
    id: postingFingerprint.length,
    journalId: journalFingerprint.length,
    journalFingerprint,
    postingFingerprint,
    postingStableKey: postingFingerprint,
    assetId: postingFingerprint.includes('carry-target') ? 'blockchain:ethereum:0xwbtc' : 'blockchain:bitcoin:native',
    assetSymbol: 'BTC' as Currency,
    quantity: parseDecimal(quantity),
    role: 'principal',
    balanceCategory: 'liquid',
    sourceComponents: [],
  };
}

function createRelationship(relationshipStableKey: string): CostBasisLedgerRelationship {
  return {
    id: 1,
    relationshipOrigin: 'ledger_linking',
    relationshipStableKey,
    relationshipKind: 'bridge',
    recognitionStrategy: 'test',
    recognitionEvidence: {},
    allocations: [],
  };
}
