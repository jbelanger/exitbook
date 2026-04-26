/* eslint-disable unicorn/no-null -- raw SQLite inserts need explicit nulls */
import { parseCurrency, parseDecimal } from '@exitbook/foundation';
import { assertErr, assertOk } from '@exitbook/foundation/test-utils';
import type {
  AccountingJournalDraft,
  AccountingPostingDraft,
  AccountingPostingRole,
  SourceActivityDraft,
} from '@exitbook/ledger';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DataSession } from '../../data-session.js';
import type { KyselyDB } from '../../database.js';
import { createTestDatabase } from '../../utils/test-utils.js';
import { AccountingLedgerRepository } from '../accounting-ledger-repository.js';

import { seedAccount, seedProfile } from './helpers.js';

const ACCOUNT_ID = 1;
const ACTIVITY_FINGERPRINT = 'source_activity:v1:test-activity';
const ACTIVITY_DATETIME = '2026-04-23T00:00:00.000Z';
const CARDANO_ASSET_ID = 'blockchain:cardano:native';
const ADA = assertOk(parseCurrency('ADA'));

describe('AccountingLedgerRepository', () => {
  let db: KyselyDB;
  let repository: AccountingLedgerRepository;

  beforeEach(async () => {
    db = await createTestDatabase();
    repository = new AccountingLedgerRepository(db);

    await seedProfile(db);
    await seedAccount(db, ACCOUNT_ID, 'blockchain', 'cardano');
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('persists a source activity ledger and reads postings by account', async () => {
    await seedRawTransaction(1);
    await seedRawTransaction(2);

    const sourceActivity = makeSourceActivity();
    const transferJournal = makeJournal({
      diagnostics: [
        {
          code: 'token_approval',
          message: 'Token approval transaction. Ledger impact is network fee only.',
          metadata: {
            detectionSource: 'method_id',
            methodId: '0x095ea7b3',
          },
          severity: 'info',
        },
      ],
      postings: [
        makePosting({
          postingStableKey: 'posting:principal:out',
          quantity: '-10',
          componentKind: 'utxo_input',
          componentId: 'input:0',
        }),
        makePosting({
          postingStableKey: 'posting:fee',
          quantity: '-0.2',
          role: 'fee',
          settlement: 'on-chain',
          componentKind: 'network_fee',
          componentId: 'fee:0',
        }),
      ],
    });

    const summary = assertOk(
      await repository.replaceForSourceActivity({
        sourceActivity,
        journals: [transferJournal],
        rawTransactionIds: [2, 1, 1],
      })
    );

    expect(typeof summary.sourceActivityId).toBe('number');
    expect(summary.journalCount).toBe(1);
    expect(summary.diagnosticCount).toBe(1);
    expect(summary.postingCount).toBe(2);
    expect(summary.sourceComponentCount).toBe(2);
    expect(summary.rawAssignmentCount).toBe(2);

    await expectCounts({
      sourceActivities: 1,
      rawAssignments: 2,
      diagnostics: 1,
      journals: 1,
      postings: 2,
      sourceComponents: 2,
      relationships: 0,
    });

    const diagnostic = await db
      .selectFrom('accounting_journal_diagnostics')
      .select(['diagnostic_order', 'diagnostic_code', 'diagnostic_message', 'severity', 'metadata_json'])
      .executeTakeFirstOrThrow();
    expect(diagnostic).toEqual({
      diagnostic_order: 1,
      diagnostic_code: 'token_approval',
      diagnostic_message: 'Token approval transaction. Ledger impact is network fee only.',
      severity: 'info',
      metadata_json: '{"detectionSource":"method_id","methodId":"0x095ea7b3"}',
    });

    const postings = assertOk(await repository.findPostingsByOwnerAccountId(ACCOUNT_ID));
    expect(postings).toHaveLength(2);
    expect(postings.map((posting) => posting.postingStableKey)).toEqual(['posting:fee', 'posting:principal:out']);
    expect(postings[0]?.quantity.toFixed()).toBe('-0.2');
    expect(postings[0]?.role).toBe('fee');
    expect(postings[0]?.balanceCategory).toBe('liquid');
    expect(postings[0]?.settlement).toBe('on-chain');
    expect(postings[1]?.quantity.toFixed()).toBe('-10');
    expect(postings[1]?.journalKind).toBe('transfer');
  });

  it('assigns one wallet-scope source activity to multiple child-address raw rows', async () => {
    await seedAccount(db, 2, 'blockchain', 'cardano', { parentAccountId: ACCOUNT_ID });
    await seedAccount(db, 3, 'blockchain', 'cardano', { parentAccountId: ACCOUNT_ID });
    await seedRawTransaction(21, { accountId: 2, blockchainTransactionHash: 'txhash-wallet-scope' });
    await seedRawTransaction(22, { accountId: 3, blockchainTransactionHash: 'txhash-wallet-scope' });

    const summary = assertOk(
      await repository.replaceForSourceActivity({
        sourceActivity: makeSourceActivity({
          blockchainTransactionHash: 'txhash-wallet-scope',
        }),
        journals: [makeJournal()],
        rawTransactionIds: [22, 21],
      })
    );

    expect(summary.rawAssignmentCount).toBe(2);

    const assignments = await db
      .selectFrom('raw_transaction_source_activity_assignments')
      .innerJoin(
        'source_activities',
        'source_activities.id',
        'raw_transaction_source_activity_assignments.source_activity_id'
      )
      .innerJoin(
        'raw_transactions',
        'raw_transactions.id',
        'raw_transaction_source_activity_assignments.raw_transaction_id'
      )
      .select([
        'source_activities.owner_account_id as source_activity_owner_account_id',
        'raw_transactions.account_id as raw_account_id',
        'raw_transactions.blockchain_transaction_hash as raw_hash',
        'raw_transaction_source_activity_assignments.raw_transaction_id as raw_transaction_id',
      ])
      .orderBy('raw_transaction_source_activity_assignments.raw_transaction_id', 'asc')
      .execute();

    expect(assignments).toEqual([
      {
        source_activity_owner_account_id: ACCOUNT_ID,
        raw_account_id: 2,
        raw_hash: 'txhash-wallet-scope',
        raw_transaction_id: 21,
      },
      {
        source_activity_owner_account_id: ACCOUNT_ID,
        raw_account_id: 3,
        raw_hash: 'txhash-wallet-scope',
        raw_transaction_id: 22,
      },
    ]);
  });

  it('allows source activity raw assignments from descendant account scopes', async () => {
    await seedAccount(db, 2, 'blockchain', 'cardano', { parentAccountId: ACCOUNT_ID });
    await seedAccount(db, 4, 'blockchain', 'cardano', { parentAccountId: 2 });
    await seedRawTransaction(41, { accountId: 4, blockchainTransactionHash: 'txhash-descendant-scope' });

    const summary = assertOk(
      await repository.replaceForSourceActivity({
        sourceActivity: makeSourceActivity({
          blockchainTransactionHash: 'txhash-descendant-scope',
        }),
        journals: [makeJournal()],
        rawTransactionIds: [41],
      })
    );

    expect(summary.rawAssignmentCount).toBe(1);
  });

  it('rejects raw assignments outside the source activity account scope', async () => {
    await seedAccount(db, 2, 'blockchain', 'cardano');
    await seedRawTransaction(21, { accountId: 2, blockchainTransactionHash: 'txhash-other-wallet' });

    const result = await repository.replaceForSourceActivity({
      sourceActivity: makeSourceActivity(),
      journals: [makeJournal()],
      rawTransactionIds: [21],
    });

    expect(assertErr(result).message).toContain('cannot assign raw transaction ids outside that account scope: 21');
    await expectCounts({
      sourceActivities: 0,
      rawAssignments: 0,
      diagnostics: 0,
      journals: 0,
      postings: 0,
      sourceComponents: 0,
      relationships: 0,
    });
  });

  it('rejects raw assignments for missing raw transaction rows', async () => {
    const result = await repository.replaceForSourceActivity({
      sourceActivity: makeSourceActivity(),
      journals: [makeJournal()],
      rawTransactionIds: [404],
    });

    expect(assertErr(result).message).toContain('references missing raw transaction ids: 404');
    await expectCounts({
      sourceActivities: 0,
      rawAssignments: 0,
      diagnostics: 0,
      journals: 0,
      postings: 0,
      sourceComponents: 0,
      relationships: 0,
    });
  });

  it('rejects raw assignments already assigned to another source activity', async () => {
    await seedRawTransaction(21);

    assertOk(
      await repository.replaceForSourceActivity({
        sourceActivity: makeSourceActivity(),
        journals: [makeJournal()],
        rawTransactionIds: [21],
      })
    );

    const result = await repository.replaceForSourceActivity({
      sourceActivity: makeSourceActivity({
        sourceActivityFingerprint: 'source_activity:v1:test-activity-2',
        blockchainTransactionHash: 'txhash-ledger-2',
      }),
      journals: [
        makeJournal({
          sourceActivityFingerprint: 'source_activity:v1:test-activity-2',
          postings: [
            makePosting({
              sourceActivityFingerprint: 'source_activity:v1:test-activity-2',
              postingStableKey: 'posting:other',
              quantity: '1',
              componentKind: 'utxo_output',
              componentId: 'output:other',
            }),
          ],
        }),
      ],
      rawTransactionIds: [21],
    });

    expect(assertErr(result).message).toContain('already assigned to another source activity');
    await expectCounts({
      sourceActivities: 1,
      rawAssignments: 1,
      diagnostics: 0,
      journals: 1,
      postings: 1,
      sourceComponents: 1,
      relationships: 0,
    });
  });

  it('reads ledger postings across an account scope', async () => {
    await seedAccount(db, 2, 'blockchain', 'cardano');

    const firstSourceActivity = makeSourceActivity();
    const secondSourceActivity = makeSourceActivity({
      ownerAccountId: 2,
      sourceActivityFingerprint: 'source_activity:v1:test-activity-2',
      blockchainTransactionHash: 'txhash-ledger-2',
    });

    assertOk(
      await repository.replaceForSourceActivity({
        sourceActivity: firstSourceActivity,
        journals: [
          makeJournal({
            postings: [
              makePosting({
                postingStableKey: 'posting:account-1',
                quantity: '-3',
                componentKind: 'utxo_input',
                componentId: 'input:account-1',
              }),
            ],
          }),
        ],
      })
    );
    assertOk(
      await repository.replaceForSourceActivity({
        sourceActivity: secondSourceActivity,
        journals: [
          makeJournal({
            sourceActivityFingerprint: secondSourceActivity.sourceActivityFingerprint,
            postings: [
              makePosting({
                sourceActivityFingerprint: secondSourceActivity.sourceActivityFingerprint,
                postingStableKey: 'posting:account-2',
                quantity: '5',
                componentKind: 'utxo_output',
                componentId: 'output:account-2',
              }),
            ],
          }),
        ],
      })
    );

    const postings = assertOk(await repository.findPostingsByOwnerAccountIds([2, 1, 1]));

    expect(
      postings.map((posting) => ({
        ownerAccountId: posting.ownerAccountId,
        postingStableKey: posting.postingStableKey,
        quantity: posting.quantity.toFixed(),
      }))
    ).toEqual([
      { ownerAccountId: 1, postingStableKey: 'posting:account-1', quantity: '-3' },
      { ownerAccountId: 2, postingStableKey: 'posting:account-2', quantity: '5' },
    ]);
  });

  it('rejects invalid account ids when reading ledger postings', async () => {
    const result = await repository.findPostingsByOwnerAccountIds([0]);

    expect(assertErr(result).message).toContain('Owner account id must be a positive integer');
  });

  it('replaces an existing source activity ledger atomically', async () => {
    await seedRawTransaction(1);
    await seedRawTransaction(2);

    const sourceActivity = makeSourceActivity();
    const firstSummary = assertOk(
      await repository.replaceForSourceActivity({
        sourceActivity,
        journals: [
          makeJournal({
            postings: [
              makePosting({
                postingStableKey: 'posting:first',
                quantity: '-10',
                componentKind: 'utxo_input',
                componentId: 'input:first',
              }),
            ],
          }),
        ],
        rawTransactionIds: [1],
      })
    );

    const secondSummary = assertOk(
      await repository.replaceForSourceActivity({
        sourceActivity: makeSourceActivity({
          fromAddress: 'addr_test1updated',
        }),
        journals: [
          makeJournal({
            journalStableKey: 'journal:replacement',
            journalKind: 'expense_only',
            postings: [
              makePosting({
                postingStableKey: 'posting:replacement-fee',
                quantity: '-0.5',
                role: 'fee',
                settlement: 'on-chain',
                componentKind: 'network_fee',
                componentId: 'fee:replacement',
              }),
            ],
          }),
        ],
        rawTransactionIds: [2],
      })
    );

    expect(secondSummary.sourceActivityId).toBe(firstSummary.sourceActivityId);
    await expectCounts({
      sourceActivities: 1,
      rawAssignments: 1,
      diagnostics: 0,
      journals: 1,
      postings: 1,
      sourceComponents: 1,
      relationships: 0,
    });

    const activity = await db
      .selectFrom('source_activities')
      .select(['from_address', 'updated_at'])
      .where('id', '=', secondSummary.sourceActivityId)
      .executeTakeFirstOrThrow();
    expect(activity.from_address).toBe('addr_test1updated');
    expect(activity.updated_at).not.toBeNull();

    const postings = assertOk(await repository.findPostingsByOwnerAccountId(ACCOUNT_ID));
    expect(postings.map((posting) => posting.postingStableKey)).toEqual(['posting:replacement-fee']);
  });

  it('persists journal relationships with posting endpoints', async () => {
    const sourceActivity = makeSourceActivity();
    const sourceJournal = makeJournal({
      journalStableKey: 'journal:source',
      postings: [
        makePosting({
          postingStableKey: 'posting:source',
          quantity: '-10',
          componentKind: 'utxo_input',
          componentId: 'input:source',
        }),
      ],
      relationships: [
        {
          relationshipStableKey: 'relationship:internal-transfer',
          relationshipKind: 'internal_transfer',
          source: {
            sourceActivityFingerprint: ACTIVITY_FINGERPRINT,
            journalStableKey: 'journal:source',
            postingStableKey: 'posting:source',
          },
          target: {
            sourceActivityFingerprint: ACTIVITY_FINGERPRINT,
            journalStableKey: 'journal:target',
            postingStableKey: 'posting:target',
          },
        },
      ],
    });
    const targetJournal = makeJournal({
      journalStableKey: 'journal:target',
      journalKind: 'internal_transfer',
      postings: [
        makePosting({
          postingStableKey: 'posting:target',
          quantity: '10',
          componentKind: 'utxo_output',
          componentId: 'output:target',
        }),
      ],
    });

    assertOk(
      await repository.replaceForSourceActivity({
        sourceActivity,
        journals: [sourceJournal, targetJournal],
      })
    );

    const relationship = await db
      .selectFrom('accounting_journal_relationships')
      .innerJoin(
        'accounting_journals as source_journal',
        'source_journal.id',
        'accounting_journal_relationships.source_journal_id'
      )
      .innerJoin(
        'accounting_journals as target_journal',
        'target_journal.id',
        'accounting_journal_relationships.target_journal_id'
      )
      .innerJoin(
        'accounting_postings as source_posting',
        'source_posting.id',
        'accounting_journal_relationships.source_posting_id'
      )
      .innerJoin(
        'accounting_postings as target_posting',
        'target_posting.id',
        'accounting_journal_relationships.target_posting_id'
      )
      .select([
        'accounting_journal_relationships.relationship_kind as relationship_kind',
        'source_journal.journal_stable_key as source_journal_stable_key',
        'target_journal.journal_stable_key as target_journal_stable_key',
        'source_posting.posting_stable_key as source_posting_stable_key',
        'target_posting.posting_stable_key as target_posting_stable_key',
      ])
      .executeTakeFirstOrThrow();

    expect(relationship).toEqual({
      relationship_kind: 'internal_transfer',
      source_journal_stable_key: 'journal:source',
      target_journal_stable_key: 'journal:target',
      source_posting_stable_key: 'posting:source',
      target_posting_stable_key: 'posting:target',
    });
  });

  it('participates in an outer DataSession transaction', async () => {
    const session = new DataSession(db);

    const summary = assertOk(
      await session.executeInTransaction((tx) =>
        tx.accountingLedger.replaceForSourceActivity({
          sourceActivity: makeSourceActivity(),
          journals: [makeJournal()],
        })
      )
    );

    expect(summary.journalCount).toBe(1);
    await expectCounts({
      sourceActivities: 1,
      rawAssignments: 0,
      diagnostics: 0,
      journals: 1,
      postings: 1,
      sourceComponents: 1,
      relationships: 0,
    });
  });

  it('rejects drafts whose journals point at another source activity', async () => {
    const result = await repository.replaceForSourceActivity({
      sourceActivity: makeSourceActivity(),
      journals: [
        makeJournal({
          sourceActivityFingerprint: 'source_activity:v1:other',
        }),
      ],
    });

    expect(assertErr(result).message).toContain('belongs to source_activity:v1:other');
    await expectCounts({
      sourceActivities: 0,
      rawAssignments: 0,
      diagnostics: 0,
      journals: 0,
      postings: 0,
      sourceComponents: 0,
      relationships: 0,
    });
  });

  async function seedRawTransaction(
    rawTransactionId: number,
    options: {
      accountId?: number | undefined;
      blockchainTransactionHash?: string | undefined;
      sourceAddress?: string | undefined;
    } = {}
  ): Promise<void> {
    const accountId = options.accountId ?? ACCOUNT_ID;
    await db
      .insertInto('raw_transactions')
      .values({
        id: rawTransactionId,
        account_id: accountId,
        provider_name: 'cardano-provider',
        event_id: `raw:${rawTransactionId}`,
        blockchain_transaction_hash: options.blockchainTransactionHash ?? `txhash-${rawTransactionId}`,
        timestamp: 1_713_830_400_000 + rawTransactionId,
        source_address: options.sourceAddress ?? `addr_test1source${accountId}`,
        transaction_type_hint: 'transfer',
        provider_data: '{}',
        normalized_data: '{}',
        processing_status: 'pending',
        processed_at: null,
        created_at: ACTIVITY_DATETIME,
      })
      .execute();
  }

  function makeSourceActivity(overrides: Partial<SourceActivityDraft> = {}): SourceActivityDraft {
    return {
      ownerAccountId: ACCOUNT_ID,
      sourceActivityOrigin: 'provider_event',
      sourceActivityFingerprint: ACTIVITY_FINGERPRINT,
      platformKey: 'cardano',
      platformKind: 'blockchain',
      activityStatus: 'success',
      activityDatetime: ACTIVITY_DATETIME,
      activityTimestampMs: 1_713_830_400_000,
      fromAddress: 'addr_test1source',
      toAddress: 'addr_test1target',
      blockchainName: 'cardano',
      blockchainBlockHeight: 123,
      blockchainTransactionHash: 'txhash-ledger',
      blockchainIsConfirmed: true,
      ...overrides,
    };
  }

  function makeJournal(
    overrides: Partial<AccountingJournalDraft> & {
      postings?: AccountingPostingDraft[] | undefined;
    } = {}
  ): AccountingJournalDraft {
    const { postings: overridePostings, ...journalOverrides } = overrides;
    const postings = overridePostings ?? [
      makePosting({
        postingStableKey: 'posting:principal',
        quantity: '-10',
        componentKind: 'utxo_input',
        componentId: 'input:default',
      }),
    ];

    return {
      sourceActivityFingerprint: ACTIVITY_FINGERPRINT,
      journalStableKey: 'journal:transfer',
      journalKind: 'transfer',
      postings,
      ...journalOverrides,
    };
  }

  function makePosting(params: {
    balanceCategory?: AccountingPostingDraft['balanceCategory'] | undefined;
    componentId: string;
    componentKind: AccountingPostingDraft['sourceComponentRefs'][number]['component']['componentKind'];
    postingStableKey: string;
    quantity: string;
    role?: AccountingPostingRole | undefined;
    settlement?: AccountingPostingDraft['settlement'];
    sourceActivityFingerprint?: string | undefined;
  }): AccountingPostingDraft {
    const sourceActivityFingerprint = params.sourceActivityFingerprint ?? ACTIVITY_FINGERPRINT;

    return {
      postingStableKey: params.postingStableKey,
      assetId: CARDANO_ASSET_ID,
      assetSymbol: ADA,
      quantity: parseDecimal(params.quantity),
      role: params.role ?? 'principal',
      balanceCategory: params.balanceCategory ?? 'liquid',
      ...(params.settlement === undefined ? {} : { settlement: params.settlement }),
      sourceComponentRefs: [
        {
          component: {
            sourceActivityFingerprint,
            componentKind: params.componentKind,
            componentId: params.componentId,
            occurrence: 1,
            assetId: CARDANO_ASSET_ID,
          },
          quantity: parseDecimal(params.quantity).abs(),
        },
      ],
    };
  }

  async function expectCounts(expected: {
    diagnostics: number;
    journals: number;
    postings: number;
    rawAssignments: number;
    relationships: number;
    sourceActivities: number;
    sourceComponents: number;
  }): Promise<void> {
    await expect(countRows('source_activities')).resolves.toBe(expected.sourceActivities);
    await expect(countRows('raw_transaction_source_activity_assignments')).resolves.toBe(expected.rawAssignments);
    await expect(countRows('accounting_journals')).resolves.toBe(expected.journals);
    await expect(countRows('accounting_journal_diagnostics')).resolves.toBe(expected.diagnostics);
    await expect(countRows('accounting_postings')).resolves.toBe(expected.postings);
    await expect(countRows('accounting_posting_source_components')).resolves.toBe(expected.sourceComponents);
    await expect(countRows('accounting_journal_relationships')).resolves.toBe(expected.relationships);
  }

  async function countRows(
    table:
      | 'source_activities'
      | 'raw_transaction_source_activity_assignments'
      | 'accounting_journals'
      | 'accounting_journal_diagnostics'
      | 'accounting_postings'
      | 'accounting_posting_source_components'
      | 'accounting_journal_relationships'
  ): Promise<number> {
    const row = await db
      .selectFrom(table)
      .select(({ fn }) => fn.countAll<number>().as('count'))
      .executeTakeFirstOrThrow();

    return Number(row.count);
  }
});
