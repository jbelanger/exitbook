import { parseCurrency, parseDecimal } from '@exitbook/foundation';
import { assertOk } from '@exitbook/foundation/test-utils';
import type { AccountingJournalDraft, SourceActivityDraft } from '@exitbook/ledger';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DataSession } from '../../data-session.js';
import type { KyselyDB } from '../../database.js';
import { seedAccount, seedProfile } from '../../repositories/__tests__/helpers.js';
import { createTestDatabase } from '../../utils/test-utils.js';
import { buildCostBasisLedgerPorts } from '../cost-basis-ledger-ports.js';

const ACTIVITY_FINGERPRINT = 'source_activity:v1:cost-basis-port';
const ACTIVITY_DATETIME = '2026-05-01T00:00:00.000Z';
const ADA = assertOk(parseCurrency('ADA'));

describe('buildCostBasisLedgerPorts', () => {
  let db: KyselyDB;
  let session: DataSession;

  beforeEach(async () => {
    db = await createTestDatabase();
    session = new DataSession(db);

    await seedProfile(db);
    await seedAccount(db, 1, 'blockchain', 'cardano');
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('loads profile accounts with ledger-native cost-basis facts', async () => {
    assertOk(
      await session.accountingLedger.replaceForSourceActivity({
        sourceActivity: makeSourceActivity(),
        journals: [makeJournal()],
      })
    );

    const context = assertOk(await buildCostBasisLedgerPorts(session, 1).loadCostBasisLedgerContext());

    expect(context.accounts.map((account) => account.id)).toEqual([1]);
    expect(context.sourceActivities.map((activity) => activity.sourceActivityFingerprint)).toEqual([
      ACTIVITY_FINGERPRINT,
    ]);
    expect(context.journals.map((journal) => journal.journalKind)).toEqual(['transfer']);
    expect(context.postings.map((posting) => posting.postingFingerprint)).toHaveLength(1);
    expect(context.relationships).toEqual([]);
  });
});

function makeSourceActivity(): SourceActivityDraft {
  return {
    ownerAccountId: 1,
    sourceActivityOrigin: 'provider_event',
    sourceActivityStableKey: 'cost-basis-port',
    sourceActivityFingerprint: ACTIVITY_FINGERPRINT,
    platformKey: 'cardano',
    platformKind: 'blockchain',
    activityStatus: 'success',
    activityDatetime: ACTIVITY_DATETIME,
  };
}

function makeJournal(): AccountingJournalDraft {
  return {
    sourceActivityFingerprint: ACTIVITY_FINGERPRINT,
    journalStableKey: 'journal:transfer',
    journalKind: 'transfer',
    postings: [
      {
        postingStableKey: 'posting:principal',
        assetId: 'blockchain:cardano:native',
        assetSymbol: ADA,
        quantity: parseDecimal('1'),
        role: 'principal',
        balanceCategory: 'liquid',
        sourceComponentRefs: [
          {
            component: {
              sourceActivityFingerprint: ACTIVITY_FINGERPRINT,
              componentKind: 'account_delta',
              componentId: 'delta:0',
              assetId: 'blockchain:cardano:native',
            },
            quantity: parseDecimal('1'),
          },
        ],
      },
    ],
  };
}
