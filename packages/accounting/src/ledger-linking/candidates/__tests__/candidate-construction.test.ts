import { parseCurrency, parseDecimal } from '@exitbook/foundation';
import { assertErr, assertOk } from '@exitbook/foundation/test-utils';
import { describe, expect, it } from 'vitest';

import { buildLedgerTransferLinkingCandidates, type LedgerLinkingPostingInput } from '../candidate-construction.js';

const ETH = assertOk(parseCurrency('ETH'));
const USDC = assertOk(parseCurrency('USDC'));

describe('buildLedgerTransferLinkingCandidates', () => {
  it('builds source and target candidates from liquid principal transfer postings', () => {
    const result = assertOk(
      buildLedgerTransferLinkingCandidates([
        makePosting({
          journalDiagnosticCodes: ['possible_asset_migration'],
          postingFingerprint: 'ledger_posting:v1:source',
          quantity: '-1.25',
        }),
        makePosting({
          postingFingerprint: 'ledger_posting:v1:target',
          quantity: '1.25',
          ownerAccountId: 2,
          platformKey: 'ethereum',
        }),
      ])
    );

    expect(result.skipped).toEqual([]);
    expect(
      result.candidates.map((candidate) => ({
        amount: candidate.amount.toFixed(),
        candidateId: candidate.candidateId,
        direction: candidate.direction,
        journalDiagnosticCodes: candidate.journalDiagnosticCodes,
        ownerAccountId: candidate.ownerAccountId,
        platformKey: candidate.platformKey,
        postingFingerprint: candidate.postingFingerprint,
      }))
    ).toEqual([
      {
        amount: '1.25',
        candidateId: 1,
        direction: 'source',
        journalDiagnosticCodes: ['possible_asset_migration'],
        ownerAccountId: 1,
        platformKey: 'kraken',
        postingFingerprint: 'ledger_posting:v1:source',
      },
      {
        amount: '1.25',
        candidateId: 2,
        direction: 'target',
        journalDiagnosticCodes: [],
        ownerAccountId: 2,
        platformKey: 'ethereum',
        postingFingerprint: 'ledger_posting:v1:target',
      },
    ]);
  });

  it('skips postings outside the first transfer candidate scope', () => {
    const result = assertOk(
      buildLedgerTransferLinkingCandidates([
        makePosting({
          postingFingerprint: 'ledger_posting:v1:trade-principal',
          journalKind: 'trade',
          quantity: '-20',
          assetSymbol: USDC,
          assetId: 'exchange:kraken:USDC',
        }),
        makePosting({
          postingFingerprint: 'ledger_posting:v1:fee',
          role: 'fee',
          quantity: '-0.01',
        }),
        makePosting({
          postingFingerprint: 'ledger_posting:v1:staked',
          balanceCategory: 'staked',
          quantity: '10',
        }),
      ])
    );

    expect(result.candidates).toEqual([]);
    expect(result.skipped).toEqual([
      {
        postingFingerprint: 'ledger_posting:v1:trade-principal',
        reason: 'non_transfer_journal',
      },
      {
        postingFingerprint: 'ledger_posting:v1:fee',
        reason: 'non_principal_role',
      },
      {
        postingFingerprint: 'ledger_posting:v1:staked',
        reason: 'non_liquid_balance_category',
      },
    ]);
  });

  it('rejects zero quantity postings instead of silently skipping them', () => {
    const result = buildLedgerTransferLinkingCandidates([
      makePosting({
        postingFingerprint: 'ledger_posting:v1:zero',
        quantity: '0',
      }),
    ]);

    expect(assertErr(result).message).toContain('has zero quantity');
  });

  function makePosting(
    overrides: Partial<Omit<LedgerLinkingPostingInput, 'quantity'>> & {
      quantity?: string | undefined;
    } = {}
  ): LedgerLinkingPostingInput {
    const { quantity, ...postingOverrides } = overrides;

    return {
      ownerAccountId: 1,
      sourceActivityFingerprint: 'source_activity:v1:test',
      journalFingerprint: 'ledger_journal:v1:test',
      journalKind: 'transfer',
      postingFingerprint: 'ledger_posting:v1:test',
      platformKey: 'kraken',
      platformKind: 'exchange',
      activityDatetime: new Date('2026-04-23T00:00:00.000Z'),
      assetId: 'exchange:kraken:ETH',
      assetSymbol: ETH,
      quantity: parseDecimal(quantity ?? '-1'),
      role: 'principal',
      balanceCategory: 'liquid',
      ...postingOverrides,
    };
  }
});
