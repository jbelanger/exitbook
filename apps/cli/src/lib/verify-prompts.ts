// Verify prompt orchestration
// Separates interactive prompt flow from command logic

import type { VerifyHandlerParams } from '../handlers/verify-handler.js';

import { promptBlockchain, promptConfirm, promptExchange, promptSourceType } from './prompts.js';

/**
 * Interactive prompt flow for verify parameters.
 * Orchestrates the full prompt sequence based on source type.
 */
export async function promptForVerifyParams(): Promise<VerifyHandlerParams> {
  // Step 1: Source type
  const sourceType = await promptSourceType();

  // Step 2: Source name (exchange or blockchain)
  const sourceName = sourceType === 'exchange' ? await promptExchange() : await promptBlockchain();

  // Step 3: Generate report?
  const generateReport = await promptConfirm('Generate detailed verification report?', false);

  return {
    sourceName,
    generateReport,
  };
}
