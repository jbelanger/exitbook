import { describe, expect, it } from 'vitest';

import {
  getDefaultCostBasisCurrencyForJurisdiction,
  getDefaultCostBasisMethodForJurisdiction,
  getJurisdictionConfig,
  JURISDICTION_CONFIGS,
  listCostBasisJurisdictionCapabilities,
  listCostBasisMethodCapabilitiesForJurisdiction,
  SUPPORTED_COST_BASIS_FIAT_CURRENCIES,
} from '../jurisdiction-configs.js';

describe('jurisdiction-configs', () => {
  describe('JURISDICTION_CONFIGS', () => {
    it('should have configs for all supported jurisdictions', () => {
      expect(JURISDICTION_CONFIGS['US']).toBeDefined();
      expect(JURISDICTION_CONFIGS['CA']).toBeDefined();
      expect(JURISDICTION_CONFIGS['UK']).toBeDefined();
      expect(JURISDICTION_CONFIGS['EU']).toBeDefined();
    });

    it('should have correct fee policies for US', () => {
      const config = JURISDICTION_CONFIGS['US'];
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
      const config = JURISDICTION_CONFIGS['CA'];
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
      const config = JURISDICTION_CONFIGS['UK'];
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
      const config = JURISDICTION_CONFIGS['EU'];
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
        JURISDICTION_CONFIGS['US'],
        JURISDICTION_CONFIGS['CA'],
        JURISDICTION_CONFIGS['UK'],
        JURISDICTION_CONFIGS['EU'],
      ]);
    });

    it('lists method capabilities from the shared registry', () => {
      expect(listCostBasisMethodCapabilitiesForJurisdiction('CA').map((method) => method.code)).toEqual([
        'average-cost',
      ]);
      expect(listCostBasisMethodCapabilitiesForJurisdiction('US').map((method) => method.code)).toEqual([
        'fifo',
        'lifo',
        'specific-id',
      ]);
    });

    it('returns default method and currency from the shared registry', () => {
      expect(getDefaultCostBasisMethodForJurisdiction('CA')).toBe('average-cost');
      expect(getDefaultCostBasisMethodForJurisdiction('US')).toBeUndefined();
      expect(getDefaultCostBasisCurrencyForJurisdiction('CA')).toBe('CAD');
      expect(getDefaultCostBasisCurrencyForJurisdiction('US')).toBe('USD');
    });

    it('keeps supported fiat currencies explicit and ordered', () => {
      expect(SUPPORTED_COST_BASIS_FIAT_CURRENCIES).toEqual(['USD', 'CAD', 'EUR', 'GBP']);
    });
  });
});
