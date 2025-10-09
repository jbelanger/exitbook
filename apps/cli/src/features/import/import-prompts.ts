// Import prompt orchestration
// Separates interactive prompt flow from command logic

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
} from '../shared/prompts.ts';

import type { ImportHandlerParams } from './import-handler.ts';

/**
 * Interactive prompt flow for import parameters.
 * Orchestrates the full prompt sequence based on source type.
 */
export async function promptForImportParams(): Promise<ImportHandlerParams> {
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
async function promptExchangeParams(): Promise<ImportHandlerParams> {
  // Select exchange
  const sourceName = await promptExchange();

  // Step 3: Import method (CSV or API)
  const importMethod = await promptImportMethod();

  let csvDir: string | undefined;
  let credentials: { apiKey: string; apiPassphrase?: string | undefined; secret: string } | undefined;

  if (importMethod === 'csv') {
    csvDir = await promptCsvDirectory();
  } else {
    credentials = await promptApiCredentials();
  }

  // Step 5: Process after import?
  const shouldProcess = await promptConfirm('Process data after import?', true);

  return {
    sourceName,
    sourceType: 'exchange',
    csvDir,
    credentials,
    shouldProcess,
  };
}

/**
 * Blockchain-specific prompt flow.
 */
async function promptBlockchainParams(): Promise<ImportHandlerParams> {
  // Select blockchain
  const sourceName = await promptBlockchain();

  // Step 3: Wallet address
  const address = await promptWalletAddress(sourceName);

  // Step 4: Provider (optional)
  const providerId = await promptProvider(sourceName);

  // Step 5: Process after import?
  const shouldProcess = await promptConfirm('Process data after import?', true);

  return {
    sourceName,
    sourceType: 'blockchain',
    address,
    providerId,
    shouldProcess,
  };
}

/**
 * Prompt for API credentials.
 */
async function promptApiCredentials(): Promise<{
  apiKey: string;
  apiPassphrase?: string | undefined;
  secret: string;
}> {
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

  let apiPassphrase: string | undefined;
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

    apiPassphrase = passphrase;
  }

  return {
    apiKey,
    secret: apiSecret,
    apiPassphrase,
  };
}
