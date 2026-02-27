import { describe, expect, it } from 'vitest';

import { JURISDICTION_CONFIGS, getJurisdictionConfig } from '../jurisdiction-configs.js';

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
      expect(config.sameAssetTransferFeePolicy).toBe('disposal');
    });

    it('should have correct fee policies for CA', () => {
      const config = JURISDICTION_CONFIGS['CA'];
      expect(config).toBeDefined();
      if (!config) return;
      expect(config.code).toBe('CA');
      expect(config.sameAssetTransferFeePolicy).toBe('add-to-basis');
    });

    it('should have correct fee policies for UK', () => {
      const config = JURISDICTION_CONFIGS['UK'];
      expect(config).toBeDefined();
      if (!config) return;
      expect(config.code).toBe('UK');
      expect(config.sameAssetTransferFeePolicy).toBe('disposal');
    });

    it('should have correct fee policies for EU', () => {
      const config = JURISDICTION_CONFIGS['EU'];
      expect(config).toBeDefined();
      if (!config) return;
      expect(config.code).toBe('EU');
      expect(config.sameAssetTransferFeePolicy).toBe('disposal');
    });
  });

  describe('getJurisdictionConfig', () => {
    it('should return config for valid jurisdiction code', () => {
      const config = getJurisdictionConfig('US');
      expect(config).toBeDefined();
      expect(config?.code).toBe('US');
      expect(config?.sameAssetTransferFeePolicy).toBe('disposal');
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
    });
  });
});
