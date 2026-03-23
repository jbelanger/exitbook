import type { ExchangeCredentials } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/foundation';

/**
 * Get exchange credentials from environment variables.
 * Pure function that reads from process.env.
 */
export function getExchangeCredentialsFromEnv(exchangeName: string): Result<ExchangeCredentials, Error> {
  const upperName = exchangeName.toUpperCase();
  const apiKey = process.env[`${upperName}_API_KEY`];
  const apiSecret = process.env[`${upperName}_SECRET`];
  const apiPassphrase = process.env[`${upperName}_PASSPHRASE`];

  if (!apiKey || !apiSecret) {
    return err(new Error(`Missing ${upperName}_API_KEY or ${upperName}_SECRET in environment`));
  }

  const credentials: ExchangeCredentials = {
    apiKey,
    apiSecret: apiSecret,
  };

  if (apiPassphrase) {
    credentials.apiPassphrase = apiPassphrase;
  }

  return ok(credentials);
}

export function buildCliExchangeCredentials(options: {
  apiKey?: string | undefined;
  apiPassphrase?: string | undefined;
  apiSecret?: string | undefined;
}): ExchangeCredentials | undefined {
  if (!options.apiKey || !options.apiSecret) {
    return undefined;
  }

  return {
    apiKey: options.apiKey,
    apiSecret: options.apiSecret,
    ...(options.apiPassphrase && { apiPassphrase: options.apiPassphrase }),
  };
}
