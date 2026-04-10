import type { Transaction } from '@exitbook/core';
import { ok } from '@exitbook/foundation';
import { describe, expect, it, vi } from 'vitest';

import { createConfirmableTransferFixture } from '../../__tests__/test-utils.js';
import { buildLinksBrowsePresentation } from '../links-browse-support.js';

type LinksBrowseDatabase = Parameters<typeof buildLinksBrowsePresentation>[0];

function createLinksBrowseDatabase(transactions: Transaction[] = []): LinksBrowseDatabase {
  const transactionsById = new Map(transactions.map((transaction) => [transaction.id, transaction]));
  const findAll = vi.fn();
  const findById = vi.fn().mockImplementation(async (transactionId: number) => ok(transactionsById.get(transactionId)));

  return {
    transactionLinks: {
      findAll,
    },
    transactions: {
      findById,
    },
  } as unknown as LinksBrowseDatabase;
}

describe('links-browse-support', () => {
  it('builds proposal browse items and resolves proposal selectors', async () => {
    const first = createConfirmableTransferFixture();
    const second = createConfirmableTransferFixture({
      sourceAmount: '2',
      targetAmount: '2',
    });
    second.link.id = 456;
    second.link.sourceTransactionId = 21;
    second.link.targetTransactionId = 22;
    second.link.sourceMovementFingerprint = second.sourceTransaction.movements.outflows![0]!.movementFingerprint;
    second.link.targetMovementFingerprint = second.targetTransaction.movements.inflows![0]!.movementFingerprint;
    second.sourceTransaction.id = 21;
    second.targetTransaction.id = 22;
    second.sourceTransaction.datetime = '2024-01-02T12:00:00Z';
    second.sourceTransaction.timestamp = Date.parse('2024-01-02T12:00:00Z');
    second.targetTransaction.datetime = '2024-01-02T12:30:00Z';
    second.targetTransaction.timestamp = Date.parse('2024-01-02T12:30:00Z');

    const database = createLinksBrowseDatabase([
      first.sourceTransaction,
      first.targetTransaction,
      second.sourceTransaction,
      second.targetTransaction,
    ]);
    (database.transactionLinks.findAll as ReturnType<typeof vi.fn>).mockResolvedValue(ok([second.link, first.link]));

    const listResult = await buildLinksBrowsePresentation(database, 42, {});

    expect(listResult.isOk()).toBe(true);
    if (listResult.isErr()) {
      throw listResult.error;
    }

    expect(listResult.value.mode).toBe('links');
    expect(listResult.value.proposals).toHaveLength(2);
    expect(listResult.value.proposals[0]?.proposal.representativeLink.id).toBe(first.link.id);
    expect(listResult.value.proposals[1]?.proposal.representativeLink.id).toBe(second.link.id);

    const selector = listResult.value.proposals[1]!.proposalRef;
    const detailResult = await buildLinksBrowsePresentation(database, 42, {
      preselectInExplorer: true,
      selector,
    });

    expect(detailResult.isOk()).toBe(true);
    if (detailResult.isErr()) {
      throw detailResult.error;
    }

    expect(detailResult.value.selectedProposal?.proposalRef).toBe(selector);
    expect(detailResult.value.state.selectedIndex).toBe(1);
  });
});
