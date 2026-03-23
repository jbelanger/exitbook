import { assertOk } from '@exitbook/foundation/test-utils';
import { describe, expect, it } from 'vitest';

import {
  getDefaultCostBasisCurrencyForJurisdiction,
  getDefaultCostBasisMethodForJurisdiction,
  getJurisdictionConfig,
  listCostBasisJurisdictionCapabilities,
  listCostBasisMethodCapabilitiesForJurisdiction,
  SUPPORTED_COST_BASIS_FIAT_CURRENCIES,
} from '../jurisdiction-configs.js';

describe('jurisdiction-configs', () => {
  describe('getJurisdictionConfig coverage', () => {
    it('should have configs for all supported jurisdictions', () => {
      expect(getJurisdictionConfig('US')).toBeDefined();
      expect(getJurisdictionConfig('CA')).toBeDefined();
      expect(getJurisdictionConfig('UK')).toBeDefined();
      expect(getJurisdictionConfig('EU')).toBeDefined();
    });

    it('should have correct fee policies for US', () => {
      const config = getJurisdictionConfig('US');
      expect(config).toBeDefined();
      if (!config) return;
      expect(config.code).toBe('US');
      expect(config.label).toBe('United States (US)');
      expect(config.defaultCurrency).toBe('USD');
      expect(config.costBasisImplemented).toBe(true);
      expect(config.supportedMethods.map((method) => method.code)).toEqual(['fifo', 'lifo', 'specific-id']);
      expect(config.sameAssetTransferFeePolicy).toBe('disposal');
      expect(config.taxAssetIdentityPolicy).toBe('strict-onchain-tokens');
      expect(config.relaxedTaxIdentitySymbols).toEqual([]);
    });

    it('should have correct fee policies for CA', () => {
      const config = getJurisdictionConfig('CA');
      expect(config).toBeDefined();
      if (!config) return;
      expect(config.code).toBe('CA');
      expect(config.label).toBe('Canada (CA)');
      expect(config.defaultCurrency).toBe('CAD');
      expect(config.costBasisImplemented).toBe(true);
      expect(config.defaultMethod).toBe('average-cost');
      expect(config.supportedMethods.map((method) => method.code)).toEqual(['average-cost']);
      expect(config.sameAssetTransferFeePolicy).toBe('add-to-basis');
      expect(config.taxAssetIdentityPolicy).toBe('relaxed-stablecoin-symbols');
      expect(config.relaxedTaxIdentitySymbols).toEqual(['usdc']);
    });

    it('should have correct fee policies for UK', () => {
      const config = getJurisdictionConfig('UK');
      expect(config).toBeDefined();
      if (!config) return;
      expect(config.code).toBe('UK');
      expect(config.label).toBe('United Kingdom (UK)');
      expect(config.defaultCurrency).toBe('GBP');
      expect(config.costBasisImplemented).toBe(false);
      expect(config.supportedMethods.map((method) => method.code)).toEqual(['fifo', 'lifo', 'specific-id']);
      expect(config.sameAssetTransferFeePolicy).toBe('disposal');
      expect(config.taxAssetIdentityPolicy).toBe('strict-onchain-tokens');
      expect(config.relaxedTaxIdentitySymbols).toEqual([]);
    });

    it('should have correct fee policies for EU', () => {
      const config = getJurisdictionConfig('EU');
      expect(config).toBeDefined();
      if (!config) return;
      expect(config.code).toBe('EU');
      expect(config.label).toBe('European Union (EU)');
      expect(config.defaultCurrency).toBe('EUR');
      expect(config.costBasisImplemented).toBe(false);
      expect(config.supportedMethods.map((method) => method.code)).toEqual(['fifo', 'lifo', 'specific-id']);
      expect(config.sameAssetTransferFeePolicy).toBe('disposal');
      expect(config.taxAssetIdentityPolicy).toBe('strict-onchain-tokens');
      expect(config.relaxedTaxIdentitySymbols).toEqual([]);
    });
  });

  describe('getJurisdictionConfig', () => {
    it('should return config for valid jurisdiction code', () => {
      const config = getJurisdictionConfig('US');
      expect(config).toBeDefined();
      expect(config?.code).toBe('US');
      expect(config?.label).toBe('United States (US)');
      expect(config?.sameAssetTransferFeePolicy).toBe('disposal');
      expect(config?.taxAssetIdentityPolicy).toBe('strict-onchain-tokens');
      expect(config?.relaxedTaxIdentitySymbols).toEqual([]);
    });

    it('should return undefined for invalid jurisdiction code', () => {
      const config = getJurisdictionConfig('INVALID');
      expect(config).toBeUndefined();
    });

    it('should return undefined for empty string', () => {
      const config = getJurisdictionConfig('');
      expect(config).toBeUndefined();
    });

    it('should retrieve all jurisdictions correctly', () => {
      const us = getJurisdictionConfig('US');
      const ca = getJurisdictionConfig('CA');
      const uk = getJurisdictionConfig('UK');
      const eu = getJurisdictionConfig('EU');

      expect(us).not.toBeNull();
      expect(ca).not.toBeNull();
      expect(uk).not.toBeNull();
      expect(eu).not.toBeNull();

      expect(ca?.sameAssetTransferFeePolicy).toBe('add-to-basis');
      expect(us?.sameAssetTransferFeePolicy).toBe('disposal');
      expect(uk?.sameAssetTransferFeePolicy).toBe('disposal');
      expect(eu?.sameAssetTransferFeePolicy).toBe('disposal');
      expect(ca?.taxAssetIdentityPolicy).toBe('relaxed-stablecoin-symbols');
      expect(ca?.relaxedTaxIdentitySymbols).toEqual(['usdc']);
      expect(us?.taxAssetIdentityPolicy).toBe('strict-onchain-tokens');
      expect(uk?.taxAssetIdentityPolicy).toBe('strict-onchain-tokens');
      expect(eu?.taxAssetIdentityPolicy).toBe('strict-onchain-tokens');
      expect(us?.relaxedTaxIdentitySymbols).toEqual([]);
      expect(uk?.relaxedTaxIdentitySymbols).toEqual([]);
      expect(eu?.relaxedTaxIdentitySymbols).toEqual([]);
    });
  });

  describe('cost basis metadata helpers', () => {
    it('lists jurisdictions from the shared registry', () => {
      expect(listCostBasisJurisdictionCapabilities()).toEqual([
        getJurisdictionConfig('US'),
        getJurisdictionConfig('CA'),
        getJurisdictionConfig('UK'),
        getJurisdictionConfig('EU'),
      ]);
    });

    it('lists method capabilities from the shared registry', () => {
      const caResult = assertOk(listCostBasisMethodCapabilitiesForJurisdiction('CA'));
      expect(caResult.map((method) => method.code)).toEqual(['average-cost']);
      const usResult = assertOk(listCostBasisMethodCapabilitiesForJurisdiction('US'));
      expect(usResult.map((method) => method.code)).toEqual(['fifo', 'lifo', 'specific-id']);
    });

    it('returns default method and currency from the shared registry', () => {
      expect(assertOk(getDefaultCostBasisMethodForJurisdiction('CA'))).toBe('average-cost');
      expect(assertOk(getDefaultCostBasisMethodForJurisdiction('US'))).toBeUndefined();
      expect(assertOk(getDefaultCostBasisCurrencyForJurisdiction('CA'))).toBe('CAD');
      expect(assertOk(getDefaultCostBasisCurrencyForJurisdiction('US'))).toBe('USD');
    });

    it('keeps supported fiat currencies explicit and ordered', () => {
      expect(SUPPORTED_COST_BASIS_FIAT_CURRENCIES).toEqual(['USD', 'CAD', 'EUR', 'GBP']);
    });
  });
});
