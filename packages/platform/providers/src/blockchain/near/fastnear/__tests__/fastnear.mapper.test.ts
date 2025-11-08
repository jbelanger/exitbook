/* eslint-disable unicorn/no-null -- FastNear API returns null for empty fields, tests must match actual API behavior */
import { describe, expect, it } from 'vitest';

import {
  extractNativeBalance,
  mapFastNearAccountData,
  mapFungibleTokens,
  mapNftContracts,
  mapStakingPools,
} from '../fastnear.mapper.js';
import type {
  FastNearAccountFullResponse,
  FastNearFungibleToken,
  FastNearNft,
  FastNearStakingPool,
} from '../fastnear.schemas.js';

describe('FastNear Mapper', () => {
  describe('mapFungibleTokens', () => {
    it('should map fungible tokens correctly', () => {
      const tokens: FastNearFungibleToken[] = [
        {
          balance: '1000000000000000000',
          contract_id: 'usdt.tether-token.near',
          last_update_block_height: 123456789,
        },
        {
          balance: '5000000',
          contract_id: 'usdc.near',
          last_update_block_height: 123456790,
        },
      ];

      const result = mapFungibleTokens(tokens);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        balance: '1000000000000000000',
        contractId: 'usdt.tether-token.near',
        lastUpdateBlockHeight: 123456789,
      });
      expect(result[1]).toEqual({
        balance: '5000000',
        contractId: 'usdc.near',
        lastUpdateBlockHeight: 123456790,
      });
    });

    it('should handle null tokens array', () => {
      const result = mapFungibleTokens(null);
      expect(result).toEqual([]);
    });

    it('should handle empty tokens array', () => {
      const result = mapFungibleTokens([]);
      expect(result).toEqual([]);
    });
  });

  describe('mapNftContracts', () => {
    it('should map NFT contracts correctly', () => {
      const nfts: FastNearNft[] = [
        {
          contract_id: 'paras-token-v2.near',
          last_update_block_height: 123456789,
        },
        {
          contract_id: 'nft.nearapac.near',
          last_update_block_height: 123456790,
        },
      ];

      const result = mapNftContracts(nfts);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        contractId: 'paras-token-v2.near',
        lastUpdateBlockHeight: 123456789,
      });
      expect(result[1]).toEqual({
        contractId: 'nft.nearapac.near',
        lastUpdateBlockHeight: 123456790,
      });
    });

    it('should handle null NFTs array', () => {
      const result = mapNftContracts(null);
      expect(result).toEqual([]);
    });

    it('should handle empty NFTs array', () => {
      const result = mapNftContracts([]);
      expect(result).toEqual([]);
    });
  });

  describe('mapStakingPools', () => {
    it('should map staking pools correctly', () => {
      const pools: FastNearStakingPool[] = [
        {
          last_update_block_height: 123456789,
          pool_id: 'astro-stakers.poolv1.near',
        },
        {
          last_update_block_height: 123456790,
          pool_id: 'figment.poolv1.near',
        },
      ];

      const result = mapStakingPools(pools);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        lastUpdateBlockHeight: 123456789,
        poolId: 'astro-stakers.poolv1.near',
      });
      expect(result[1]).toEqual({
        lastUpdateBlockHeight: 123456790,
        poolId: 'figment.poolv1.near',
      });
    });

    it('should handle null pools array', () => {
      const result = mapStakingPools(null);
      expect(result).toEqual([]);
    });

    it('should handle empty pools array', () => {
      const result = mapStakingPools([]);
      expect(result).toEqual([]);
    });
  });

  describe('extractNativeBalance', () => {
    it('should extract native balance correctly', () => {
      const accountState = {
        amount: '1000000000000000000000000',
      };

      const result = extractNativeBalance(accountState);

      expect(result).toEqual({
        decimalAmount: '1',
        rawAmount: '1000000000000000000000000',
      });
    });

    it('should handle large balance', () => {
      const accountState = {
        amount: '123456789000000000000000000',
      };

      const result = extractNativeBalance(accountState);

      expect(result).toEqual({
        decimalAmount: '123.456789',
        rawAmount: '123456789000000000000000000',
      });
    });

    it('should handle null account state', () => {
      const result = extractNativeBalance(null);
      expect(result).toBeUndefined();
    });

    it('should handle account state without amount', () => {
      const accountState = {};
      const result = extractNativeBalance(accountState);
      expect(result).toBeUndefined();
    });

    it('should handle zero balance', () => {
      const accountState = {
        amount: '0',
      };

      const result = extractNativeBalance(accountState);

      expect(result).toEqual({
        decimalAmount: '0',
        rawAmount: '0',
      });
    });
  });

  describe('mapFastNearAccountData', () => {
    it('should map complete account data successfully', () => {
      const rawData: FastNearAccountFullResponse = {
        account: {
          account_id: 'alice.near',
          amount: '5000000000000000000000000',
          block_hash: 'ABC123',
          block_height: 123456789,
          code_hash: '11111111111111111111111111111111',
          locked: '0',
          storage_paid_at: 0,
          storage_usage: 182,
        },
        ft: [
          {
            balance: '1000000',
            contract_id: 'usdt.tether-token.near',
            last_update_block_height: 123456789,
          },
        ],
        nft: [
          {
            contract_id: 'paras-token-v2.near',
            last_update_block_height: 123456789,
          },
        ],
        staking: [
          {
            last_update_block_height: 123456789,
            pool_id: 'astro-stakers.poolv1.near',
          },
        ],
      };

      const result = mapFastNearAccountData(rawData);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const balances = result.value;
        expect(balances.nativeBalance).toEqual({
          decimalAmount: '5',
          rawAmount: '5000000000000000000000000',
        });
        expect(balances.fungibleTokens).toHaveLength(1);
        expect(balances.fungibleTokens[0]).toEqual({
          balance: '1000000',
          contractId: 'usdt.tether-token.near',
          lastUpdateBlockHeight: 123456789,
        });
        expect(balances.nftContracts).toHaveLength(1);
        expect(balances.nftContracts[0]).toEqual({
          contractId: 'paras-token-v2.near',
          lastUpdateBlockHeight: 123456789,
        });
        expect(balances.stakingPools).toHaveLength(1);
        expect(balances.stakingPools[0]).toEqual({
          lastUpdateBlockHeight: 123456789,
          poolId: 'astro-stakers.poolv1.near',
        });
      }
    });

    it('should handle account with only native balance', () => {
      const rawData: FastNearAccountFullResponse = {
        account: {
          account_id: 'bob.near',
          amount: '2500000000000000000000000',
        },
        ft: null,
        nft: null,
        staking: null,
      };

      const result = mapFastNearAccountData(rawData);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const balances = result.value;
        expect(balances.nativeBalance).toEqual({
          decimalAmount: '2.5',
          rawAmount: '2500000000000000000000000',
        });
        expect(balances.fungibleTokens).toEqual([]);
        expect(balances.nftContracts).toEqual([]);
        expect(balances.stakingPools).toEqual([]);
      }
    });

    it('should handle account with only fungible tokens', () => {
      const rawData: FastNearAccountFullResponse = {
        account: null,
        ft: [
          {
            balance: '1000000',
            contract_id: 'usdc.near',
            last_update_block_height: 123456789,
          },
        ],
        nft: null,
        staking: null,
      };

      const result = mapFastNearAccountData(rawData);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const balances = result.value;
        expect(balances.nativeBalance).toBeUndefined();
        expect(balances.fungibleTokens).toHaveLength(1);
        expect(balances.nftContracts).toEqual([]);
        expect(balances.stakingPools).toEqual([]);
      }
    });

    it('should handle account with only NFTs', () => {
      const rawData: FastNearAccountFullResponse = {
        account: null,
        ft: null,
        nft: [
          {
            contract_id: 'nft.nearapac.near',
            last_update_block_height: 123456789,
          },
        ],
        staking: null,
      };

      const result = mapFastNearAccountData(rawData);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const balances = result.value;
        expect(balances.nativeBalance).toBeUndefined();
        expect(balances.fungibleTokens).toEqual([]);
        expect(balances.nftContracts).toHaveLength(1);
        expect(balances.stakingPools).toEqual([]);
      }
    });

    it('should handle empty account (all null)', () => {
      const rawData: FastNearAccountFullResponse = {
        account: null,
        ft: null,
        nft: null,
        staking: null,
      };

      const result = mapFastNearAccountData(rawData);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const balances = result.value;
        expect(balances.nativeBalance).toBeUndefined();
        expect(balances.fungibleTokens).toEqual([]);
        expect(balances.nftContracts).toEqual([]);
        expect(balances.stakingPools).toEqual([]);
      }
    });

    it('should handle multiple fungible tokens', () => {
      const rawData: FastNearAccountFullResponse = {
        account: null,
        ft: [
          {
            balance: '1000000',
            contract_id: 'usdt.tether-token.near',
            last_update_block_height: 123456789,
          },
          {
            balance: '5000000',
            contract_id: 'usdc.near',
            last_update_block_height: 123456790,
          },
          {
            balance: '250000000000000000000',
            contract_id: 'wrap.near',
            last_update_block_height: 123456791,
          },
        ],
        nft: null,
        staking: null,
      };

      const result = mapFastNearAccountData(rawData);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const balances = result.value;
        expect(balances.fungibleTokens).toHaveLength(3);
      }
    });

    it('should handle invalid data structure', () => {
      const invalidData = {
        account: {
          account_id: '',
        },
        ft: 'not-an-array',
        nft: null,
        staking: null,
      };

      const result = mapFastNearAccountData(invalidData as unknown as FastNearAccountFullResponse);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.type).toBe('error');
        if (result.error.type === 'error') {
          expect(result.error.message).toContain('Invalid FastNear account data');
        }
      }
    });

    it('should handle invalid fungible token structure', () => {
      const invalidData: FastNearAccountFullResponse = {
        account: null,
        ft: [
          {
            balance: '1000000',
            contract_id: '',
            last_update_block_height: 123456789,
          },
        ],
        nft: null,
        staking: null,
      };

      const result = mapFastNearAccountData(invalidData);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.type).toBe('error');
        if (result.error.type === 'error') {
          expect(result.error.message).toContain('Contract ID must not be empty');
        }
      }
    });

    it('should handle large balance values', () => {
      const rawData: FastNearAccountFullResponse = {
        account: {
          account_id: 'whale.near',
          amount: '999999999999999999999999999',
        },
        ft: null,
        nft: null,
        staking: null,
      };

      const result = mapFastNearAccountData(rawData);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const balances = result.value;
        expect(balances.nativeBalance?.rawAmount).toBe('999999999999999999999999999');
        // 999999999999999999999999999 yoctoNEAR / 10^24 = 999.999999999999999999999999 NEAR
        expect(balances.nativeBalance?.decimalAmount).toBe('999.999999999999999999999999');
      }
    });

    it('should preserve exact balance strings without modification', () => {
      const rawData: FastNearAccountFullResponse = {
        account: null,
        ft: [
          {
            balance: '123456789012345678901234567890',
            contract_id: 'token.near',
            last_update_block_height: 123456789,
          },
        ],
        nft: null,
        staking: null,
      };

      const result = mapFastNearAccountData(rawData);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const balances = result.value;
        expect(balances.fungibleTokens[0]?.balance).toBe('123456789012345678901234567890');
      }
    });
  });
});
