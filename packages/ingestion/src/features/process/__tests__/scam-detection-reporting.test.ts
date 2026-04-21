import type { TokenMetadataRecord } from '@exitbook/blockchain-providers';
import type { TransactionDiagnostic } from '@exitbook/core';
import { describe, expect, it, vi } from 'vitest';

import type { MovementWithContext, ScamDetector } from '../../scam-detection/contracts.js';
import { createScamBatchReportingDetector } from '../scam-detection-reporting.js';

describe('createScamBatchReportingDetector', () => {
  it('emits a scam batch summary after delegating detection', () => {
    const emit = vi.fn();
    const detector: ScamDetector = vi.fn().mockReturnValue(
      new Map<number, TransactionDiagnostic[]>([
        [
          0,
          [
            {
              code: 'SCAM_TOKEN',
              message: 'Suspicious token',
              metadata: { assetSymbol: 'SCAM' },
              severity: 'warning',
            },
          ],
        ],
        [
          1,
          [
            {
              code: 'SCAM_TOKEN',
              message: 'Suspicious token',
              metadata: { assetSymbol: 'FAKE' },
              severity: 'warning',
            },
            {
              code: 'SCAM_TOKEN',
              message: 'Another suspicious token',
              metadata: { assetSymbol: 'SCAM' },
              severity: 'warning',
            },
          ],
        ],
      ])
    );
    const movements: MovementWithContext[] = [
      {
        amount: 1 as never,
        asset: 'SCAM',
        contractAddress: '0xabc',
        isAirdrop: false,
        transactionIndex: 0,
      },
      {
        amount: 1 as never,
        asset: 'FAKE',
        contractAddress: '0xdef',
        isAirdrop: false,
        transactionIndex: 1,
      },
    ];
    const metadataMap = new Map<string, TokenMetadataRecord | undefined>();
    const reportingDetector = createScamBatchReportingDetector({
      blockchain: 'ethereum',
      detector,
      emit,
    });

    const result = reportingDetector(movements, metadataMap);

    expect(result.size).toBe(2);
    expect(detector).toHaveBeenCalledWith(movements, metadataMap);
    expect(emit).toHaveBeenCalledWith({
      batchNumber: 1,
      blockchain: 'ethereum',
      exampleSymbols: ['SCAM', 'FAKE'],
      scamsFound: 3,
      totalScanned: 2,
      type: 'scam.batch.summary',
    });
  });
});
