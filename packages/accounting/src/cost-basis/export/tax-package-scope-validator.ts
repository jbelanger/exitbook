import { err, ok, type Result } from '@exitbook/foundation';

import { getDefaultDateRange } from '../model/cost-basis-config.js';

import type { TaxPackageConfigScope } from './tax-package-types.js';

export type TaxPackageScopeValidationErrorCode =
  | 'PARTIAL_SCOPE'
  | 'UNSUPPORTED_JURISDICTION'
  | 'UNSUPPORTED_METHOD_FOR_JURISDICTION';

export interface TaxPackageScopeRequest {
  config: TaxPackageConfigScope;
  asset?: string | undefined;
  hasCustomDateWindow?: boolean | undefined;
}

export interface TaxPackageValidatedScope extends TaxPackageScopeRequest {
  asset?: undefined;
  filingScope: 'full_tax_year';
  requiredEndDate: Date;
  requiredStartDate: Date;
}

export class TaxPackageScopeValidationError extends Error {
  constructor(
    readonly code: TaxPackageScopeValidationErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'TaxPackageScopeValidationError';
  }
}

export function validateTaxPackageScope(
  request: TaxPackageScopeRequest
): Result<TaxPackageValidatedScope, TaxPackageScopeValidationError> {
  const jurisdictionValidation = validateSupportedJurisdiction(request);
  if (jurisdictionValidation.isErr()) {
    return err(jurisdictionValidation.error);
  }

  const methodValidation = validateSupportedMethod(request);
  if (methodValidation.isErr()) {
    return err(methodValidation.error);
  }

  if (request.asset) {
    return err(
      new TaxPackageScopeValidationError(
        'PARTIAL_SCOPE',
        `Tax package export requires a full filing scope and does not support --asset (${request.asset}).`
      )
    );
  }

  if (request.hasCustomDateWindow) {
    return err(
      new TaxPackageScopeValidationError(
        'PARTIAL_SCOPE',
        'Tax package export does not support custom date windows in v1. Use the full default tax-year scope.'
      )
    );
  }

  const requiredRange = getDefaultDateRange(request.config.taxYear, request.config.jurisdiction);
  if (
    request.config.startDate.getTime() !== requiredRange.startDate.getTime() ||
    request.config.endDate.getTime() !== requiredRange.endDate.getTime()
  ) {
    return err(
      new TaxPackageScopeValidationError(
        'PARTIAL_SCOPE',
        'Tax package export requires the full default tax-year date range for the selected jurisdiction.'
      )
    );
  }

  return ok({
    config: request.config,
    ...(request.hasCustomDateWindow ? { hasCustomDateWindow: request.hasCustomDateWindow } : {}),
    filingScope: 'full_tax_year',
    requiredStartDate: requiredRange.startDate,
    requiredEndDate: requiredRange.endDate,
  });
}

function validateSupportedJurisdiction(request: TaxPackageScopeRequest): Result<void, TaxPackageScopeValidationError> {
  if (request.config.jurisdiction === 'CA' || request.config.jurisdiction === 'US') {
    return ok(undefined);
  }

  return err(
    new TaxPackageScopeValidationError(
      'UNSUPPORTED_JURISDICTION',
      `Tax package export currently supports only CA and US. Received '${request.config.jurisdiction}'.`
    )
  );
}

function validateSupportedMethod(request: TaxPackageScopeRequest): Result<void, TaxPackageScopeValidationError> {
  if (request.config.jurisdiction === 'CA' && request.config.method !== 'average-cost') {
    return err(
      new TaxPackageScopeValidationError(
        'UNSUPPORTED_METHOD_FOR_JURISDICTION',
        `Canada tax package export requires average-cost. Received '${request.config.method}'.`
      )
    );
  }

  if (request.config.jurisdiction === 'US' && request.config.method === 'average-cost') {
    return err(
      new TaxPackageScopeValidationError(
        'UNSUPPORTED_METHOD_FOR_JURISDICTION',
        'US tax package export does not support average-cost.'
      )
    );
  }

  return ok(undefined);
}
