// Import prompt orchestration
// Separates interactive prompt flow from command logic

import type { ExchangeCredentials } from '@exitbook/core';
import { getBlockchainAdapter, type ImportParams } from '@exitbook/ingestion';

import {
  promptSourceType,
  promptExchange,
  promptImportMethod,
  promptCsvDirectory,
  promptConfirm,
  promptBlockchain,
  promptWalletAddress,
  promptProvider,
  isCancelled,
  handleCancellation,
} from '../shared/prompts.js';

/**
 * Interactive prompt flow for import parameters.
 * Orchestrates the full prompt sequence based on source type.
 * Returns normalized ImportParams (same as buildImportParams).
 */
export async function promptForImportParams(): Promise<ImportParams> {
  // Step 1: Source type
  const sourceType = await promptSourceType();

  // Step 2: Delegate to source-specific flow
  if (sourceType === 'exchange') {
    return await promptExchangeParams();
  } else {
    return await promptBlockchainParams();
  }
}

/**
 * Exchange-specific prompt flow.
 */
async function promptExchangeParams(): Promise<ImportParams> {
  // Select exchange
  const sourceName = await promptExchange();

  // Step 3: Import method (CSV or API)
  const importMethod = await promptImportMethod();

  if (importMethod === 'csv') {
    const csvDir = await promptCsvDirectory();
    return {
      sourceName,
      sourceType: 'exchange-csv',
      csvDirectory: csvDir,
    };
  } else {
    const credentials = await promptApiCredentials();
    return {
      sourceName,
      sourceType: 'exchange-api',
      credentials,
    };
  }
}

/**
 * Blockchain-specific prompt flow.
 */
async function promptBlockchainParams(): Promise<ImportParams> {
  // Select blockchain
  const sourceName = await promptBlockchain();

  // Step 3: Wallet address
  const address = await promptWalletAddress(sourceName);

  // Normalize address
  const blockchainAdapter = getBlockchainAdapter(sourceName.toLowerCase());
  if (!blockchainAdapter) {
    throw new Error(`Unknown blockchain: ${sourceName}`);
  }

  const normalizedAddressResult = blockchainAdapter.normalizeAddress(address);
  if (normalizedAddressResult.isErr()) {
    throw normalizedAddressResult.error;
  }

  // Step 4: Provider (optional)
  const providerName = await promptProvider(sourceName);

  return {
    sourceName,
    sourceType: 'blockchain',
    address: normalizedAddressResult.value,
    providerName,
  };
}

/**
 * Prompt for API credentials.
 */
async function promptApiCredentials(): Promise<ExchangeCredentials> {
  const apiKey = await import('@clack/prompts').then((p) =>
    p.text({
      message: 'API Key:',
      validate: (value) => (value ? undefined : 'API key is required'),
    })
  );

  if (isCancelled(apiKey)) {
    handleCancellation();
  }

  const apiSecret = await import('@clack/prompts').then((p) =>
    p.password({
      message: 'API Secret:',
      validate: (value) => (value ? undefined : 'API secret is required'),
    })
  );

  if (isCancelled(apiSecret)) {
    handleCancellation();
  }

  // Some exchanges need passphrase
  const needsPassphrase = await promptConfirm('Does this exchange require an API passphrase?', false);

  const credentials: ExchangeCredentials = {
    apiKey,
    apiSecret: apiSecret,
  };

  if (needsPassphrase) {
    const passphrase = await import('@clack/prompts').then((p) =>
      p.password({
        message: 'API Passphrase:',
        validate: (value) => (value ? undefined : 'API passphrase is required'),
      })
    );

    if (isCancelled(passphrase)) {
      handleCancellation();
    }

    credentials.apiPassphrase = passphrase;
  }

  return credentials;
}
