// Process prompt orchestration
// Separates interactive prompt flow from command logic

import * as p from '@clack/prompts';

import {
  promptSourceType,
  promptExchange,
  promptBlockchain,
  promptConfirm,
  isCancelled,
  handleCancellation,
} from '../shared/prompts.ts';

import type { ProcessHandlerParams } from './process-utils.ts';

/**
 * Interactive prompt flow for process parameters.
 * Orchestrates the full prompt sequence based on source type.
 */
export async function promptForProcessParams(): Promise<ProcessHandlerParams> {
  // Step 1: Source type
  const sourceType = await promptSourceType();

  // Step 2: Source name (exchange or blockchain)
  const sourceName = sourceType === 'exchange' ? await promptExchange() : await promptBlockchain();

  // Step 3: Filter options
  const useFilters = await promptConfirm('Apply filters?', false);

  const filters: { createdAfter?: number; dataSourceId?: number } = {};

  if (useFilters) {
    // Session ID filter
    const useSessionFilter = await promptConfirm('Filter by data source ?', false);
    if (useSessionFilter) {
      const sessionId = await p.text({
        message: 'Import session ID:',
        placeholder: '123',
        validate: (value) => {
          if (!value) return; // Optional
          const num = parseInt(value, 10);
          if (isNaN(num) || num <= 0) return 'Must be a positive integer';
        },
      });

      if (isCancelled(sessionId)) {
        handleCancellation();
      }

      if (sessionId) {
        filters.dataSourceId = parseInt(sessionId, 10);
      }
    }
  }

  return {
    sourceName,
    sourceType,
    filters,
  };
}
