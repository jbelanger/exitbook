import { parseDecimal } from '@exitbook/core';
import { assertErr, assertOk } from '@exitbook/core/test-utils';
import { describe, expect, it } from 'vitest';

import {
  createCanadaAcquisitionEvent,
  createCanadaDispositionEvent,
  createCanadaFeeAdjustmentEvent,
  createCanadaInputContext,
  createCanadaTransferInEvent,
  createCanadaTransferOutEvent,
} from '../../__tests__/test-utils.js';
import { runCanadaAcbEngine } from '../canada-acb-engine.js';

describe('runCanadaAcbEngine', () => {
  it('pools acquisitions and disposes using pooled ACB in CAD', () => {
    const context = createCanadaInputContext({
      inputEvents: [
        createCanadaAcquisitionEvent({
          eventId: 'tx:1:acquisition',
          transactionId: 1,
          timestamp: '2024-01-01T00:00:00Z',
          assetId: 'exchange:kraken:btc',
          assetSymbol: 'BTC',
          quantity: '1',
          unitValueCad: '10000',
          costBasisAdjustmentCad: '100',
        }),
        createCanadaAcquisitionEvent({
          eventId: 'tx:2:acquisition',
          transactionId: 2,
          timestamp: '2024-02-01T00:00:00Z',
          assetId: 'exchange:coinbase:btc',
          assetSymbol: 'BTC',
          quantity: '1',
          unitValueCad: '15000',
        }),
        createCanadaDispositionEvent({
          eventId: 'tx:3:disposition',
          transactionId: 3,
          timestamp: '2024-03-01T00:00:00Z',
          assetId: 'exchange:coinbase:btc',
          assetSymbol: 'BTC',
          quantity: '1',
          unitValueCad: '18000',
          proceedsReductionCad: '50',
        }),
      ],
    });

    const result = runCanadaAcbEngine(context);
    const value = assertOk(result);

    expect(value.dispositions).toHaveLength(1);
    expect(value.dispositions[0]?.costBasisCad.toFixed()).toBe('12550');
    expect(value.dispositions[0]?.proceedsCad.toFixed()).toBe('17950');
    expect(value.dispositions[0]?.gainLossCad.toFixed()).toBe('5400');
    expect(value.dispositions[0]?.layerDepletions).toHaveLength(2);
    expect(value.dispositions[0]?.layerDepletions[0]?.quantityDisposed.toFixed()).toBe('0.5');
    expect(value.dispositions[0]?.layerDepletions[1]?.quantityDisposed.toFixed()).toBe('0.5');

    expect(value.pools).toHaveLength(1);
    expect(value.pools[0]?.quantityHeld.toFixed()).toBe('1');
    expect(value.pools[0]?.totalAcbCad.toFixed()).toBe('12550');
    expect(value.pools[0]?.acbPerUnitCad.toFixed()).toBe('12550');
    expect(value.pools[0]?.acquisitionLayers.map((layer) => layer.remainingQuantity.toFixed())).toEqual(['0.5', '0.5']);
    expect(value.pools[0]?.acquisitionLayers.map((layer) => layer.remainingAllocatedAcbCad.toFixed())).toEqual([
      '6275',
      '6275',
    ]);
    expect(
      value.pools[0]?.acquisitionLayers
        .reduce((sum, layer) => sum.plus(layer.remainingAllocatedAcbCad), parseDecimal('0'))
        .toFixed()
    ).toBe('12550');
  });

  it('fails closed when disposal exceeds holdings', () => {
    const context = createCanadaInputContext({
      inputEvents: [
        createCanadaAcquisitionEvent({
          eventId: 'tx:1:acquisition',
          transactionId: 1,
          timestamp: '2024-01-01T00:00:00Z',
          assetId: 'exchange:kraken:btc',
          assetSymbol: 'BTC',
          quantity: '1',
          unitValueCad: '10000',
        }),
        createCanadaDispositionEvent({
          eventId: 'tx:2:disposition',
          transactionId: 2,
          timestamp: '2024-01-02T00:00:00Z',
          assetId: 'exchange:kraken:btc',
          assetSymbol: 'BTC',
          quantity: '2',
          unitValueCad: '15000',
        }),
      ],
    });

    const result = runCanadaAcbEngine(context);
    const error = assertErr(result);

    expect(error.message).toContain('Insufficient holdings');
  });

  it('ignores transfer events and preserves the pooled ACB state', () => {
    const context = createCanadaInputContext({
      validatedTransferLinkIds: [10],
      inputEvents: [
        createCanadaAcquisitionEvent({
          eventId: 'tx:1:acquisition',
          transactionId: 1,
          timestamp: '2024-01-01T00:00:00Z',
          assetId: 'exchange:kraken:btc',
          assetSymbol: 'BTC',
          quantity: '1',
          unitValueCad: '10000',
        }),
        createCanadaTransferOutEvent({
          eventId: 'link:10:transfer-out',
          transactionId: 2,
          timestamp: '2024-01-10T00:00:00Z',
          assetId: 'exchange:kraken:btc',
          assetSymbol: 'BTC',
          quantity: '1',
          unitValueCad: '12000',
          provenanceKind: 'validated-link',
          linkId: 10,
        }),
        createCanadaTransferInEvent({
          eventId: 'link:10:transfer-in',
          transactionId: 3,
          timestamp: '2024-01-10T00:05:00Z',
          assetId: 'blockchain:bitcoin:native',
          assetSymbol: 'BTC',
          quantity: '1',
          unitValueCad: '12000',
          provenanceKind: 'validated-link',
          linkId: 10,
        }),
      ],
    });

    const result = runCanadaAcbEngine(context);
    const value = assertOk(result);

    expect(value.dispositions).toHaveLength(0);
    expect(value.pools).toHaveLength(1);
    expect(value.pools[0]?.quantityHeld.toFixed()).toBe('1');
    expect(value.pools[0]?.totalAcbCad.toFixed()).toBe('10000');
    expect(value.pools[0]?.acbPerUnitCad.toFixed()).toBe('10000');
  });

  it('adds transfer target fiat fees to the existing pool ACB', () => {
    const context = createCanadaInputContext({
      inputEvents: [
        createCanadaAcquisitionEvent({
          eventId: 'tx:1:acquisition',
          transactionId: 1,
          timestamp: '2024-01-01T00:00:00Z',
          assetId: 'exchange:kraken:btc',
          assetSymbol: 'BTC',
          quantity: '1',
          unitValueCad: '10000',
        }),
        createCanadaFeeAdjustmentEvent({
          eventId: 'link:10:fee-adjustment:add-to-pool-cost:0',
          transactionId: 2,
          timestamp: '2024-01-10T00:05:00Z',
          assetId: 'blockchain:bitcoin:native',
          assetSymbol: 'BTC',
          adjustmentType: 'add-to-pool-cost',
          totalValueCad: '25',
          feeAssetId: 'fiat:cad',
          feeAssetSymbol: 'CAD',
          feeQuantity: '25',
          relatedEventId: 'link:10:transfer-in',
          provenanceKind: 'validated-link',
        }),
      ],
    });

    const result = runCanadaAcbEngine(context);
    const value = assertOk(result);

    expect(value.dispositions).toHaveLength(0);
    expect(value.pools[0]?.quantityHeld.toFixed()).toBe('1');
    expect(value.pools[0]?.totalAcbCad.toFixed()).toBe('10025');
    expect(value.pools[0]?.acbPerUnitCad.toFixed()).toBe('10025');
  });

  it('applies same-asset transfer fees by reducing quantity and re-basing the remaining pool', () => {
    const context = createCanadaInputContext({
      inputEvents: [
        createCanadaAcquisitionEvent({
          eventId: 'tx:1:acquisition',
          transactionId: 1,
          timestamp: '2024-01-01T00:00:00Z',
          assetId: 'exchange:kraken:btc',
          assetSymbol: 'BTC',
          quantity: '1',
          unitValueCad: '10000',
        }),
        createCanadaFeeAdjustmentEvent({
          eventId: 'tx:2:same-asset-transfer-fee',
          transactionId: 2,
          timestamp: '2024-01-10T00:00:00Z',
          assetId: 'exchange:kraken:btc',
          assetSymbol: 'BTC',
          adjustmentType: 'same-asset-transfer-fee-add-to-basis',
          totalValueCad: '100',
          feeAssetId: 'exchange:kraken:btc',
          feeAssetIdentityKey: 'btc',
          feeAssetSymbol: 'BTC',
          feeQuantity: '0.01',
          quantityReduced: '0.01',
          provenanceKind: 'validated-link',
        }),
      ],
    });

    const result = runCanadaAcbEngine(context);
    const value = assertOk(result);

    expect(value.dispositions).toHaveLength(0);
    expect(value.pools[0]?.quantityHeld.toFixed()).toBe('0.99');
    expect(value.pools[0]?.totalAcbCad.toFixed()).toBe('10000');
    expect(value.pools[0]?.acbPerUnitCad.eq(parseDecimal('10000').dividedBy(parseDecimal('0.99')))).toBe(true);
  });
});
