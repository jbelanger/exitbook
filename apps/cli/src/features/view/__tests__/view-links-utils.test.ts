import { parseDecimal } from '@exitbook/core';
import { describe, expect, it } from 'vitest';

import type { LinkInfo } from '../view-links-utils.ts';
import {
  formatConfidence,
  formatLinkForDisplay,
  formatLinksListForDisplay,
  formatMatchCriteria,
  getLinkStatusIcon,
} from '../view-links-utils.ts';

describe('view-links-utils', () => {
  describe('getLinkStatusIcon', () => {
    it('should return checkmark for confirmed status', () => {
      expect(getLinkStatusIcon('confirmed')).toBe('✓');
    });

    it('should return X for rejected status', () => {
      expect(getLinkStatusIcon('rejected')).toBe('✗');
    });

    it('should return warning for suggested status', () => {
      expect(getLinkStatusIcon('suggested')).toBe('⚠');
    });

    it('should return bullet point for unknown status', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument -- Testing default case with invalid status
      expect(getLinkStatusIcon('unknown' as any)).toBe('•');
    });
  });

  describe('formatConfidence', () => {
    it('should format string confidence score as percentage', () => {
      expect(formatConfidence('0.75')).toBe('75.0%');
      expect(formatConfidence('0.95')).toBe('95.0%');
      expect(formatConfidence('1.0')).toBe('100.0%');
      expect(formatConfidence('0.0')).toBe('0.0%');
    });

    it('should format Decimal confidence score as percentage', () => {
      expect(formatConfidence(parseDecimal('0.75'))).toBe('75.0%');
      expect(formatConfidence(parseDecimal('0.95'))).toBe('95.0%');
      expect(formatConfidence(parseDecimal('1.0'))).toBe('100.0%');
      expect(formatConfidence(parseDecimal('0.0'))).toBe('0.0%');
    });

    it('should format low confidence scores correctly', () => {
      expect(formatConfidence('0.05')).toBe('5.0%');
      expect(formatConfidence(parseDecimal('0.123'))).toBe('12.3%');
    });

    it('should format very precise scores with one decimal', () => {
      expect(formatConfidence('0.876543')).toBe('87.7%');
      expect(formatConfidence(parseDecimal('0.999'))).toBe('99.9%');
    });
  });

  describe('formatMatchCriteria', () => {
    it('should format criteria with asset match', () => {
      const criteria = {
        assetMatch: true,
        amountSimilarity: parseDecimal('0.95'),
        timingValid: false,
        timingHours: 0,
        addressMatch: false,
      };

      const result = formatMatchCriteria(criteria);

      expect(result).toContain('asset');
      expect(result).toContain('amount 95.0%');
    });

    it('should format criteria with timing', () => {
      const criteria = {
        assetMatch: false,
        amountSimilarity: parseDecimal('1.0'),
        timingValid: true,
        timingHours: 2.5,
        addressMatch: false,
      };

      const result = formatMatchCriteria(criteria);

      expect(result).toContain('amount 100.0%');
      expect(result).toContain('timing 2.5h');
      expect(result).not.toContain('asset');
    });

    it('should format criteria with address match', () => {
      const criteria = {
        assetMatch: true,
        amountSimilarity: parseDecimal('0.85'),
        timingValid: true,
        timingHours: 1.2,
        addressMatch: true,
      };

      const result = formatMatchCriteria(criteria);

      expect(result).toContain('asset');
      expect(result).toContain('amount 85.0%');
      expect(result).toContain('timing 1.2h');
      expect(result).toContain('address');
    });

    it('should handle string amountSimilarity from match criteria type', () => {
      const criteria = {
        assetMatch: false,
        amountSimilarity: parseDecimal('0.75'),
        timingValid: false,
        timingHours: 0,
        addressMatch: false,
      };

      const result = formatMatchCriteria(criteria);

      expect(result).toContain('amount 75.0%');
    });

    it('should format all criteria together', () => {
      const criteria = {
        assetMatch: true,
        amountSimilarity: parseDecimal('0.99'),
        timingValid: true,
        timingHours: 0.5,
        addressMatch: true,
      };

      const result = formatMatchCriteria(criteria);

      expect(result).toBe('asset, amount 99.0%, timing 0.5h, address');
    });

    it('should format minimal criteria', () => {
      const criteria = {
        assetMatch: false,
        amountSimilarity: parseDecimal('0.5'),
        timingValid: false,
        timingHours: 0,
        addressMatch: false,
      };

      const result = formatMatchCriteria(criteria);

      expect(result).toBe('amount 50.0%');
    });
  });

  describe('formatLinkForDisplay', () => {
    it('should format a complete link with all fields', () => {
      const link: LinkInfo = {
        id: 'abc123def456',
        source_transaction_id: 100,
        target_transaction_id: 200,
        link_type: 'deposit_withdrawal',
        confidence_score: '0.85',
        match_criteria: {
          assetMatch: true,
          amountSimilarity: parseDecimal('0.95'),
          timingValid: true,
          timingHours: 1.5,
          addressMatch: false,
        },
        status: 'confirmed',
        reviewed_by: 'user123',
        reviewed_at: '2024-01-15T10:30:00Z',
        created_at: '2024-01-15T09:00:00Z',
        updated_at: '2024-01-15T10:30:00Z',
      };

      const result = formatLinkForDisplay(link);

      expect(result).toContain('✓ Link #abc123de - deposit withdrawal (85.0%)');
      expect(result).toContain('Source TX: #100 → Target TX: #200');
      expect(result).toContain('Status: confirmed');
      expect(result).toContain('Match: asset, amount 95.0%, timing 1.5h');
      expect(result).toContain('Created: 2024-01-15T09:00:00Z');
      expect(result).toContain('Reviewed by: user123 at 2024-01-15T10:30:00Z');
    });

    it('should format link without review information', () => {
      const link: LinkInfo = {
        id: 'xyz789abc123',
        source_transaction_id: 300,
        target_transaction_id: 400,
        link_type: 'exchange_trade',
        confidence_score: '0.92',
        match_criteria: {
          assetMatch: true,
          amountSimilarity: parseDecimal('0.99'),
          timingValid: false,
          timingHours: 0,
          addressMatch: false,
        },
        status: 'suggested',
        reviewed_by: undefined,
        reviewed_at: undefined,
        created_at: '2024-01-20T14:00:00Z',
        updated_at: '2024-01-20T14:00:00Z',
      };

      const result = formatLinkForDisplay(link);

      expect(result).toContain('⚠ Link #xyz789ab - exchange trade (92.0%)');
      expect(result).toContain('Source TX: #300 → Target TX: #400');
      expect(result).toContain('Status: suggested');
      expect(result).toContain('Match: asset, amount 99.0%');
      expect(result).not.toContain('Reviewed by:');
    });

    it('should format rejected link', () => {
      const link: LinkInfo = {
        id: 'rejected123',
        source_transaction_id: 500,
        target_transaction_id: 600,
        link_type: 'transfer',
        confidence_score: '0.45',
        match_criteria: {
          assetMatch: false,
          amountSimilarity: parseDecimal('0.45'),
          timingValid: false,
          timingHours: 0,
          addressMatch: false,
        },
        status: 'rejected',
        reviewed_by: 'admin',
        reviewed_at: '2024-01-25T16:00:00Z',
        created_at: '2024-01-25T15:00:00Z',
        updated_at: '2024-01-25T16:00:00Z',
      };

      const result = formatLinkForDisplay(link);

      expect(result).toContain('✗ Link #rejected - transfer (45.0%)');
      expect(result).toContain('Status: rejected');
      expect(result).toContain('Reviewed by: admin at 2024-01-25T16:00:00Z');
    });

    it('should replace underscores in link type', () => {
      const link: LinkInfo = {
        id: 'test123',
        source_transaction_id: 1,
        target_transaction_id: 2,
        link_type: 'cross_chain_bridge',
        confidence_score: '0.80',
        match_criteria: {
          assetMatch: true,
          amountSimilarity: parseDecimal('0.95'),
          timingValid: false,
          timingHours: 0,
          addressMatch: false,
        },
        status: 'suggested',
        reviewed_by: undefined,
        reviewed_at: undefined,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      };

      const result = formatLinkForDisplay(link);

      expect(result).toContain('cross chain bridge');
      expect(result).not.toContain('cross_chain_bridge');
    });

    it('should truncate link ID to 8 characters', () => {
      const link: LinkInfo = {
        id: 'verylongid123456789',
        source_transaction_id: 1,
        target_transaction_id: 2,
        link_type: 'test',
        confidence_score: '0.90',
        match_criteria: {
          assetMatch: true,
          amountSimilarity: parseDecimal('0.90'),
          timingValid: false,
          timingHours: 0,
          addressMatch: false,
        },
        status: 'suggested',
        reviewed_by: undefined,
        reviewed_at: undefined,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      };

      const result = formatLinkForDisplay(link);

      expect(result).toContain('Link #verylong');
      expect(result).not.toContain('verylongid1');
    });
  });

  describe('formatLinksListForDisplay', () => {
    it('should format empty links list', () => {
      const result = formatLinksListForDisplay([], 0);

      expect(result).toContain('Transaction Links:');
      expect(result).toContain('=============================');
      expect(result).toContain('No links found.');
      expect(result).toContain('Total: 0 links');
    });

    it('should format single link', () => {
      const links: LinkInfo[] = [
        {
          id: 'link123',
          source_transaction_id: 100,
          target_transaction_id: 200,
          link_type: 'transfer',
          confidence_score: '0.90',
          match_criteria: {
            assetMatch: true,
            amountSimilarity: parseDecimal('0.95'),
            timingValid: false,
            timingHours: 0,
            addressMatch: false,
          },
          status: 'confirmed',
          reviewed_by: undefined,
          reviewed_at: undefined,
          created_at: '2024-01-15T10:00:00Z',
          updated_at: '2024-01-15T10:00:00Z',
        },
      ];

      const result = formatLinksListForDisplay(links, 1);

      expect(result).toContain('Transaction Links:');
      expect(result).toContain('✓ Link #link123 - transfer (90.0%)');
      expect(result).toContain('Total: 1 links');
    });

    it('should format multiple links', () => {
      const links: LinkInfo[] = [
        {
          id: 'link1',
          source_transaction_id: 100,
          target_transaction_id: 200,
          link_type: 'deposit',
          confidence_score: '0.95',
          match_criteria: {
            assetMatch: true,
            amountSimilarity: parseDecimal('0.98'),
            timingValid: true,
            timingHours: 1.0,
            addressMatch: true,
          },
          status: 'confirmed',
          reviewed_by: undefined,
          reviewed_at: undefined,
          created_at: '2024-01-15T10:00:00Z',
          updated_at: '2024-01-15T10:00:00Z',
        },
        {
          id: 'link2',
          source_transaction_id: 300,
          target_transaction_id: 400,
          link_type: 'withdrawal',
          confidence_score: '0.75',
          match_criteria: {
            assetMatch: true,
            amountSimilarity: parseDecimal('0.85'),
            timingValid: false,
            timingHours: 0,
            addressMatch: false,
          },
          status: 'suggested',
          reviewed_by: undefined,
          reviewed_at: undefined,
          created_at: '2024-01-15T11:00:00Z',
          updated_at: '2024-01-15T11:00:00Z',
        },
        {
          id: 'link3',
          source_transaction_id: 500,
          target_transaction_id: 600,
          link_type: 'trade',
          confidence_score: '0.40',
          match_criteria: {
            assetMatch: false,
            amountSimilarity: parseDecimal('0.40'),
            timingValid: false,
            timingHours: 0,
            addressMatch: false,
          },
          status: 'rejected',
          reviewed_by: 'admin',
          reviewed_at: '2024-01-15T12:00:00Z',
          created_at: '2024-01-15T12:00:00Z',
          updated_at: '2024-01-15T12:00:00Z',
        },
      ];

      const result = formatLinksListForDisplay(links, 3);

      expect(result).toContain('✓ Link #link1 - deposit (95.0%)');
      expect(result).toContain('⚠ Link #link2 - withdrawal (75.0%)');
      expect(result).toContain('✗ Link #link3 - trade (40.0%)');
      expect(result).toContain('Total: 3 links');
    });

    it('should show correct total even when displaying fewer links', () => {
      const links: LinkInfo[] = [
        {
          id: 'link1',
          source_transaction_id: 1,
          target_transaction_id: 2,
          link_type: 'test',
          confidence_score: '0.90',
          match_criteria: {
            assetMatch: true,
            amountSimilarity: parseDecimal('0.90'),
            timingValid: false,
            timingHours: 0,
            addressMatch: false,
          },
          status: 'suggested',
          reviewed_by: undefined,
          reviewed_at: undefined,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        },
      ];

      const result = formatLinksListForDisplay(links, 100);

      expect(result).toContain('⚠ Link #link1');
      expect(result).toContain('Total: 100 links');
    });

    it('should include blank lines between links', () => {
      const links: LinkInfo[] = [
        {
          id: 'link1',
          source_transaction_id: 1,
          target_transaction_id: 2,
          link_type: 'test',
          confidence_score: '0.90',
          match_criteria: {
            assetMatch: true,
            amountSimilarity: parseDecimal('0.90'),
            timingValid: false,
            timingHours: 0,
            addressMatch: false,
          },
          status: 'suggested',
          reviewed_by: undefined,
          reviewed_at: undefined,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        },
        {
          id: 'link2',
          source_transaction_id: 3,
          target_transaction_id: 4,
          link_type: 'test',
          confidence_score: '0.80',
          match_criteria: {
            assetMatch: true,
            amountSimilarity: parseDecimal('0.80'),
            timingValid: false,
            timingHours: 0,
            addressMatch: false,
          },
          status: 'suggested',
          reviewed_by: undefined,
          reviewed_at: undefined,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        },
      ];

      const result = formatLinksListForDisplay(links, 2);
      const lines = result.split('\n');

      const link2Index = lines.findIndex((line) => line.includes('Link #link2'));

      expect(lines[link2Index - 1]).toBe('');
    });
  });
});
