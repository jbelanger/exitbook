import { parseDecimal, type TokenMetadataRecord } from '@exitbook/core';
import { EventBus } from '@exitbook/events';
import { describe, expect, it } from 'vitest';

import type { IngestionEvent } from '../../../events.js';
import type { MovementWithContext } from '../scam-detection-service.interface.js';
import { ScamDetectionService } from '../scam-detection-service.js';

describe('ScamDetectionService', () => {
  // Create a mock event bus for testing
  // eslint-disable-next-line @typescript-eslint/no-empty-function -- acceptable for mock
  const createMockEventBus = () => new EventBus<IngestionEvent>(() => {});
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
    const service = new ScamDetectionService(createMockEventBus());
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
    const note = result.get(0);
    expect(note).toBeDefined();
    expect(note?.severity).toBe('error');
    expect(note?.type).toBe('SCAM_TOKEN');
    expect(note?.metadata?.detectionSource).toBe('professional');
  });

  it('falls back to symbol detection when metadata is missing', () => {
    const service = new ScamDetectionService(createMockEventBus());
    const movements = [
      createMovement({
        asset: 'ClaimRewards.com',
        contractAddress: '0xdef',
      }),
    ];
    const metadataMap = new Map<string, TokenMetadataRecord | undefined>();

    const result = service.detectScams(movements, metadataMap);

    expect(result.size).toBe(1);
    const note = result.get(0);
    expect(note).toBeDefined();
    expect(note?.severity).toBe('warning');
    expect(note?.type).toBe('SCAM_TOKEN');
    expect(note?.metadata?.detectionSource).toBe('symbol');
  });

  it('uses airdrop context for heuristic detection when metadata is neutral', () => {
    const service = new ScamDetectionService(createMockEventBus());
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
    const note = result.get(0);
    expect(note).toBeDefined();
    expect(note?.severity).toBe('error');
    expect(note?.type).toBe('SCAM_TOKEN');
    expect(note?.metadata?.detectionSource).toBe('heuristic');
  });

  it('records only the first scam per transaction', () => {
    const service = new ScamDetectionService(createMockEventBus());
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
    const note = result.get(0);
    expect(note).toBeDefined();
    expect(note?.metadata?.detectionSource).toBe('professional');
  });
});
