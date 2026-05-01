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

  it('persists journal relationships with posting allocations', async () => {
    const sourceActivity = makeSourceActivity();
    const [sourceJournal, targetJournal] = makeRelatedJournals();

    assertOk(
      await repository.replaceForSourceActivity({
        sourceActivity,
        journals: [sourceJournal, targetJournal],
      })
    );

    const relationship = await db
      .selectFrom('accounting_journal_relationships')
      .select([
        'accounting_journal_relationships.id as id',
        'accounting_journal_relationships.profile_id as profile_id',
        'accounting_journal_relationships.relationship_origin as relationship_origin',
        'accounting_journal_relationships.relationship_kind as relationship_kind',
        'accounting_journal_relationships.recognition_strategy as recognition_strategy',
        'accounting_journal_relationships.recognition_evidence_json as recognition_evidence_json',
        'accounting_journal_relationships.confidence_score as confidence_score',
      ])
      .executeTakeFirstOrThrow();

    expect(relationship).toEqual({
      id: relationship.id,
      profile_id: 1,
      relationship_origin: 'processor',
      relationship_kind: 'internal_transfer',
      recognition_strategy: 'processor_supplied',
      recognition_evidence_json: '{}',
      confidence_score: null,
    });

    const allocations = await db
      .selectFrom('accounting_journal_relationship_allocations')
      .innerJoin(
        'accounting_journals',
        'accounting_journals.id',
        'accounting_journal_relationship_allocations.journal_id'
      )
      .innerJoin(
        'accounting_postings',
        'accounting_postings.id',
        'accounting_journal_relationship_allocations.posting_id'
      )
      .select([
        'accounting_journal_relationship_allocations.allocation_side as allocation_side',
        'accounting_journal_relationship_allocations.allocation_quantity as allocation_quantity',
        'accounting_journal_relationship_allocations.source_activity_fingerprint as source_activity_fingerprint',
        'accounting_journal_relationship_allocations.journal_fingerprint as journal_fingerprint',
        'accounting_journal_relationship_allocations.posting_fingerprint as posting_fingerprint',
        'accounting_journal_relationship_allocations.asset_id as asset_id',
        'accounting_journal_relationship_allocations.asset_symbol as asset_symbol',
        'accounting_journals.journal_stable_key as journal_stable_key',
        'accounting_postings.posting_stable_key as posting_stable_key',
      ])
      .where('relationship_id', '=', relationship.id)
      .orderBy('allocation_side', 'asc')
      .execute();

    expect(allocations).toHaveLength(2);
    expect(allocations[0]?.journal_fingerprint).toContain('ledger_journal:v1:');
    expect(allocations[0]?.posting_fingerprint).toContain('ledger_posting:v1:');
    expect(allocations).toMatchObject([
      {
        allocation_side: 'source',
        allocation_quantity: '10',
        source_activity_fingerprint: ACTIVITY_FINGERPRINT,
        asset_id: 'blockchain:cardano:native',
        asset_symbol: 'ADA',
        journal_stable_key: 'journal:source',
        posting_stable_key: 'posting:source',
      },
      {
        allocation_side: 'target',
        allocation_quantity: '10',
        source_activity_fingerprint: ACTIVITY_FINGERPRINT,
        asset_id: 'blockchain:cardano:native',
        asset_symbol: 'ADA',
        journal_stable_key: 'journal:target',
        posting_stable_key: 'posting:target',
      },
    ]);
  });

  it('replaces processor-authored relationships when replacing a source activity ledger', async () => {
    const [sourceJournal, targetJournal] = makeRelatedJournals();

    assertOk(
      await repository.replaceForSourceActivity({
        sourceActivity: makeSourceActivity(),
        journals: [sourceJournal, targetJournal],
      })
    );
    await expect(countRows('accounting_journal_relationships')).resolves.toBe(1);

    assertOk(
      await repository.replaceForSourceActivity({
        sourceActivity: makeSourceActivity(),
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
      })
    );

    await expect(countRows('accounting_journal_relationships')).resolves.toBe(0);
  });

  it('keeps ledger-linking relationships durable and refreshes endpoint ids by stable fingerprints', async () => {
    const [sourceJournal, targetJournal] = makeRelatedJournals();

    assertOk(
      await repository.replaceForSourceActivity({
        sourceActivity: makeSourceActivity(),
        journals: [sourceJournal, targetJournal],
      })
    );

    const sourceEndpoint = await loadEndpoint('journal:source', 'posting:source');
    const targetEndpoint = await loadEndpoint('journal:target', 'posting:target');
    await insertLedgerLinkingRelationship(sourceEndpoint, targetEndpoint);

    assertOk(
      await repository.replaceForSourceActivity({
        sourceActivity: makeSourceActivity(),
        journals: makeRelatedJournals(),
      })
    );

    const refreshedAllocations = await loadRelationshipAllocationsByStableKey('relationship:ledger-linking');
    expect(refreshedAllocations).toHaveLength(2);
    expect(refreshedAllocations[0]?.journal_id).not.toBeNull();
    expect(refreshedAllocations[1]?.journal_id).not.toBeNull();
    expect(refreshedAllocations[0]?.posting_id).not.toBeNull();
    expect(refreshedAllocations[1]?.posting_id).not.toBeNull();
    expect(refreshedAllocations[0]?.journal_id).not.toBe(sourceEndpoint.journalId);
    expect(refreshedAllocations[1]?.journal_id).not.toBe(targetEndpoint.journalId);
    expect(refreshedAllocations[0]?.journal_fingerprint).toBe(sourceEndpoint.journalFingerprint);
    expect(refreshedAllocations[1]?.journal_fingerprint).toBe(targetEndpoint.journalFingerprint);
    expect(refreshedAllocations[0]?.posting_fingerprint).toBe(sourceEndpoint.postingFingerprint);
    expect(refreshedAllocations[1]?.posting_fingerprint).toBe(targetEndpoint.postingFingerprint);
  });

  it('leaves ledger-linking endpoints unresolved when replacement fingerprints change', async () => {
    const [sourceJournal, targetJournal] = makeRelatedJournals();

    assertOk(
      await repository.replaceForSourceActivity({
        sourceActivity: makeSourceActivity(),
        journals: [sourceJournal, targetJournal],
      })
    );

    const sourceEndpoint = await loadEndpoint('journal:source', 'posting:source');
    const targetEndpoint = await loadEndpoint('journal:target', 'posting:target');
    await insertLedgerLinkingRelationship(sourceEndpoint, targetEndpoint);

    assertOk(
      await repository.replaceForSourceActivity({
        sourceActivity: makeSourceActivity(),
        journals: [
          makeJournal({
            journalStableKey: 'journal:new-source',
            postings: [
              makePosting({
                postingStableKey: 'posting:new-source',
                quantity: '-10',
                componentKind: 'utxo_input',
                componentId: 'input:new-source',
              }),
            ],
          }),
          makeJournal({
            journalStableKey: 'journal:new-target',
            journalKind: 'internal_transfer',
            postings: [
              makePosting({
                postingStableKey: 'posting:new-target',
                quantity: '10',
                componentKind: 'utxo_output',
                componentId: 'output:new-target',
              }),
            ],
          }),
        ],
      })
    );

    const staleAllocations = await loadRelationshipAllocationsByStableKey('relationship:ledger-linking');
    expect(staleAllocations).toHaveLength(2);
    expect(staleAllocations[0]?.journal_id).toBeNull();
    expect(staleAllocations[1]?.journal_id).toBeNull();
    expect(staleAllocations[0]?.posting_id).toBeNull();
    expect(staleAllocations[1]?.posting_id).toBeNull();
    expect(staleAllocations[0]?.journal_fingerprint).toBe(sourceEndpoint.journalFingerprint);
    expect(staleAllocations[1]?.journal_fingerprint).toBe(targetEndpoint.journalFingerprint);
    expect(staleAllocations[0]?.posting_fingerprint).toBe(sourceEndpoint.postingFingerprint);
    expect(staleAllocations[1]?.posting_fingerprint).toBe(targetEndpoint.postingFingerprint);
  });

  it('reports stale ledger-linking allocation refs replaced during materialization', async () => {
    const [sourceJournal, targetJournal] = makeRelatedJournals();

    assertOk(
      await repository.replaceForSourceActivity({
        sourceActivity: makeSourceActivity(),
        journals: [sourceJournal, targetJournal],
      })
    );

    const staleSourceEndpoint = await loadEndpoint('journal:source', 'posting:source');
    const staleTargetEndpoint = await loadEndpoint('journal:target', 'posting:target');
    await insertLedgerLinkingRelationship(staleSourceEndpoint, staleTargetEndpoint);

    assertOk(
      await repository.replaceForSourceActivity({
        sourceActivity: makeSourceActivity(),
        journals: [
          makeJournal({
            journalStableKey: 'journal:new-source',
            postings: [
              makePosting({
                postingStableKey: 'posting:new-source',
                quantity: '-10',
                componentKind: 'utxo_input',
                componentId: 'input:new-source',
              }),
            ],
          }),
          makeJournal({
            journalStableKey: 'journal:new-target',
            journalKind: 'internal_transfer',
            postings: [
              makePosting({
                postingStableKey: 'posting:new-target',
                quantity: '10',
                componentKind: 'utxo_output',
                componentId: 'output:new-target',
              }),
            ],
          }),
        ],
      })
    );

    const sourceEndpoint = await loadEndpoint('journal:new-source', 'posting:new-source');
    const targetEndpoint = await loadEndpoint('journal:new-target', 'posting:new-target');

    const result = assertOk(
      await repository.replaceLedgerLinkingRelationships(1, [
        makeLedgerLinkingRelationshipDraft(sourceEndpoint, targetEndpoint, 'relationship:ledger-linking:refreshed'),
      ])
    );

    expect(result).toEqual({
      previousCount: 1,
      resolvedAllocationCount: 2,
      savedCount: 1,
      unresolvedAllocationCount: 2,
    });
  });

  it('materializes ledger-linking relationships by stable endpoint fingerprints', async () => {
    const { sourceEndpoint, targetEndpoint } = await seedCrossSourceLedgerEndpoints();

    const result = assertOk(
      await repository.replaceLedgerLinkingRelationships(1, [
        {
          allocations: [
            makeLedgerLinkingAllocationDraft(sourceEndpoint, 'source', '10'),
            makeLedgerLinkingAllocationDraft(targetEndpoint, 'target', '10'),
          ],
          confidenceScore: parseDecimal('1'),
          evidence: { reason: 'test' },
          recognitionStrategy: 'exact_hash_transfer',
          relationshipStableKey: 'relationship:ledger-linking',
          relationshipKind: 'internal_transfer',
        },
      ])
    );

    expect(result).toEqual({
      previousCount: 0,
      resolvedAllocationCount: 2,
      savedCount: 1,
      unresolvedAllocationCount: 0,
    });

    const relationship = await loadRelationshipByStableKey('relationship:ledger-linking');
    expect(relationship).toMatchObject({
      confidence_score: '1',
      recognition_evidence_json: '{"reason":"test"}',
      recognition_strategy: 'exact_hash_transfer',
      relationship_origin: 'ledger_linking',
    });
    await expect(loadRelationshipAllocationsByStableKey('relationship:ledger-linking')).resolves.toMatchObject([
      {
        allocation_side: 'source',
        allocation_quantity: '10',
        journal_id: sourceEndpoint.journalId,
        posting_id: sourceEndpoint.postingId,
        journal_fingerprint: sourceEndpoint.journalFingerprint,
        posting_fingerprint: sourceEndpoint.postingFingerprint,
      },
      {
        allocation_side: 'target',
        allocation_quantity: '10',
        journal_id: targetEndpoint.journalId,
        posting_id: targetEndpoint.postingId,
        journal_fingerprint: targetEndpoint.journalFingerprint,
        posting_fingerprint: targetEndpoint.postingFingerprint,
      },
    ]);
  });

  it('rejects ledger-linking allocations that exceed the current posting quantity', async () => {
    const { sourceEndpoint, targetEndpoint } = await seedCrossSourceLedgerEndpoints();

    const result = await repository.replaceLedgerLinkingRelationships(1, [
      {
        allocations: [
          makeLedgerLinkingAllocationDraft(sourceEndpoint, 'source', '10.00000001'),
          makeLedgerLinkingAllocationDraft(targetEndpoint, 'target', '10'),
        ],
        confidenceScore: parseDecimal('1'),
        evidence: { reason: 'overclaim-test' },
        recognitionStrategy: 'exact_hash_transfer',
        relationshipStableKey: 'relationship:overclaim',
        relationshipKind: 'internal_transfer',
      },
    ]);

    expect(assertErr(result).message).toContain(
      `source allocation ${sourceEndpoint.postingFingerprint} quantity 10.00000001 exceeds posting quantity 10`
    );
    await expect(countLedgerLinkingRows()).resolves.toBe(0);
  });

  it('rejects unknown ledger-linking recognition strategies before inserting rows', async () => {
    const { sourceEndpoint, targetEndpoint } = await seedCrossSourceLedgerEndpoints();

    const result = await repository.replaceLedgerLinkingRelationships(1, [
      {
        allocations: [
          makeLedgerLinkingAllocationDraft(sourceEndpoint, 'source', '10'),
          makeLedgerLinkingAllocationDraft(targetEndpoint, 'target', '10'),
        ],
        confidenceScore: parseDecimal('1'),
        evidence: { reason: 'bad-strategy-test' },
        recognitionStrategy: 'unknown_strategy',
        relationshipStableKey: 'relationship:bad-strategy',
        relationshipKind: 'internal_transfer',
      },
    ]);

    expect(assertErr(result).message).toContain(
      "Unknown ledger-linking relationship recognition strategy 'unknown_strategy'"
    );
    await expect(countLedgerLinkingRows()).resolves.toBe(0);
  });

  it('loads persisted ledger-linking relationships by profile', async () => {
    const { sourceEndpoint, targetEndpoint } = await seedCrossSourceLedgerEndpoints();

    assertOk(
      await repository.replaceLedgerLinkingRelationships(1, [
        makeLedgerLinkingRelationshipDraft(sourceEndpoint, targetEndpoint, 'relationship:ledger-linking'),
      ])
    );

    const relationships = assertOk(await repository.findLedgerLinkingRelationshipsByProfileId(1));

    expect(relationships).toHaveLength(1);
    const relationship = relationships[0]!;
    expect(typeof relationship.id).toBe('number');
    expect(typeof relationship.createdAt).toBe('string');
    expect(relationship).toMatchObject({
      allocations: [
        {
          allocationSide: 'source',
          assetId: 'blockchain:cardano:native',
          assetSymbol: 'ADA',
          quantity: '10',
          sourceActivityFingerprint: sourceEndpoint.sourceActivityFingerprint,
          journalFingerprint: sourceEndpoint.journalFingerprint,
          postingFingerprint: sourceEndpoint.postingFingerprint,
          currentJournalId: sourceEndpoint.journalId,
          currentPostingId: sourceEndpoint.postingId,
        },
        {
          allocationSide: 'target',
          assetId: 'blockchain:cardano:native',
          assetSymbol: 'ADA',
          quantity: '10',
          sourceActivityFingerprint: targetEndpoint.sourceActivityFingerprint,
          journalFingerprint: targetEndpoint.journalFingerprint,
          postingFingerprint: targetEndpoint.postingFingerprint,
          currentJournalId: targetEndpoint.journalId,
          currentPostingId: targetEndpoint.postingId,
        },
      ],
      relationshipStableKey: 'relationship:ledger-linking',
      relationshipKind: 'internal_transfer',
      confidenceScore: '1',
      evidence: {
        reason: 'test',
      },
      recognitionStrategy: 'exact_hash_transfer',
      updatedAt: undefined,
    });
  });

  it('replaces only profile-scoped ledger-linking relationships', async () => {
    const { sourceEndpoint, targetEndpoint } = await seedCrossSourceLedgerEndpoints();

    assertOk(
      await repository.replaceLedgerLinkingRelationships(1, [
        makeLedgerLinkingRelationshipDraft(sourceEndpoint, targetEndpoint, 'relationship:first'),
      ])
    );

    const result = assertOk(await repository.replaceLedgerLinkingRelationships(1, []));

    expect(result).toEqual({
      previousCount: 1,
      resolvedAllocationCount: 0,
      savedCount: 0,
      unresolvedAllocationCount: 0,
    });
    await expect(countLedgerLinkingRows()).resolves.toBe(0);
  });

  it('rolls back ledger-linking replacement when a draft endpoint is missing', async () => {
    const { sourceEndpoint, targetEndpoint } = await seedCrossSourceLedgerEndpoints();

    assertOk(
      await repository.replaceLedgerLinkingRelationships(1, [
        makeLedgerLinkingRelationshipDraft(sourceEndpoint, targetEndpoint, 'relationship:existing'),
      ])
    );

    const result = await repository.replaceLedgerLinkingRelationships(1, [
      {
        allocations: [
          makeLedgerLinkingAllocationDraft(sourceEndpoint, 'source', '10'),
          {
            ...makeLedgerLinkingAllocationDraft(targetEndpoint, 'target', '10'),
            journalFingerprint: 'ledger_journal:v1:missing',
          },
        ],
        confidenceScore: parseDecimal('1'),
        evidence: { reason: 'bad-test' },
        recognitionStrategy: 'exact_hash_transfer',
        relationshipStableKey: 'relationship:bad',
        relationshipKind: 'internal_transfer',
      },
    ]);

    expect(assertErr(result).message).toContain('target allocation journal ledger_journal:v1:missing was not found');
    await expect(countLedgerLinkingRows()).resolves.toBe(1);
    await expect(loadRelationshipAllocationsByStableKey('relationship:existing')).resolves.toMatchObject([
      { journal_fingerprint: sourceEndpoint.journalFingerprint },
      { journal_fingerprint: targetEndpoint.journalFingerprint },
    ]);
  });

  it('loads ledger-linking posting inputs by profile', async () => {
    await seedCrossSourceLedgerEndpoints();

    const postingInputs = assertOk(await repository.findLedgerLinkingPostingInputsByProfileId(1));

    expect(
      postingInputs.map((posting) => ({
        balanceCategory: posting.balanceCategory,
        journalKind: posting.journalKind,
        journalDiagnosticCodes: posting.journalDiagnosticCodes,
        ownerAccountId: posting.ownerAccountId,
        platformKey: posting.platformKey,
        postingFingerprintPrefix: posting.postingFingerprint.slice(0, 'ledger_posting:v1:'.length),
        quantity: posting.quantity.toFixed(),
        role: posting.role,
      }))
    ).toEqual([
      {
        balanceCategory: 'liquid',
        journalKind: 'transfer',
        journalDiagnosticCodes: ['possible_asset_migration'],
        ownerAccountId: 1,
        platformKey: 'cardano',
        postingFingerprintPrefix: 'ledger_posting:v1:',
        quantity: '-10',
        role: 'principal',
      },
      {
        balanceCategory: 'liquid',
        journalKind: 'transfer',
        journalDiagnosticCodes: undefined,
        ownerAccountId: 2,
        platformKey: 'ethereum',
        postingFingerprintPrefix: 'ledger_posting:v1:',
        quantity: '10',
        role: 'principal',
      },
    ]);
  });

  it('rejects invalid profile ids when loading ledger-linking posting inputs', async () => {
    const result = await repository.findLedgerLinkingPostingInputsByProfileId(0);

    expect(assertErr(result).message).toContain('Profile id must be a positive integer');
  });

  it('replaces and loads profile-scoped ledger-linking asset identity assertions', async () => {
    const firstReplacement = assertOk(
      await repository.replaceLedgerLinkingAssetIdentityAssertions(1, [
        {
          assetIdA: 'exchange:kraken:eth',
          assetIdB: 'blockchain:ethereum:native',
          evidenceKind: 'manual',
          relationshipKind: 'internal_transfer',
        },
      ])
    );

    expect(firstReplacement).toEqual({
      previousCount: 0,
      savedCount: 1,
    });
    await expect(countRows('ledger_linking_asset_identity_assertions')).resolves.toBe(1);
    expect(assertOk(await repository.findLedgerLinkingAssetIdentityAssertionsByProfileId(1))).toEqual([
      {
        assetIdA: 'blockchain:ethereum:native',
        assetIdB: 'exchange:kraken:eth',
        evidenceKind: 'manual',
        relationshipKind: 'internal_transfer',
      },
    ]);

    const secondReplacement = assertOk(
      await repository.replaceLedgerLinkingAssetIdentityAssertions(1, [
        {
          assetIdA: 'exchange:coinbase:btc',
          assetIdB: 'blockchain:bitcoin:native',
          evidenceKind: 'seeded',
          relationshipKind: 'internal_transfer',
        },
      ])
    );

    expect(secondReplacement).toEqual({
      previousCount: 1,
      savedCount: 1,
    });
    expect(assertOk(await repository.findLedgerLinkingAssetIdentityAssertionsByProfileId(1))).toEqual([
      {
        assetIdA: 'blockchain:bitcoin:native',
        assetIdB: 'exchange:coinbase:btc',
        evidenceKind: 'seeded',
        relationshipKind: 'internal_transfer',
      },
    ]);
  });

  it('saves one ledger-linking asset identity assertion without replacing the profile set', async () => {
    const created = assertOk(
      await repository.saveLedgerLinkingAssetIdentityAssertion(1, {
        assetIdA: 'exchange:kraken:eth',
        assetIdB: 'blockchain:ethereum:native',
        evidenceKind: 'manual',
        relationshipKind: 'internal_transfer',
      })
    );
    const unchanged = assertOk(
      await repository.saveLedgerLinkingAssetIdentityAssertion(1, {
        assetIdA: 'blockchain:ethereum:native',
        assetIdB: 'exchange:kraken:eth',
        evidenceKind: 'manual',
        relationshipKind: 'internal_transfer',
      })
    );
    const updated = assertOk(
      await repository.saveLedgerLinkingAssetIdentityAssertion(1, {
        assetIdA: 'blockchain:ethereum:native',
        assetIdB: 'exchange:kraken:eth',
        evidenceKind: 'seeded',
        relationshipKind: 'internal_transfer',
      })
    );
    const secondCreated = assertOk(
      await repository.saveLedgerLinkingAssetIdentityAssertion(1, {
        assetIdA: 'exchange:coinbase:btc',
        assetIdB: 'blockchain:bitcoin:native',
        evidenceKind: 'amount_time_observed',
        relationshipKind: 'internal_transfer',
      })
    );

    expect(created.action).toBe('created');
    expect(unchanged.action).toBe('unchanged');
    expect(updated.action).toBe('updated');
    expect(secondCreated.action).toBe('created');
    expect(assertOk(await repository.findLedgerLinkingAssetIdentityAssertionsByProfileId(1))).toEqual([
      {
        assetIdA: 'blockchain:bitcoin:native',
        assetIdB: 'exchange:coinbase:btc',
        evidenceKind: 'amount_time_observed',
        relationshipKind: 'internal_transfer',
      },
      {
        assetIdA: 'blockchain:ethereum:native',
        assetIdB: 'exchange:kraken:eth',
        evidenceKind: 'seeded',
        relationshipKind: 'internal_transfer',
      },
    ]);
  });

  it('rejects duplicate ledger-linking asset identity assertions after canonicalization', async () => {
    const result = await repository.replaceLedgerLinkingAssetIdentityAssertions(1, [
      {
        assetIdA: 'exchange:kraken:eth',
        assetIdB: 'blockchain:ethereum:native',
        evidenceKind: 'manual',
        relationshipKind: 'internal_transfer',
      },
      {
        assetIdA: 'blockchain:ethereum:native',
        assetIdB: 'exchange:kraken:eth',
        evidenceKind: 'manual',
        relationshipKind: 'internal_transfer',
      },
    ]);

    expect(assertErr(result).message).toContain('Duplicate ledger-linking asset identity assertion');
    await expect(countRows('ledger_linking_asset_identity_assertions')).resolves.toBe(0);
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
      sourceActivityStableKey: 'txhash-ledger',
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

  function makeRelatedJournals(): [AccountingJournalDraft, AccountingJournalDraft] {
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
          allocations: [
            {
              allocationSide: 'source',
              quantity: parseDecimal('10'),
              sourceActivityFingerprint: ACTIVITY_FINGERPRINT,
              journalStableKey: 'journal:source',
              postingStableKey: 'posting:source',
            },
            {
              allocationSide: 'target',
              quantity: parseDecimal('10'),
              sourceActivityFingerprint: ACTIVITY_FINGERPRINT,
              journalStableKey: 'journal:target',
              postingStableKey: 'posting:target',
            },
          ],
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

    return [sourceJournal, targetJournal];
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

  async function seedCrossSourceLedgerEndpoints(): Promise<{
    sourceEndpoint: Awaited<ReturnType<typeof loadEndpoint>>;
    targetEndpoint: Awaited<ReturnType<typeof loadEndpoint>>;
  }> {
    const targetActivityFingerprint = 'source_activity:v1:test-activity-2';

    await seedAccount(db, 2, 'blockchain', 'ethereum');
    assertOk(
      await repository.replaceForSourceActivity({
        sourceActivity: makeSourceActivity(),
        journals: [
          makeJournal({
            diagnostics: [
              {
                code: 'possible_asset_migration',
                message: 'Kraken spotfromfutures row may reflect an internal asset migration.',
                severity: 'info',
              },
            ],
            journalStableKey: 'journal:source',
            postings: [
              makePosting({
                postingStableKey: 'posting:source',
                quantity: '-10',
                componentKind: 'utxo_input',
                componentId: 'input:source',
              }),
            ],
          }),
        ],
      })
    );
    assertOk(
      await repository.replaceForSourceActivity({
        sourceActivity: makeSourceActivity({
          ownerAccountId: 2,
          sourceActivityFingerprint: targetActivityFingerprint,
          sourceActivityStableKey: 'txhash-ledger-2',
          platformKey: 'ethereum',
          blockchainName: 'ethereum',
          blockchainTransactionHash: 'txhash-ledger-2',
        }),
        journals: [
          makeJournal({
            sourceActivityFingerprint: targetActivityFingerprint,
            journalStableKey: 'journal:target',
            postings: [
              makePosting({
                sourceActivityFingerprint: targetActivityFingerprint,
                postingStableKey: 'posting:target',
                quantity: '10',
                componentKind: 'account_delta',
                componentId: 'delta:target',
              }),
            ],
          }),
        ],
      })
    );

    return {
      sourceEndpoint: await loadEndpoint('journal:source', 'posting:source'),
      targetEndpoint: await loadEndpoint('journal:target', 'posting:target'),
    };
  }

  async function loadEndpoint(
    journalStableKey: string,
    postingStableKey: string
  ): Promise<{
    journalFingerprint: string;
    journalId: number;
    postingFingerprint: string;
    postingId: number;
    sourceActivityFingerprint: string;
  }> {
    const row = await db
      .selectFrom('accounting_journals')
      .innerJoin('source_activities', 'source_activities.id', 'accounting_journals.source_activity_id')
      .innerJoin('accounting_postings', 'accounting_postings.journal_id', 'accounting_journals.id')
      .select([
        'source_activities.source_activity_fingerprint as source_activity_fingerprint',
        'accounting_journals.id as journal_id',
        'accounting_journals.journal_fingerprint as journal_fingerprint',
        'accounting_postings.id as posting_id',
        'accounting_postings.posting_fingerprint as posting_fingerprint',
      ])
      .where('accounting_journals.journal_stable_key', '=', journalStableKey)
      .where('accounting_postings.posting_stable_key', '=', postingStableKey)
      .executeTakeFirstOrThrow();

    return {
      journalFingerprint: row.journal_fingerprint,
      journalId: row.journal_id,
      postingFingerprint: row.posting_fingerprint,
      postingId: row.posting_id,
      sourceActivityFingerprint: row.source_activity_fingerprint,
    };
  }

  function makeLedgerLinkingRelationshipDraft(
    sourceEndpoint: Awaited<ReturnType<typeof loadEndpoint>>,
    targetEndpoint: Awaited<ReturnType<typeof loadEndpoint>>,
    relationshipStableKey: string
  ) {
    return {
      allocations: [
        makeLedgerLinkingAllocationDraft(sourceEndpoint, 'source', '10'),
        makeLedgerLinkingAllocationDraft(targetEndpoint, 'target', '10'),
      ],
      confidenceScore: parseDecimal('1'),
      evidence: { reason: 'test' },
      recognitionStrategy: 'exact_hash_transfer',
      relationshipStableKey,
      relationshipKind: 'internal_transfer' as const,
    };
  }

  function makeLedgerLinkingAllocationDraft(
    endpoint: Awaited<ReturnType<typeof loadEndpoint>>,
    allocationSide: 'source' | 'target',
    quantity: string
  ) {
    return {
      allocationSide,
      sourceActivityFingerprint: endpoint.sourceActivityFingerprint,
      journalFingerprint: endpoint.journalFingerprint,
      postingFingerprint: endpoint.postingFingerprint,
      quantity: parseDecimal(quantity),
    };
  }

  async function insertLedgerLinkingRelationship(
    sourceEndpoint: Awaited<ReturnType<typeof loadEndpoint>>,
    targetEndpoint: Awaited<ReturnType<typeof loadEndpoint>>
  ): Promise<void> {
    const relationship = await db
      .insertInto('accounting_journal_relationships')
      .values({
        profile_id: 1,
        relationship_origin: 'ledger_linking',
        relationship_stable_key: 'relationship:ledger-linking',
        relationship_kind: 'internal_transfer',
        recognition_strategy: 'exact_hash_transfer',
        recognition_evidence_json: '{"reason":"test"}',
        confidence_score: '1',
        created_at: ACTIVITY_DATETIME,
        updated_at: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    await db
      .insertInto('accounting_journal_relationship_allocations')
      .values([
        {
          relationship_id: relationship.id,
          allocation_side: 'source',
          allocation_quantity: '10',
          source_activity_fingerprint: sourceEndpoint.sourceActivityFingerprint,
          journal_id: sourceEndpoint.journalId,
          posting_id: sourceEndpoint.postingId,
          journal_fingerprint: sourceEndpoint.journalFingerprint,
          posting_fingerprint: sourceEndpoint.postingFingerprint,
          asset_id: CARDANO_ASSET_ID,
          asset_symbol: ADA,
          created_at: ACTIVITY_DATETIME,
          updated_at: null,
        },
        {
          relationship_id: relationship.id,
          allocation_side: 'target',
          allocation_quantity: '10',
          source_activity_fingerprint: targetEndpoint.sourceActivityFingerprint,
          journal_id: targetEndpoint.journalId,
          posting_id: targetEndpoint.postingId,
          journal_fingerprint: targetEndpoint.journalFingerprint,
          posting_fingerprint: targetEndpoint.postingFingerprint,
          asset_id: CARDANO_ASSET_ID,
          asset_symbol: ADA,
          created_at: ACTIVITY_DATETIME,
          updated_at: null,
        },
      ])
      .execute();
  }

  async function loadRelationshipByStableKey(relationshipStableKey: string) {
    return db
      .selectFrom('accounting_journal_relationships')
      .select([
        'id',
        'relationship_origin',
        'relationship_kind',
        'relationship_stable_key',
        'recognition_strategy',
        'recognition_evidence_json',
        'confidence_score',
      ])
      .where('relationship_stable_key', '=', relationshipStableKey)
      .executeTakeFirstOrThrow();
  }

  async function loadRelationshipAllocationsByStableKey(relationshipStableKey: string) {
    return db
      .selectFrom('accounting_journal_relationship_allocations')
      .innerJoin(
        'accounting_journal_relationships',
        'accounting_journal_relationships.id',
        'accounting_journal_relationship_allocations.relationship_id'
      )
      .select([
        'accounting_journal_relationship_allocations.allocation_side as allocation_side',
        'accounting_journal_relationship_allocations.allocation_quantity as allocation_quantity',
        'accounting_journal_relationship_allocations.journal_id as journal_id',
        'accounting_journal_relationship_allocations.posting_id as posting_id',
        'accounting_journal_relationship_allocations.journal_fingerprint as journal_fingerprint',
        'accounting_journal_relationship_allocations.posting_fingerprint as posting_fingerprint',
      ])
      .where('accounting_journal_relationships.relationship_stable_key', '=', relationshipStableKey)
      .orderBy('accounting_journal_relationship_allocations.allocation_side', 'asc')
      .execute();
  }

  async function countLedgerLinkingRows(): Promise<number> {
    const row = await db
      .selectFrom('accounting_journal_relationships')
      .select(({ fn }) => fn.countAll<number>().as('count'))
      .where('relationship_origin', '=', 'ledger_linking')
      .executeTakeFirstOrThrow();

    return Number(row.count);
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
      | 'ledger_linking_asset_identity_assertions'
  ): Promise<number> {
    const row = await db
      .selectFrom(table)
      .select(({ fn }) => fn.countAll<number>().as('count'))
      .executeTakeFirstOrThrow();

    return Number(row.count);
  }
});
