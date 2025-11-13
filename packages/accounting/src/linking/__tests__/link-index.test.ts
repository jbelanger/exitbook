import { Currency } from '@exitbook/core';
import { parseDecimal } from '@exitbook/core';
import type { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { LinkIndex } from '../link-index.js';
import type { TransactionLink } from '../types.js';

describe('LinkIndex', () => {
  describe('constructor', () => {
    it('should build both maps correctly with single link', () => {
      const links: TransactionLink[] = [
        createLink({
          id: 'link-1',
          sourceTransactionId: 1,
          targetTransactionId: 2,
          asset: Currency.create('BTC'),
          sourceAmount: parseDecimal('1.0'),
          targetAmount: parseDecimal('0.9995'),
        }),
      ];

      const index = new LinkIndex(links);

      const foundBySource = index.findBySource(1, 'BTC', parseDecimal('1.0'));
      const foundByTarget = index.findByTarget(2, 'BTC');

      expect(foundBySource).toBeDefined();
      expect(foundBySource?.id).toBe('link-1');
      expect(foundByTarget).toBeDefined();
      expect(foundByTarget?.id).toBe('link-1');
    });

    it('should build both maps correctly with multiple links', () => {
      const links: TransactionLink[] = [
        createLink({
          id: 'link-1',
          sourceTransactionId: 1,
          targetTransactionId: 2,
          asset: Currency.create('BTC'),
          sourceAmount: parseDecimal('1.0'),
          targetAmount: parseDecimal('0.9995'),
        }),
        createLink({
          id: 'link-2',
          sourceTransactionId: 3,
          targetTransactionId: 4,
          asset: Currency.create('ETH'),
          sourceAmount: parseDecimal('10.0'),
          targetAmount: parseDecimal('9.98'),
        }),
      ];

      const index = new LinkIndex(links);

      const btcLink = index.findBySource(1, 'BTC', parseDecimal('1.0'));
      const ethLink = index.findBySource(3, 'ETH', parseDecimal('10.0'));

      expect(btcLink?.id).toBe('link-1');
      expect(ethLink?.id).toBe('link-2');
    });

    it('should handle empty link array', () => {
      const index = new LinkIndex([]);

      const foundBySource = index.findBySource(1, 'BTC', parseDecimal('1.0'));
      const foundByTarget = index.findByTarget(2, 'BTC');

      expect(foundBySource).toBeUndefined();
      expect(foundByTarget).toBeUndefined();
    });
  });

  describe('findBySource', () => {
    it('should return correct link for matching txId, asset, and amount', () => {
      const links: TransactionLink[] = [
        createLink({
          id: 'link-1',
          sourceTransactionId: 1,
          targetTransactionId: 2,
          asset: Currency.create('BTC'),
          sourceAmount: parseDecimal('1.0'),
          targetAmount: parseDecimal('0.9995'),
        }),
      ];

      const index = new LinkIndex(links);
      const found = index.findBySource(1, 'BTC', parseDecimal('1.0'));

      expect(found).toBeDefined();
      expect(found?.id).toBe('link-1');
      expect(found?.sourceTransactionId).toBe(1);
      expect(found?.asset.toString()).toBe('BTC');
      expect(found?.sourceAmount.toFixed()).toBe('1');
    });

    it('should return undefined when no matching link exists', () => {
      const links: TransactionLink[] = [
        createLink({
          id: 'link-1',
          sourceTransactionId: 1,
          targetTransactionId: 2,
          asset: Currency.create('BTC'),
          sourceAmount: parseDecimal('1.0'),
          targetAmount: parseDecimal('0.9995'),
        }),
      ];

      const index = new LinkIndex(links);
      const found = index.findBySource(999, 'BTC', parseDecimal('1.0'));

      expect(found).toBeUndefined();
    });

    it('should return undefined when asset does not match', () => {
      const links: TransactionLink[] = [
        createLink({
          id: 'link-1',
          sourceTransactionId: 1,
          targetTransactionId: 2,
          asset: Currency.create('BTC'),
          sourceAmount: parseDecimal('1.0'),
          targetAmount: parseDecimal('0.9995'),
        }),
      ];

      const index = new LinkIndex(links);
      const found = index.findBySource(1, 'ETH', parseDecimal('1.0'));

      expect(found).toBeUndefined();
    });

    it('should return undefined when amount does not match', () => {
      const links: TransactionLink[] = [
        createLink({
          id: 'link-1',
          sourceTransactionId: 1,
          targetTransactionId: 2,
          asset: Currency.create('BTC'),
          sourceAmount: parseDecimal('1.0'),
          targetAmount: parseDecimal('0.9995'),
        }),
      ];

      const index = new LinkIndex(links);
      const found = index.findBySource(1, 'BTC', parseDecimal('2.0'));

      expect(found).toBeUndefined();
    });

    it('should return first unconsumed link when multiple links exist for same key', () => {
      const links: TransactionLink[] = [
        createLink({
          id: 'link-1',
          sourceTransactionId: 1,
          targetTransactionId: 2,
          asset: Currency.create('BTC'),
          sourceAmount: parseDecimal('1.0'),
          targetAmount: parseDecimal('0.9995'),
        }),
        createLink({
          id: 'link-2',
          sourceTransactionId: 1,
          targetTransactionId: 3,
          asset: Currency.create('BTC'),
          sourceAmount: parseDecimal('1.0'),
          targetAmount: parseDecimal('0.999'),
        }),
      ];

      const index = new LinkIndex(links);
      const found = index.findBySource(1, 'BTC', parseDecimal('1.0'));

      expect(found?.id).toBe('link-1');
    });

    it('should handle Decimal amount precision', () => {
      const links: TransactionLink[] = [
        createLink({
          id: 'link-1',
          sourceTransactionId: 1,
          targetTransactionId: 2,
          asset: Currency.create('BTC'),
          sourceAmount: parseDecimal('0.00012345'),
          targetAmount: parseDecimal('0.00012300'),
        }),
      ];

      const index = new LinkIndex(links);
      const found = index.findBySource(1, 'BTC', parseDecimal('0.00012345'));

      expect(found).toBeDefined();
      expect(found?.id).toBe('link-1');
    });
  });

  describe('findByTarget', () => {
    it('should return correct link for matching txId and asset', () => {
      const links: TransactionLink[] = [
        createLink({
          id: 'link-1',
          sourceTransactionId: 1,
          targetTransactionId: 2,
          asset: Currency.create('BTC'),
          sourceAmount: parseDecimal('1.0'),
          targetAmount: parseDecimal('0.9995'),
        }),
      ];

      const index = new LinkIndex(links);
      const found = index.findByTarget(2, 'BTC');

      expect(found).toBeDefined();
      expect(found?.id).toBe('link-1');
      expect(found?.targetTransactionId).toBe(2);
      expect(found?.asset.toString()).toBe('BTC');
    });

    it('should return undefined when no matching link exists', () => {
      const links: TransactionLink[] = [
        createLink({
          id: 'link-1',
          sourceTransactionId: 1,
          targetTransactionId: 2,
          asset: Currency.create('BTC'),
          sourceAmount: parseDecimal('1.0'),
          targetAmount: parseDecimal('0.9995'),
        }),
      ];

      const index = new LinkIndex(links);
      const found = index.findByTarget(999, 'BTC');

      expect(found).toBeUndefined();
    });

    it('should return undefined when asset does not match', () => {
      const links: TransactionLink[] = [
        createLink({
          id: 'link-1',
          sourceTransactionId: 1,
          targetTransactionId: 2,
          asset: Currency.create('BTC'),
          sourceAmount: parseDecimal('1.0'),
          targetAmount: parseDecimal('0.9995'),
        }),
      ];

      const index = new LinkIndex(links);
      const found = index.findByTarget(2, 'ETH');

      expect(found).toBeUndefined();
    });

    it('should return first unconsumed link when multiple links exist for same key', () => {
      const links: TransactionLink[] = [
        createLink({
          id: 'link-1',
          sourceTransactionId: 1,
          targetTransactionId: 2,
          asset: Currency.create('BTC'),
          sourceAmount: parseDecimal('1.0'),
          targetAmount: parseDecimal('0.9995'),
        }),
        createLink({
          id: 'link-2',
          sourceTransactionId: 3,
          targetTransactionId: 2,
          asset: Currency.create('BTC'),
          sourceAmount: parseDecimal('1.5'),
          targetAmount: parseDecimal('1.499'),
        }),
      ];

      const index = new LinkIndex(links);
      const found = index.findByTarget(2, 'BTC');

      expect(found?.id).toBe('link-1');
    });
  });

  describe('two-phase consumption', () => {
    it('should remove link from sourceMap when consumeSourceLink is called', () => {
      const link = createLink({
        id: 'link-1',
        sourceTransactionId: 1,
        targetTransactionId: 2,
        asset: Currency.create('BTC'),
        sourceAmount: parseDecimal('1.0'),
        targetAmount: parseDecimal('0.9995'),
      });

      const index = new LinkIndex([link]);

      expect(index.findBySource(1, 'BTC', parseDecimal('1.0'))).toBeDefined();

      index.consumeSourceLink(link);

      expect(index.findBySource(1, 'BTC', parseDecimal('1.0'))).toBeUndefined();
    });

    it('should keep link in targetMap after consumeSourceLink', () => {
      const link = createLink({
        id: 'link-1',
        sourceTransactionId: 1,
        targetTransactionId: 2,
        asset: Currency.create('BTC'),
        sourceAmount: parseDecimal('1.0'),
        targetAmount: parseDecimal('0.9995'),
      });

      const index = new LinkIndex([link]);

      index.consumeSourceLink(link);

      const foundByTarget = index.findByTarget(2, 'BTC');
      expect(foundByTarget).toBeDefined();
      expect(foundByTarget?.id).toBe('link-1');
    });

    it('should remove link from targetMap when consumeTargetLink is called', () => {
      const link = createLink({
        id: 'link-1',
        sourceTransactionId: 1,
        targetTransactionId: 2,
        asset: Currency.create('BTC'),
        sourceAmount: parseDecimal('1.0'),
        targetAmount: parseDecimal('0.9995'),
      });

      const index = new LinkIndex([link]);

      expect(index.findByTarget(2, 'BTC')).toBeDefined();

      index.consumeTargetLink(link);

      expect(index.findByTarget(2, 'BTC')).toBeUndefined();
    });

    it('should remove link from both maps after both consumptions', () => {
      const link = createLink({
        id: 'link-1',
        sourceTransactionId: 1,
        targetTransactionId: 2,
        asset: Currency.create('BTC'),
        sourceAmount: parseDecimal('1.0'),
        targetAmount: parseDecimal('0.9995'),
      });

      const index = new LinkIndex([link]);

      index.consumeSourceLink(link);
      index.consumeTargetLink(link);

      expect(index.findBySource(1, 'BTC', parseDecimal('1.0'))).toBeUndefined();
      expect(index.findByTarget(2, 'BTC')).toBeUndefined();
    });

    it('should handle consumeSourceLink when link is not in index', () => {
      const link = createLink({
        id: 'link-1',
        sourceTransactionId: 1,
        targetTransactionId: 2,
        asset: Currency.create('BTC'),
        sourceAmount: parseDecimal('1.0'),
        targetAmount: parseDecimal('0.9995'),
      });

      const index = new LinkIndex([]);

      expect(() => index.consumeSourceLink(link)).not.toThrow();
    });

    it('should handle consumeTargetLink when link is not in index', () => {
      const link = createLink({
        id: 'link-1',
        sourceTransactionId: 1,
        targetTransactionId: 2,
        asset: Currency.create('BTC'),
        sourceAmount: parseDecimal('1.0'),
        targetAmount: parseDecimal('0.9995'),
      });

      const index = new LinkIndex([]);

      expect(() => index.consumeTargetLink(link)).not.toThrow();
    });

    it('should allow consuming same link multiple times without error', () => {
      const link = createLink({
        id: 'link-1',
        sourceTransactionId: 1,
        targetTransactionId: 2,
        asset: Currency.create('BTC'),
        sourceAmount: parseDecimal('1.0'),
        targetAmount: parseDecimal('0.9995'),
      });

      const index = new LinkIndex([link]);

      index.consumeSourceLink(link);
      index.consumeSourceLink(link);

      expect(index.findBySource(1, 'BTC', parseDecimal('1.0'))).toBeUndefined();
    });
  });

  describe('batched withdrawal scenarios (collision handling)', () => {
    it('should handle multiple links with same txId and asset but different amounts', () => {
      const links: TransactionLink[] = [
        createLink({
          id: 'link-1',
          sourceTransactionId: 1,
          targetTransactionId: 2,
          asset: Currency.create('BTC'),
          sourceAmount: parseDecimal('0.5'),
          targetAmount: parseDecimal('0.4995'),
        }),
        createLink({
          id: 'link-2',
          sourceTransactionId: 1,
          targetTransactionId: 3,
          asset: Currency.create('BTC'),
          sourceAmount: parseDecimal('1.0'),
          targetAmount: parseDecimal('0.9995'),
        }),
        createLink({
          id: 'link-3',
          sourceTransactionId: 1,
          targetTransactionId: 4,
          asset: Currency.create('BTC'),
          sourceAmount: parseDecimal('0.5'),
          targetAmount: parseDecimal('0.4998'),
        }),
      ];

      const index = new LinkIndex(links);

      const link1 = index.findBySource(1, 'BTC', parseDecimal('0.5'));
      const link2 = index.findBySource(1, 'BTC', parseDecimal('1.0'));

      expect(link1?.id).toBe('link-1');
      expect(link2?.id).toBe('link-2');
    });

    it('should return first matching link for exact amount', () => {
      const links: TransactionLink[] = [
        createLink({
          id: 'link-1',
          sourceTransactionId: 1,
          targetTransactionId: 2,
          asset: Currency.create('BTC'),
          sourceAmount: parseDecimal('0.5'),
          targetAmount: parseDecimal('0.4995'),
        }),
        createLink({
          id: 'link-2',
          sourceTransactionId: 1,
          targetTransactionId: 3,
          asset: Currency.create('BTC'),
          sourceAmount: parseDecimal('0.5'),
          targetAmount: parseDecimal('0.4998'),
        }),
      ];

      const index = new LinkIndex(links);
      const found = index.findBySource(1, 'BTC', parseDecimal('0.5'));

      expect(found?.id).toBe('link-1');
    });

    it('should allow sequential consumption of multiple outflows', () => {
      const links: TransactionLink[] = [
        createLink({
          id: 'link-1',
          sourceTransactionId: 1,
          targetTransactionId: 2,
          asset: Currency.create('BTC'),
          sourceAmount: parseDecimal('0.5'),
          targetAmount: parseDecimal('0.4995'),
        }),
        createLink({
          id: 'link-2',
          sourceTransactionId: 1,
          targetTransactionId: 3,
          asset: Currency.create('BTC'),
          sourceAmount: parseDecimal('0.5'),
          targetAmount: parseDecimal('0.4998'),
        }),
      ];

      const index = new LinkIndex(links);

      const firstLink = index.findBySource(1, 'BTC', parseDecimal('0.5'));
      expect(firstLink?.id).toBe('link-1');

      index.consumeSourceLink(firstLink!);

      const secondLink = index.findBySource(1, 'BTC', parseDecimal('0.5'));
      expect(secondLink?.id).toBe('link-2');
    });

    it('should keep remaining links available after consuming one', () => {
      const links: TransactionLink[] = [
        createLink({
          id: 'link-1',
          sourceTransactionId: 1,
          targetTransactionId: 2,
          asset: Currency.create('BTC'),
          sourceAmount: parseDecimal('0.5'),
          targetAmount: parseDecimal('0.4995'),
        }),
        createLink({
          id: 'link-2',
          sourceTransactionId: 1,
          targetTransactionId: 3,
          asset: Currency.create('BTC'),
          sourceAmount: parseDecimal('1.0'),
          targetAmount: parseDecimal('0.9995'),
        }),
        createLink({
          id: 'link-3',
          sourceTransactionId: 1,
          targetTransactionId: 4,
          asset: Currency.create('BTC'),
          sourceAmount: parseDecimal('0.5'),
          targetAmount: parseDecimal('0.4998'),
        }),
      ];

      const index = new LinkIndex(links);

      const firstLink = index.findBySource(1, 'BTC', parseDecimal('0.5'));
      index.consumeSourceLink(firstLink!);

      const link1Remaining = index.findBySource(1, 'BTC', parseDecimal('1.0'));
      const link2Remaining = index.findBySource(1, 'BTC', parseDecimal('0.5'));

      expect(link1Remaining?.id).toBe('link-2');
      expect(link2Remaining?.id).toBe('link-3');
    });

    it('should allow target side to find links even after source consumption', () => {
      const links: TransactionLink[] = [
        createLink({
          id: 'link-1',
          sourceTransactionId: 1,
          targetTransactionId: 2,
          asset: Currency.create('BTC'),
          sourceAmount: parseDecimal('0.5'),
          targetAmount: parseDecimal('0.4995'),
        }),
        createLink({
          id: 'link-2',
          sourceTransactionId: 1,
          targetTransactionId: 3,
          asset: Currency.create('BTC'),
          sourceAmount: parseDecimal('0.5'),
          targetAmount: parseDecimal('0.4998'),
        }),
      ];

      const index = new LinkIndex(links);

      const firstLink = index.findBySource(1, 'BTC', parseDecimal('0.5'));
      index.consumeSourceLink(firstLink!);

      const targetLink1 = index.findByTarget(2, 'BTC');
      const targetLink2 = index.findByTarget(3, 'BTC');

      expect(targetLink1?.id).toBe('link-1');
      expect(targetLink2?.id).toBe('link-2');
    });

    it('should handle batched withdrawal with 3 outflows from same transaction', () => {
      const links: TransactionLink[] = [
        createLink({
          id: 'link-1',
          sourceTransactionId: 100,
          targetTransactionId: 201,
          asset: Currency.create('BTC'),
          sourceAmount: parseDecimal('0.3'),
          targetAmount: parseDecimal('0.2997'),
        }),
        createLink({
          id: 'link-2',
          sourceTransactionId: 100,
          targetTransactionId: 202,
          asset: Currency.create('BTC'),
          sourceAmount: parseDecimal('0.5'),
          targetAmount: parseDecimal('0.4995'),
        }),
        createLink({
          id: 'link-3',
          sourceTransactionId: 100,
          targetTransactionId: 203,
          asset: Currency.create('BTC'),
          sourceAmount: parseDecimal('0.2'),
          targetAmount: parseDecimal('0.1998'),
        }),
      ];

      const index = new LinkIndex(links);

      const firstOutflow = index.findBySource(100, 'BTC', parseDecimal('0.3'));
      expect(firstOutflow?.id).toBe('link-1');
      index.consumeSourceLink(firstOutflow!);

      const secondOutflow = index.findBySource(100, 'BTC', parseDecimal('0.5'));
      expect(secondOutflow?.id).toBe('link-2');
      index.consumeSourceLink(secondOutflow!);

      const thirdOutflow = index.findBySource(100, 'BTC', parseDecimal('0.2'));
      expect(thirdOutflow?.id).toBe('link-3');
      index.consumeSourceLink(thirdOutflow!);

      const noMoreLinks = index.findBySource(100, 'BTC', parseDecimal('0.3'));
      expect(noMoreLinks).toBeUndefined();
    });
  });

  describe('edge cases', () => {
    it('should handle same transaction with multiple inflows and outflows', () => {
      const links: TransactionLink[] = [
        createLink({
          id: 'link-1',
          sourceTransactionId: 1,
          targetTransactionId: 2,
          asset: Currency.create('BTC'),
          sourceAmount: parseDecimal('1.0'),
          targetAmount: parseDecimal('0.9995'),
        }),
        createLink({
          id: 'link-2',
          sourceTransactionId: 1,
          targetTransactionId: 2,
          asset: Currency.create('ETH'),
          sourceAmount: parseDecimal('10.0'),
          targetAmount: parseDecimal('9.98'),
        }),
      ];

      const index = new LinkIndex(links);

      const btcLink = index.findBySource(1, 'BTC', parseDecimal('1.0'));
      const ethLink = index.findBySource(1, 'ETH', parseDecimal('10.0'));

      expect(btcLink?.id).toBe('link-1');
      expect(ethLink?.id).toBe('link-2');
    });

    it('should handle very small amounts with high precision', () => {
      const links: TransactionLink[] = [
        createLink({
          id: 'link-1',
          sourceTransactionId: 1,
          targetTransactionId: 2,
          asset: Currency.create('BTC'),
          sourceAmount: parseDecimal('0.00000001'),
          targetAmount: parseDecimal('0.000000009'),
        }),
      ];

      const index = new LinkIndex(links);
      const found = index.findBySource(1, 'BTC', parseDecimal('0.00000001'));

      expect(found).toBeDefined();
      expect(found?.id).toBe('link-1');
    });

    it('should handle very large amounts', () => {
      const links: TransactionLink[] = [
        createLink({
          id: 'link-1',
          sourceTransactionId: 1,
          targetTransactionId: 2,
          asset: Currency.create('SHIB'),
          sourceAmount: parseDecimal('1000000000'),
          targetAmount: parseDecimal('999500000'),
        }),
      ];

      const index = new LinkIndex(links);
      const found = index.findBySource(1, 'SHIB', parseDecimal('1000000000'));

      expect(found).toBeDefined();
      expect(found?.id).toBe('link-1');
    });

    it('should maintain FIFO order for unconsumed links', () => {
      const links: TransactionLink[] = [
        createLink({
          id: 'link-1',
          sourceTransactionId: 1,
          targetTransactionId: 2,
          asset: Currency.create('BTC'),
          sourceAmount: parseDecimal('1.0'),
          targetAmount: parseDecimal('0.9995'),
        }),
        createLink({
          id: 'link-2',
          sourceTransactionId: 1,
          targetTransactionId: 3,
          asset: Currency.create('BTC'),
          sourceAmount: parseDecimal('1.0'),
          targetAmount: parseDecimal('0.999'),
        }),
        createLink({
          id: 'link-3',
          sourceTransactionId: 1,
          targetTransactionId: 4,
          asset: Currency.create('BTC'),
          sourceAmount: parseDecimal('1.0'),
          targetAmount: parseDecimal('0.998'),
        }),
      ];

      const index = new LinkIndex(links);

      const first = index.findBySource(1, 'BTC', parseDecimal('1.0'));
      expect(first?.id).toBe('link-1');

      index.consumeSourceLink(first!);

      const second = index.findBySource(1, 'BTC', parseDecimal('1.0'));
      expect(second?.id).toBe('link-2');

      index.consumeSourceLink(second!);

      const third = index.findBySource(1, 'BTC', parseDecimal('1.0'));
      expect(third?.id).toBe('link-3');
    });

    it('should handle different assets for same transaction IDs', () => {
      const links: TransactionLink[] = [
        createLink({
          id: 'link-1',
          sourceTransactionId: 1,
          targetTransactionId: 2,
          asset: Currency.create('BTC'),
          sourceAmount: parseDecimal('1.0'),
          targetAmount: parseDecimal('0.9995'),
        }),
        createLink({
          id: 'link-2',
          sourceTransactionId: 1,
          targetTransactionId: 2,
          asset: Currency.create('ETH'),
          sourceAmount: parseDecimal('10.0'),
          targetAmount: parseDecimal('9.98'),
        }),
      ];

      const index = new LinkIndex(links);

      const btcLink = index.findBySource(1, 'BTC', parseDecimal('1.0'));
      const ethLink = index.findBySource(1, 'ETH', parseDecimal('10.0'));

      expect(btcLink?.id).toBe('link-1');
      expect(ethLink?.id).toBe('link-2');

      index.consumeSourceLink(btcLink!);

      const btcStillGone = index.findBySource(1, 'BTC', parseDecimal('1.0'));
      const ethStillThere = index.findBySource(1, 'ETH', parseDecimal('10.0'));

      expect(btcStillGone).toBeUndefined();
      expect(ethStillThere?.id).toBe('link-2');
    });

    it('should handle consuming from middle of link array', () => {
      const links: TransactionLink[] = [
        createLink({
          id: 'link-1',
          sourceTransactionId: 1,
          targetTransactionId: 2,
          asset: Currency.create('BTC'),
          sourceAmount: parseDecimal('1.0'),
          targetAmount: parseDecimal('0.9995'),
        }),
        createLink({
          id: 'link-2',
          sourceTransactionId: 1,
          targetTransactionId: 3,
          asset: Currency.create('BTC'),
          sourceAmount: parseDecimal('1.0'),
          targetAmount: parseDecimal('0.999'),
        }),
        createLink({
          id: 'link-3',
          sourceTransactionId: 1,
          targetTransactionId: 4,
          asset: Currency.create('BTC'),
          sourceAmount: parseDecimal('1.0'),
          targetAmount: parseDecimal('0.998'),
        }),
      ];

      const index = new LinkIndex(links);

      const first = index.findBySource(1, 'BTC', parseDecimal('1.0'));
      index.consumeSourceLink(first!);

      const second = index.findBySource(1, 'BTC', parseDecimal('1.0'));
      expect(second?.id).toBe('link-2');

      index.consumeSourceLink(second!);

      const third = index.findBySource(1, 'BTC', parseDecimal('1.0'));
      expect(third?.id).toBe('link-3');

      index.consumeSourceLink(third!);

      const noMore = index.findBySource(1, 'BTC', parseDecimal('1.0'));
      expect(noMore).toBeUndefined();
    });

    it('should handle links with identical amounts but different targets', () => {
      const links: TransactionLink[] = [
        createLink({
          id: 'link-1',
          sourceTransactionId: 1,
          targetTransactionId: 2,
          asset: Currency.create('BTC'),
          sourceAmount: parseDecimal('1.0'),
          targetAmount: parseDecimal('0.9995'),
        }),
        createLink({
          id: 'link-2',
          sourceTransactionId: 1,
          targetTransactionId: 3,
          asset: Currency.create('BTC'),
          sourceAmount: parseDecimal('1.0'),
          targetAmount: parseDecimal('0.9995'),
        }),
      ];

      const index = new LinkIndex(links);

      const byTarget2 = index.findByTarget(2, 'BTC');
      const byTarget3 = index.findByTarget(3, 'BTC');

      expect(byTarget2?.id).toBe('link-1');
      expect(byTarget3?.id).toBe('link-2');
    });
  });
});

/**
 * Helper function to create a TransactionLink for testing
 */
function createLink(params: {
  asset: Currency;
  id: string;
  sourceAmount: Decimal;
  sourceTransactionId: number;
  targetAmount: Decimal;
  targetTransactionId: number;
}): TransactionLink {
  return {
    id: params.id,
    sourceTransactionId: params.sourceTransactionId,
    targetTransactionId: params.targetTransactionId,
    asset: params.asset,
    sourceAmount: params.sourceAmount,
    targetAmount: params.targetAmount,
    linkType: 'exchange_to_blockchain',
    confidenceScore: parseDecimal('0.95'),
    matchCriteria: {
      assetMatch: true,
      amountSimilarity: parseDecimal('0.9995'),
      timingValid: true,
      timingHours: 1,
    },
    status: 'confirmed',
    reviewedBy: 'auto',
    reviewedAt: new Date('2024-01-01T12:00:00Z'),
    createdAt: new Date('2024-01-01T12:00:00Z'),
    updatedAt: new Date('2024-01-01T12:00:00Z'),
  };
}
