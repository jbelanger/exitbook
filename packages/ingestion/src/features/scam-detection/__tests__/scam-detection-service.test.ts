import { type TokenMetadataRecord } from '@exitbook/blockchain-providers';
import { parseDecimal } from '@exitbook/foundation';
import { describe, expect, it } from 'vitest';

import type { MovementWithContext } from '../contracts.js';
import { ScamDetectionService } from '../scam-detection-service.js';

describe('ScamDetectionService', () => {
  const createMetadata = (overrides?: Partial<TokenMetadataRecord>): TokenMetadataRecord => ({
    blockchain: 'ethereum',
    contractAddress: '0xabc',
    refreshedAt: new Date(),
    source: 'provider-api',
    ...overrides,
  });

  const createMovement = (overrides?: Partial<MovementWithContext>): MovementWithContext => ({
    contractAddress: '0xabc',
    asset: 'TOKEN',
    amount: parseDecimal('1'),
    isAirdrop: false,
    transactionIndex: 0,
    ...overrides,
  });

  it('returns metadata-based note when possibleSpam is true', () => {
    const service = new ScamDetectionService();
    const movements = [createMovement()];
    const metadataMap = new Map<string, TokenMetadataRecord | undefined>([
      [
        '0xabc',
        createMetadata({
          name: 'Scam Token',
          symbol: 'SCAM',
          possibleSpam: true,
        }),
      ],
    ]);

    const result = service.detectScams(movements, metadataMap);

    expect(result.size).toBe(1);
    const note = result.get(0)?.[0];
    expect(note).toBeDefined();
    expect(note?.severity).toBe('error');
    expect(note?.code).toBe('SCAM_TOKEN');
    expect(note?.metadata?.['detectionSource']).toBe('professional');
    expect(note?.metadata?.['assetSymbol']).toBe('TOKEN');
    expect(note?.metadata?.['contractAddress']).toBe('0xabc');
  });

  it('falls back to symbol detection when metadata is missing', () => {
    const service = new ScamDetectionService();
    const movements = [
      createMovement({
        asset: 'ClaimRewards.com',
        contractAddress: '0xdef',
      }),
    ];
    const metadataMap = new Map<string, TokenMetadataRecord | undefined>();

    const result = service.detectScams(movements, metadataMap);

    expect(result.size).toBe(1);
    const note = result.get(0)?.[0];
    expect(note).toBeDefined();
    expect(note?.severity).toBe('warning');
    expect(note?.code).toBe('SCAM_TOKEN');
    expect(note?.metadata?.['detectionSource']).toBe('symbol');
    expect(note?.metadata?.['assetSymbol']).toBe('ClaimRewards.com');
    expect(note?.metadata?.['contractAddress']).toBe('0xdef');
  });

  it('uses airdrop context for heuristic detection when metadata is neutral', () => {
    const service = new ScamDetectionService();
    const movements = [
      createMovement({
        contractAddress: '0xairdrop',
        amount: parseDecimal('10'),
        isAirdrop: true,
      }),
    ];
    const metadataMap = new Map<string, TokenMetadataRecord | undefined>([
      [
        '0xairdrop',
        createMetadata({
          contractAddress: '0xairdrop',
          name: 'Neutral Token',
          symbol: 'NEUTRAL',
          possibleSpam: false,
          verifiedContract: false,
        }),
      ],
    ]);

    const result = service.detectScams(movements, metadataMap);

    expect(result.size).toBe(1);
    const note = result.get(0)?.[0];
    expect(note).toBeDefined();
    expect(note?.severity).toBe('error');
    expect(note?.code).toBe('SCAM_TOKEN');
    expect(note?.metadata?.['detectionSource']).toBe('heuristic');
  });

  it('records every suspicious asset in the same transaction', () => {
    const service = new ScamDetectionService();
    const movements = [
      createMovement({
        transactionIndex: 0,
        contractAddress: '0xfirst',
        asset: 'SCAM',
      }),
      createMovement({
        transactionIndex: 0,
        contractAddress: '0xsecond',
        asset: 'ClaimRewards.com',
      }),
    ];
    const metadataMap = new Map<string, TokenMetadataRecord | undefined>([
      [
        '0xfirst',
        createMetadata({
          contractAddress: '0xfirst',
          symbol: 'SCAM',
          possibleSpam: true,
        }),
      ],
    ]);

    const result = service.detectScams(movements, metadataMap);

    expect(result.size).toBe(1);
    const diagnostics = result.get(0);
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics?.map((diagnostic) => diagnostic.metadata?.['detectionSource'])).toEqual([
      'professional',
      'symbol',
    ]);
  });
});
