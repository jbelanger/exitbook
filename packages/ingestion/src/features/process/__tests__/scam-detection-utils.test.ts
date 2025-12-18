import type { TokenMetadataRecord } from '@exitbook/core';
import { parseDecimal } from '@exitbook/core';
import { describe, expect, it } from 'vitest';

import type { ProcessedTransaction } from '../../../shared/types/processors.js';
import { detectScamFromSymbol, detectScamToken, applyScamDetection } from '../scam-detection-utils.js';

describe('scam-detection-utils', () => {
  describe('detectScamToken', () => {
    const contractAddress = '0x1234567890abcdef1234567890abcdef12345678';

    describe('Tier 1: Professional spam detection', () => {
      it('should detect scam when possibleSpam flag is true', () => {
        const metadata: TokenMetadataRecord = {
          blockchain: 'ethereum',
          contractAddress,
          name: 'Legitimate Token',
          possibleSpam: true,
          refreshedAt: new Date(),
          source: 'moralis',
          symbol: 'LGT',
        };

        const result = detectScamToken(contractAddress, metadata);

        expect(result).toBeDefined();
        expect(result?.severity).toBe('error');
        expect(result?.type).toBe('SCAM_TOKEN');
        expect(result?.message).toContain('Scam token detected by moralis');
        expect(result?.metadata?.detectionSource).toBe('professional');
      });

      it('should not detect scam when possibleSpam is false', () => {
        const metadata: TokenMetadataRecord = {
          blockchain: 'ethereum',
          contractAddress,
          name: 'Legitimate Token',
          possibleSpam: false,
          refreshedAt: new Date(),
          source: 'moralis',
          symbol: 'LGT',
        };

        const result = detectScamToken(contractAddress, metadata);

        expect(result).toBeUndefined();
      });

      it('should not detect scam when possibleSpam is undefined', () => {
        const metadata: TokenMetadataRecord = {
          blockchain: 'ethereum',
          contractAddress,
          name: 'Legitimate Token',
          refreshedAt: new Date(),
          source: 'moralis',
          symbol: 'LGT',
        };

        const result = detectScamToken(contractAddress, metadata);

        expect(result).toBeUndefined();
      });
    });

    describe('Tier 2: Pattern matching - Gift emojis', () => {
      it('should detect scam with gift emojis in name', () => {
        const metadata: TokenMetadataRecord = {
          blockchain: 'ethereum',
          contractAddress,
          name: '🎁 Free Tokens',
          refreshedAt: new Date(),
          source: 'helius',
          symbol: 'FREE',
        };

        const result = detectScamToken(contractAddress, metadata);

        expect(result).toBeDefined();
        expect(result?.severity).toBe('warning');
        expect(result?.metadata?.indicators).toContain('Gift/drop emojis in token name');
      });

      it('should detect scam with drop/airdrop emojis', () => {
        const metadata: TokenMetadataRecord = {
          blockchain: 'ethereum',
          contractAddress,
          name: '🪂 Airdrop Token',
          refreshedAt: new Date(),
          source: 'helius',
          symbol: 'AIR',
        };

        const result = detectScamToken(contractAddress, metadata);

        expect(result).toBeDefined();
        expect(result?.metadata?.indicators).toContain('Gift/drop emojis in token name');
      });
    });

    describe('Tier 2: Pattern matching - Homograph attacks', () => {
      it('should detect Cyrillic lookalike characters', () => {
        const metadata: TokenMetadataRecord = {
          blockchain: 'ethereum',
          contractAddress,
          name: 'Uniswаp', // Using Cyrillic 'а' (U+0430) instead of Latin 'a' (U+0061)
          refreshedAt: new Date(),
          source: 'helius',
          symbol: 'UNI',
        };

        const result = detectScamToken(contractAddress, metadata);

        expect(result).toBeDefined();
        expect(result?.severity).toBe('error');
        expect(result?.metadata?.indicators).toContain('Contains lookalike unicode characters (possible spoofing)');
      });

      it('should detect Greek lookalike characters', () => {
        const metadata: TokenMetadataRecord = {
          blockchain: 'ethereum',
          contractAddress,
          name: 'Τether', // Using Greek capital tau
          refreshedAt: new Date(),
          source: 'helius',
          symbol: 'USDT',
        };

        const result = detectScamToken(contractAddress, metadata);

        expect(result).toBeDefined();
        expect(result?.metadata?.indicators).toContain('Contains lookalike unicode characters (possible spoofing)');
      });
    });

    describe('Tier 2: Pattern matching - Zero-width characters', () => {
      it('should detect zero-width characters in token name', () => {
        const metadata: TokenMetadataRecord = {
          blockchain: 'ethereum',
          contractAddress,
          name: 'Uni\u200bswap', // Zero-width space
          refreshedAt: new Date(),
          source: 'helius',
          symbol: 'UNI',
        };

        const result = detectScamToken(contractAddress, metadata);

        expect(result).toBeDefined();
        expect(result?.severity).toBe('error');
        expect(result?.metadata?.indicators).toContain('Contains invisible unicode characters (obfuscation)');
      });

      it('should detect zero-width non-joiner', () => {
        const metadata: TokenMetadataRecord = {
          blockchain: 'ethereum',
          contractAddress,
          name: 'Tet\u200cher', // Zero-width non-joiner
          refreshedAt: new Date(),
          source: 'helius',
          symbol: 'USDT',
        };

        const result = detectScamToken(contractAddress, metadata);

        expect(result).toBeDefined();
        expect(result?.metadata?.indicators).toContain('Contains invisible unicode characters (obfuscation)');
      });
    });

    describe('Tier 2: Pattern matching - Unicode dot obfuscation', () => {
      it('should detect unicode dot in token name', () => {
        const metadata: TokenMetadataRecord = {
          blockchain: 'ethereum',
          contractAddress,
          name: 'claim․com', // Using unicode one-dot leader (U+2024) instead of period
          refreshedAt: new Date(),
          source: 'helius',
          symbol: 'CLAIM',
        };

        const result = detectScamToken(contractAddress, metadata);

        expect(result).toBeDefined();
        expect(result?.severity).toBe('error');
        expect(result?.metadata?.indicators).toContain('Contains obfuscated URL characters');
      });

      it('should detect unicode dot in external URL', () => {
        const metadata: TokenMetadataRecord = {
          blockchain: 'ethereum',
          contractAddress,
          externalUrl: 'https://scam․com', // Using unicode bullet operator (U+2219)
          name: 'Token',
          refreshedAt: new Date(),
          source: 'helius',
          symbol: 'TKN',
        };

        const result = detectScamToken(contractAddress, metadata);

        expect(result).toBeDefined();
        expect(result?.metadata?.indicators).toContain('Contains obfuscated URL characters');
      });
    });

    describe('Tier 2: Pattern matching - URL and time patterns', () => {
      it('should detect tokens with suspicious URL patterns', () => {
        const metadata: TokenMetadataRecord = {
          blockchain: 'ethereum',
          contractAddress,
          name: 'Visit UniswapRewards.com',
          refreshedAt: new Date(),
          source: 'helius',
          symbol: 'UNISWAP',
        };

        const result = detectScamToken(contractAddress, metadata);

        expect(result).toBeDefined();
        expect(result?.severity).toBe('error');
        expect(result?.metadata?.indicators).toContain('Contains suspicious URL/website pattern');
      });

      it('should detect time-based scam pattern (conservative)', () => {
        const metadata: TokenMetadataRecord = {
          blockchain: 'ethereum',
          contractAddress,
          name: '2024 claim airdrop bonus',
          refreshedAt: new Date(),
          source: 'helius',
          symbol: 'SCAM',
        };

        const result = detectScamToken(contractAddress, metadata);

        expect(result).toBeDefined();
        expect(result?.metadata?.indicators).toContain('Suspicious year/drop pattern in name');
      });

      it('should not flag tokens with individual words like "free" or "reward" alone', () => {
        const metadata: TokenMetadataRecord = {
          blockchain: 'ethereum',
          contractAddress,
          name: 'FreedomCoin',
          refreshedAt: new Date(),
          source: 'helius',
          symbol: 'FREE',
        };

        const result = detectScamToken(contractAddress, metadata);

        // Should not be flagged because "free" alone is not suspicious
        expect(result).toBeUndefined();
      });

      it('should not flag legitimate tokens with clean names', () => {
        const metadata: TokenMetadataRecord = {
          blockchain: 'ethereum',
          contractAddress,
          name: 'Uniswap',
          refreshedAt: new Date(),
          source: 'helius',
          symbol: 'UNI',
        };

        const result = detectScamToken(contractAddress, metadata);

        expect(result).toBeUndefined();
      });
    });

    describe('Tier 2: Pattern matching - Suspicious URLs', () => {
      it('should detect suspicious URL in external_url field', () => {
        const metadata: TokenMetadataRecord = {
          blockchain: 'ethereum',
          contractAddress,
          externalUrl: 'http://solana-airdrop.com',
          name: 'Token',
          refreshedAt: new Date(),
          source: 'helius',
          symbol: 'TKN',
        };

        const result = detectScamToken(contractAddress, metadata);

        expect(result).toBeDefined();
        expect(result?.severity).toBe('error');
        expect(result?.metadata?.indicators).toContain('Suspicious external URL');
      });

      it('should allow legitimate URLs', () => {
        const metadata: TokenMetadataRecord = {
          blockchain: 'ethereum',
          contractAddress,
          externalUrl: 'https://uniswap.org',
          name: 'Uniswap',
          refreshedAt: new Date(),
          source: 'helius',
          symbol: 'UNI',
        };

        const result = detectScamToken(contractAddress, metadata);

        expect(result).toBeUndefined();
      });
    });

    describe('Tier 2: Pattern matching - URL patterns in name', () => {
      it('should detect URL patterns in token name', () => {
        const metadata: TokenMetadataRecord = {
          blockchain: 'ethereum',
          contractAddress,
          name: 'Visit claim.rewards.com',
          refreshedAt: new Date(),
          source: 'helius',
          symbol: 'CLAIM',
        };

        const result = detectScamToken(contractAddress, metadata);

        expect(result).toBeDefined();
        expect(result?.metadata?.indicators).toContain('Contains suspicious URL/website pattern');
      });

      it('should detect http/https in name', () => {
        const metadata: TokenMetadataRecord = {
          blockchain: 'ethereum',
          contractAddress,
          name: 'https://free-airdrop.com',
          refreshedAt: new Date(),
          source: 'helius',
          symbol: 'FREE',
        };

        const result = detectScamToken(contractAddress, metadata);

        expect(result).toBeDefined();
        expect(result?.metadata?.indicators).toContain('Contains suspicious URL/website pattern');
      });
    });

    describe('Tier 2: Pattern matching - Scam phrases in description', () => {
      it('should detect scam phrases in description', () => {
        const metadata: TokenMetadataRecord = {
          blockchain: 'ethereum',
          contractAddress,
          description: 'Visit our website to claim your free airdrop tokens now!',
          name: 'Reward Token',
          refreshedAt: new Date(),
          source: 'helius',
          symbol: 'REWARD',
        };

        const result = detectScamToken(contractAddress, metadata);

        expect(result).toBeDefined();
        expect(result?.metadata?.indicators).toContain('Scam phrases in description');
      });
    });

    describe('Tier 3: Heuristics - Airdrop context', () => {
      it('should flag unsolicited airdrop with other suspicious indicators', () => {
        const metadata: TokenMetadataRecord = {
          blockchain: 'ethereum',
          contractAddress,
          name: '🎁 Free Tokens',
          refreshedAt: new Date(),
          source: 'helius',
          symbol: 'FREE',
        };

        const result = detectScamToken(contractAddress, metadata, {
          amount: 1000000,
          isAirdrop: true,
        });

        expect(result).toBeDefined();
        expect(result?.metadata?.indicators).toContain('Gift/drop emojis in token name');
        expect(result?.metadata?.indicators).toContain('Unsolicited airdrop');
      });

      it('should add warning for airdrop alone without other indicators', () => {
        const metadata: TokenMetadataRecord = {
          blockchain: 'ethereum',
          contractAddress,
          name: 'Legitimate Token',
          refreshedAt: new Date(),
          source: 'helius',
          symbol: 'LGT',
        };

        const result = detectScamToken(contractAddress, metadata, {
          amount: 1000000,
          isAirdrop: true,
        });

        expect(result).toBeDefined();
        expect(result?.severity).toBe('warning');
        expect(result?.metadata?.indicators).toContain('Unsolicited airdrop (verify legitimacy)');
      });

      it('should not flag airdrop when amount is 0', () => {
        const metadata: TokenMetadataRecord = {
          blockchain: 'ethereum',
          contractAddress,
          name: 'Legitimate Token',
          refreshedAt: new Date(),
          source: 'helius',
          symbol: 'LGT',
        };

        const result = detectScamToken(contractAddress, metadata, {
          amount: 0,
          isAirdrop: true,
        });

        expect(result).toBeUndefined();
      });
    });

    describe('Multiple indicators', () => {
      it('should combine multiple suspicious indicators', () => {
        const metadata: TokenMetadataRecord = {
          blockchain: 'ethereum',
          contractAddress,
          description: 'Claim your rewards now!',
          externalUrl: 'http://scam-rewards.com',
          name: '🎁 Visit RewardsClaim.com',
          refreshedAt: new Date(),
          source: 'helius',
          symbol: 'SCAM',
        };

        const result = detectScamToken(contractAddress, metadata);

        expect(result).toBeDefined();
        expect(result?.severity).toBe('error');
        expect(Array.isArray(result?.metadata?.indicators)).toBe(true);
        expect((result?.metadata?.indicators as string[]).length).toBeGreaterThan(1);
      });
    });
  });

  describe('detectScamFromSymbol', () => {
    it('should detect URL patterns in symbol', () => {
      const result = detectScamFromSymbol('Visit-https://scam.com');

      expect(result.isScam).toBe(true);
      expect(result.reason).toBe('Contains suspicious URL/website pattern');
    });

    it('should detect .com in symbol', () => {
      const result = detectScamFromSymbol('ClaimRewards.com');

      expect(result.isScam).toBe(true);
      expect(result.reason).toBe('Contains suspicious URL/website pattern');
    });

    it('should detect explicit scam phrases in symbol', () => {
      const result = detectScamFromSymbol('visit-site-to-claim');

      expect(result.isScam).toBe(true);
      expect(result.reason).toBe('Contains obvious scam phrases');
    });

    it('should detect gift emojis in symbol', () => {
      const result = detectScamFromSymbol('🎁FREE');

      expect(result.isScam).toBe(true);
      expect(result.reason).toBe('Contains gift/reward emojis');
    });

    it('should not flag legitimate symbols', () => {
      const validSymbols = ['USDC', 'ETH', 'BTC', 'UNI', 'AAVE', 'JUP'];

      for (const symbol of validSymbols) {
        const result = detectScamFromSymbol(symbol);
        expect(result.isScam).toBe(false);
      }
    });

    it('should be case-insensitive for URL patterns', () => {
      const result1 = detectScamFromSymbol('token.com');
      const result2 = detectScamFromSymbol('TOKEN.COM');
      const result3 = detectScamFromSymbol('ToKeN.CoM');

      expect(result1.isScam).toBe(true);
      expect(result2.isScam).toBe(true);
      expect(result3.isScam).toBe(true);
    });
  });

  describe('applyScamDetection', () => {
    it('should mark transaction as spam with isSpam flag and note for error severity', () => {
      const transaction: ProcessedTransaction = {
        datetime: new Date().toISOString(),
        externalId: 'tx-123',
        fees: [],
        movements: {
          inflows: [
            {
              asset: 'SCAM',
              grossAmount: parseDecimal('1000'),
            },
          ],
          outflows: [],
        },
        operation: {
          category: 'transfer',
          type: 'deposit',
        },
        source: 'ethereum',
        status: 'success',
        timestamp: Date.now(),
      };

      const scamNote = {
        message: '⚠️ Scam token detected',
        metadata: { scamReason: 'Test scam', scamAsset: 'SCAM' },
        severity: 'error' as const,
        type: 'SCAM_TOKEN' as const,
      };

      applyScamDetection(transaction, scamNote);

      expect(transaction.isSpam).toBe(true);
      expect(transaction.notes).toBeDefined();
      expect(transaction.notes?.[0]?.type).toBe('SCAM_TOKEN');
      expect(transaction.notes?.[0]?.message).toBe('⚠️ Scam token detected');
    });

    it('should NOT mark transaction as spam for warning severity (SUSPICIOUS_AIRDROP)', () => {
      const transaction: ProcessedTransaction = {
        datetime: new Date().toISOString(),
        externalId: 'tx-456',
        fees: [],
        movements: {
          inflows: [
            {
              asset: 'MAYBE_LEGIT',
              grossAmount: parseDecimal('1000'),
            },
          ],
          outflows: [],
        },
        operation: {
          category: 'transfer',
          type: 'deposit',
        },
        source: 'ethereum',
        status: 'success',
        timestamp: Date.now(),
      };

      const suspiciousNote = {
        message: '⚠️ Suspicious token: Unsolicited airdrop (verify legitimacy)',
        metadata: { indicators: ['Unsolicited airdrop (verify legitimacy)'] },
        severity: 'warning' as const,
        type: 'SUSPICIOUS_AIRDROP' as const,
      };

      applyScamDetection(transaction, suspiciousNote);

      // Should add note but NOT set isSpam flag
      expect(transaction.isSpam).toBeUndefined();
      expect(transaction.notes).toBeDefined();
      expect(transaction.notes?.[0]?.type).toBe('SUSPICIOUS_AIRDROP');
      expect(transaction.notes?.[0]?.severity).toBe('warning');
    });

    it('should mutate the transaction in place', () => {
      const transaction: ProcessedTransaction = {
        datetime: new Date().toISOString(),
        externalId: 'tx-123',
        fees: [],
        movements: {
          inflows: [],
          outflows: [],
        },
        operation: {
          category: 'transfer',
          type: 'deposit',
        },
        source: 'ethereum',
        status: 'success',
        timestamp: Date.now(),
      };

      const scamNote = {
        message: 'Scam detected',
        metadata: {},
        severity: 'error' as const,
        type: 'SCAM_TOKEN' as const,
      };

      const originalRef = transaction;
      applyScamDetection(transaction, scamNote);

      expect(transaction).toBe(originalRef);
      expect(transaction.isSpam).toBe(true);
    });

    it('should merge notes when transaction already has a note', () => {
      const transaction: ProcessedTransaction = {
        datetime: new Date().toISOString(),
        externalId: 'tx-789',
        fees: [],
        movements: {
          inflows: [],
          outflows: [],
        },
        notes: [
          {
            message: 'Existing classification note',
            metadata: { classification: 'deposit' },
            severity: 'info' as const,
            type: 'CLASSIFICATION',
          },
        ],
        operation: {
          category: 'transfer',
          type: 'deposit',
        },
        source: 'ethereum',
        status: 'success',
        timestamp: Date.now(),
      };

      const scamNote = {
        message: '⚠️ Scam token detected',
        metadata: { scamReason: 'Test scam' },
        severity: 'error' as const,
        type: 'SCAM_TOKEN' as const,
      };

      applyScamDetection(transaction, scamNote);

      expect(transaction.isSpam).toBe(true);
      expect(transaction.notes).toBeDefined();
      expect(transaction.notes).toHaveLength(2);
      expect(transaction.notes?.[0]?.message).toContain('Existing classification note');
      expect(transaction.notes?.[1]?.message).toContain('Scam token detected');
      expect(transaction.notes?.[1]?.severity).toBe('error');
    });
  });
});
