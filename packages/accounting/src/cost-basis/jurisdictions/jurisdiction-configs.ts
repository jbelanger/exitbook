import { err, ok, type Result } from '@exitbook/core';

import type { CostBasisConfig, FiatCurrency } from '../model/cost-basis-config.js';
import type { CostBasisMethodSupport, JurisdictionConfig } from '../model/types.js';

import { CANADA_JURISDICTION_CONFIG } from './canada/config.js';
import { US_COST_BASIS_METHODS, US_JURISDICTION_CONFIG } from './us/config.js';

export type CostBasisMethod = CostBasisConfig['method'];
export type CostBasisJurisdiction = CostBasisConfig['jurisdiction'];

export const SUPPORTED_COST_BASIS_FIAT_CURRENCIES: FiatCurrency[] = ['USD', 'CAD', 'EUR', 'GBP'];

/**
 * Predefined jurisdiction configurations for major tax jurisdictions.
 *
 * Policy differences:
 * - US (IRS): Same-asset transfer fees are treated as disposals, triggering capital gains/losses
 * - CA (CRA): Fees can be added to the adjusted cost base (ACB) of the asset, deferring taxation
 * - UK (HMRC): Fees may constitute disposals, similar to US treatment
 * - EU: Most member states treat fees as disposals, though individual countries may vary
 */
export const UK_JURISDICTION_CONFIG: JurisdictionConfig = {
  code: 'UK',
  label: 'United Kingdom (UK)',
  defaultCurrency: 'GBP',
  costBasisImplemented: false,
  supportedMethods: US_COST_BASIS_METHODS,
  sameAssetTransferFeePolicy: 'disposal',
  taxAssetIdentityPolicy: 'strict-onchain-tokens',
  relaxedTaxIdentitySymbols: [],
};

export const EU_JURISDICTION_CONFIG: JurisdictionConfig = {
  code: 'EU',
  label: 'European Union (EU)',
  defaultCurrency: 'EUR',
  costBasisImplemented: false,
  supportedMethods: US_COST_BASIS_METHODS,
  sameAssetTransferFeePolicy: 'disposal',
  taxAssetIdentityPolicy: 'strict-onchain-tokens',
  relaxedTaxIdentitySymbols: [],
};

const JURISDICTION_CONFIGS: Record<string, JurisdictionConfig> = {
  US: US_JURISDICTION_CONFIG,
  CA: CANADA_JURISDICTION_CONFIG,
  UK: UK_JURISDICTION_CONFIG,
  EU: EU_JURISDICTION_CONFIG,
};

/**
 * Retrieve jurisdiction configuration by code.
 *
 * @param code - Jurisdiction code (e.g., 'US', 'CA', 'UK', 'EU')
 * @returns JurisdictionConfig if found, undefined otherwise
 */
export function getJurisdictionConfig(code: string): JurisdictionConfig | undefined {
  return JURISDICTION_CONFIGS[code] ?? undefined;
}

function requireJurisdictionConfig(code: JurisdictionConfig['code']): Result<JurisdictionConfig, Error> {
  const config = getJurisdictionConfig(code);
  if (!config) {
    return err(new Error(`Jurisdiction config ${code} is not registered`));
  }

  return ok(config);
}

export function listCostBasisJurisdictionCapabilities(): JurisdictionConfig[] {
  return Object.values(JURISDICTION_CONFIGS);
}

export function listCostBasisMethodCapabilitiesForJurisdiction(
  jurisdiction: CostBasisJurisdiction
): Result<CostBasisMethodSupport[], Error> {
  const configResult = requireJurisdictionConfig(jurisdiction);
  if (configResult.isErr()) {
    return err(configResult.error);
  }
  return ok(configResult.value.supportedMethods);
}

export function getDefaultCostBasisCurrencyForJurisdiction(
  jurisdiction: CostBasisJurisdiction
): Result<FiatCurrency, Error> {
  const configResult = requireJurisdictionConfig(jurisdiction);
  if (configResult.isErr()) {
    return err(configResult.error);
  }
  return ok(configResult.value.defaultCurrency);
}

export function getDefaultCostBasisMethodForJurisdiction(
  jurisdiction: CostBasisJurisdiction
): Result<CostBasisMethod | undefined, Error> {
  const configResult = requireJurisdictionConfig(jurisdiction);
  if (configResult.isErr()) {
    return err(configResult.error);
  }
  return ok(configResult.value.defaultMethod);
}
