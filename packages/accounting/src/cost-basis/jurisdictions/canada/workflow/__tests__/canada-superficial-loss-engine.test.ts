import { parseDecimal } from '@exitbook/foundation';
import { assertOk } from '@exitbook/foundation/test-utils';
import { describe, expect, it } from 'vitest';

import {
  createCanadaAcquisitionEvent,
  createCanadaDispositionEvent,
  createCanadaInputContext,
} from '../../__tests__/test-utils.js';
import { runCanadaAcbEngine } from '../canada-acb-engine.js';
import { runCanadaSuperficialLossEngine } from '../canada-superficial-loss-engine.js';
import type { CanadaSuperficialLossEngineResult } from '../canada-superficial-loss-types.js';

function applySuperficialLossAdjustments(
  inputContext: ReturnType<typeof createCanadaInputContext>,
  adjustmentEvents: CanadaSuperficialLossEngineResult['adjustmentEvents']
) {
  return runCanadaAcbEngine({
    ...inputContext,
    inputEvents: [...inputContext.inputEvents, ...adjustmentEvents],
  });
}

describe('runCanadaSuperficialLossEngine', () => {
  it('fully denies a loss and carries it into the substituted property ACB', () => {
    const inputContext = createCanadaInputContext({
      inputEvents: [
        createCanadaAcquisitionEvent({
          eventId: 'tx:1:acquisition',
          transactionId: 1,
          timestamp: '2024-01-01T00:00:00Z',
          assetId: 'exchange:kraken:btc',
          assetSymbol: 'BTC',
          quantity: '1',
          unitValueCad: '100',
        }),
        createCanadaDispositionEvent({
          eventId: 'tx:2:disposition',
          transactionId: 2,
          timestamp: '2024-01-10T00:00:00Z',
          assetId: 'exchange:kraken:btc',
          assetSymbol: 'BTC',
          quantity: '1',
          unitValueCad: '80',
        }),
        createCanadaAcquisitionEvent({
          eventId: 'tx:3:acquisition',
          transactionId: 3,
          timestamp: '2024-01-20T00:00:00Z',
          assetId: 'exchange:kraken:btc',
          assetSymbol: 'BTC',
          quantity: '1',
          unitValueCad: '90',
        }),
        createCanadaDispositionEvent({
          eventId: 'tx:4:disposition',
          transactionId: 4,
          timestamp: '2024-03-01T00:00:00Z',
          assetId: 'exchange:kraken:btc',
          assetSymbol: 'BTC',
          quantity: '1',
          unitValueCad: '120',
        }),
      ],
    });

    const acbEngineResult = assertOk(runCanadaAcbEngine(inputContext));
    const superficialLossResult = assertOk(
      runCanadaSuperficialLossEngine({
        inputContext,
        acbEngineResult,
      })
    );
    const adjustedEngineResult = assertOk(
      applySuperficialLossAdjustments(inputContext, superficialLossResult.adjustmentEvents)
    );

    expect(superficialLossResult.dispositionAdjustments).toEqual([
      {
        dispositionEventId: 'tx:2:disposition',
        deniedQuantity: parseDecimal('1'),
        deniedLossCad: parseDecimal('20'),
      },
    ]);
    expect(superficialLossResult.superficialLossAdjustments).toHaveLength(1);
    expect(superficialLossResult.superficialLossAdjustments[0]?.substitutedPropertyAcquisitionId).toBe(
      'layer:tx:3:acquisition'
    );
    expect(adjustedEngineResult.dispositions[1]?.costBasisCad.toFixed()).toBe('110');
    expect(adjustedEngineResult.dispositions[1]?.gainLossCad.toFixed()).toBe('10');
  });

  it('partially denies a loss when only part of the reacquired quantity remains', () => {
    const inputContext = createCanadaInputContext({
      inputEvents: [
        createCanadaAcquisitionEvent({
          eventId: 'tx:1:acquisition',
          transactionId: 1,
          timestamp: '2024-01-01T00:00:00Z',
          assetId: 'exchange:kraken:btc',
          assetSymbol: 'BTC',
          quantity: '2',
          unitValueCad: '100',
        }),
        createCanadaDispositionEvent({
          eventId: 'tx:2:disposition',
          transactionId: 2,
          timestamp: '2024-01-10T00:00:00Z',
          assetId: 'exchange:kraken:btc',
          assetSymbol: 'BTC',
          quantity: '2',
          unitValueCad: '80',
        }),
        createCanadaAcquisitionEvent({
          eventId: 'tx:3:acquisition',
          transactionId: 3,
          timestamp: '2024-01-20T00:00:00Z',
          assetId: 'exchange:kraken:btc',
          assetSymbol: 'BTC',
          quantity: '1',
          unitValueCad: '90',
        }),
      ],
    });

    const acbEngineResult = assertOk(runCanadaAcbEngine(inputContext));
    const superficialLossResult = assertOk(
      runCanadaSuperficialLossEngine({
        inputContext,
        acbEngineResult,
      })
    );

    expect(superficialLossResult.dispositionAdjustments).toEqual([
      {
        dispositionEventId: 'tx:2:disposition',
        deniedQuantity: parseDecimal('1'),
        deniedLossCad: parseDecimal('20'),
      },
    ]);
    expect(superficialLossResult.adjustmentEvents).toHaveLength(1);
    expect(superficialLossResult.adjustmentEvents[0]?.timestamp.toISOString()).toBe('2024-02-09T23:59:59.999Z');
  });

  it('does not deny the loss when the reacquired quantity is not held at day +30', () => {
    const inputContext = createCanadaInputContext({
      inputEvents: [
        createCanadaAcquisitionEvent({
          eventId: 'tx:1:acquisition',
          transactionId: 1,
          timestamp: '2024-01-01T00:00:00Z',
          assetId: 'exchange:kraken:btc',
          assetSymbol: 'BTC',
          quantity: '1',
          unitValueCad: '100',
        }),
        createCanadaDispositionEvent({
          eventId: 'tx:2:disposition',
          transactionId: 2,
          timestamp: '2024-01-10T00:00:00Z',
          assetId: 'exchange:kraken:btc',
          assetSymbol: 'BTC',
          quantity: '1',
          unitValueCad: '80',
        }),
        createCanadaAcquisitionEvent({
          eventId: 'tx:3:acquisition',
          transactionId: 3,
          timestamp: '2024-01-20T00:00:00Z',
          assetId: 'exchange:kraken:btc',
          assetSymbol: 'BTC',
          quantity: '1',
          unitValueCad: '90',
        }),
        createCanadaDispositionEvent({
          eventId: 'tx:4:disposition',
          transactionId: 4,
          timestamp: '2024-02-01T00:00:00Z',
          assetId: 'exchange:kraken:btc',
          assetSymbol: 'BTC',
          quantity: '1',
          unitValueCad: '95',
        }),
      ],
    });

    const acbEngineResult = assertOk(runCanadaAcbEngine(inputContext));
    const superficialLossResult = assertOk(
      runCanadaSuperficialLossEngine({
        inputContext,
        acbEngineResult,
      })
    );

    expect(superficialLossResult.dispositionAdjustments).toEqual([]);
    expect(superficialLossResult.adjustmentEvents).toEqual([]);
    expect(superficialLossResult.superficialLossAdjustments).toEqual([]);
  });
});
