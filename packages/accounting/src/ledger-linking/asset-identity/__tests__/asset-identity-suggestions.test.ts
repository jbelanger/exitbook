import { parseCurrency } from '@exitbook/foundation';
import { assertErr, assertOk } from '@exitbook/foundation/test-utils';
import { describe, expect, it } from 'vitest';

import {
  buildLedgerLinkingAssetIdentitySuggestions,
  type LedgerLinkingAssetIdentitySuggestionInput,
} from '../asset-identity-suggestions.js';

const ETH = assertOk(parseCurrency('ETH'));
const USDC = assertOk(parseCurrency('USDC'));

describe('buildLedgerLinkingAssetIdentitySuggestions', () => {
  it('groups exact-hash asset identity blockers into canonical pair suggestions', () => {
    const suggestions = assertOk(
      buildLedgerLinkingAssetIdentitySuggestions(
        [
          makeBlock({
            amount: '1',
            sourceAssetId: 'exchange:kraken:eth',
            sourcePostingFingerprint: 'ledger_posting:v1:b',
            targetAssetId: 'blockchain:ethereum:native',
            targetPostingFingerprint: 'ledger_posting:v1:y',
          }),
          makeBlock({
            amount: '2',
            sourceAssetId: 'blockchain:ethereum:native',
            sourcePostingFingerprint: 'ledger_posting:v1:a',
            targetAssetId: 'exchange:kraken:eth',
            targetPostingFingerprint: 'ledger_posting:v1:x',
          }),
        ],
        {
          maxExamplesPerSuggestion: 1,
        }
      )
    );

    expect(suggestions).toEqual([
      {
        assetIdA: 'blockchain:ethereum:native',
        assetIdB: 'exchange:kraken:eth',
        assetSymbol: ETH,
        blockCount: 2,
        examples: [
          {
            amount: '2',
            sourceBlockchainTransactionHash: '0xsource',
            sourcePostingFingerprint: 'ledger_posting:v1:a',
            targetBlockchainTransactionHash: '0xtarget',
            targetPostingFingerprint: 'ledger_posting:v1:x',
          },
        ],
        relationshipKind: 'internal_transfer',
      },
    ]);
  });

  it('keeps distinct asset pairs separate and sorted by symbol', () => {
    const suggestions = assertOk(
      buildLedgerLinkingAssetIdentitySuggestions([
        makeBlock({
          assetSymbol: USDC,
          sourceAssetId: 'exchange:coinbase:usdc',
          targetAssetId: 'blockchain:arbitrum:0xaf88',
        }),
        makeBlock({
          sourceAssetId: 'exchange:kraken:eth',
          targetAssetId: 'blockchain:ethereum:native',
        }),
      ])
    );

    expect(suggestions.map((suggestion) => suggestion.assetSymbol)).toEqual([ETH, USDC]);
    expect(suggestions.map((suggestion) => [suggestion.assetIdA, suggestion.assetIdB])).toEqual([
      ['blockchain:ethereum:native', 'exchange:kraken:eth'],
      ['blockchain:arbitrum:0xaf88', 'exchange:coinbase:usdc'],
    ]);
  });

  it('rejects malformed inputs instead of producing weak suggestions', () => {
    const result = buildLedgerLinkingAssetIdentitySuggestions([
      makeBlock({
        sourceBlockchainTransactionHash: ' ',
      }),
    ]);

    expect(assertErr(result).message).toBe(
      'Ledger-linking asset identity suggestion input has empty sourceBlockchainTransactionHash'
    );
  });

  it('rejects invalid example limits', () => {
    const result = buildLedgerLinkingAssetIdentitySuggestions([makeBlock()], {
      maxExamplesPerSuggestion: 0,
    });

    expect(assertErr(result).message).toContain('positive integer example limit');
  });

  function makeBlock(
    overrides: Partial<LedgerLinkingAssetIdentitySuggestionInput> = {}
  ): LedgerLinkingAssetIdentitySuggestionInput {
    return {
      amount: '1',
      assetSymbol: ETH,
      sourceAssetId: 'exchange:kraken:eth',
      sourceBlockchainTransactionHash: '0xsource',
      sourcePostingFingerprint: 'ledger_posting:v1:source',
      targetAssetId: 'blockchain:ethereum:native',
      targetBlockchainTransactionHash: '0xtarget',
      targetPostingFingerprint: 'ledger_posting:v1:target',
      ...overrides,
    };
  }
});
