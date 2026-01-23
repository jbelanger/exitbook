import * as p from '@clack/prompts';
import { parseDecimal } from '@exitbook/core';

import { handleCancellation, isCancelled } from '../shared/prompts.js';

import type { LinksRunHandlerParams } from './links-run-utils.js';

/**
 * Prompt user for links run parameters in interactive mode.
 */
export async function promptForLinksRunParams(): Promise<LinksRunHandlerParams> {
  // Ask if user wants to run in dry-run mode
  const dryRun = await p.confirm({
    message: 'Run in dry-run mode (preview matches without saving)?',
    initialValue: false,
  });

  if (isCancelled(dryRun)) {
    handleCancellation();
  }

  // Ask for minimum confidence threshold
  const minConfidenceInput = await p.text({
    message: 'Minimum confidence score (0-1, default: 0.7):',
    placeholder: '0.7',
    validate: (value: string) => {
      if (!value) return; // Allow empty for default
      const num = Number(value);
      if (Number.isNaN(num) || num < 0 || num > 1) {
        return 'Must be a number between 0 and 1';
      }
    },
  });

  if (isCancelled(minConfidenceInput)) {
    handleCancellation();
  }

  const minConfidenceScore = parseDecimal(minConfidenceInput ?? '0.7');

  // Ask for auto-confirm threshold
  const autoConfirmInput = await p.text({
    message: 'Auto-confirm threshold (0-1, default: 0.95):',
    placeholder: '0.95',
    validate: (value: string) => {
      if (!value) return; // Allow empty for default
      const num = Number(value);
      if (Number.isNaN(num) || num < 0 || num > 1) {
        return 'Must be a number between 0 and 1';
      }
      const minConfidence = Number(minConfidenceInput ?? '0.7');
      if (num < minConfidence) {
        return `Must be >= minimum confidence score (${minConfidence})`;
      }
    },
  });

  if (isCancelled(autoConfirmInput)) {
    handleCancellation();
  }

  const autoConfirmThreshold = parseDecimal(autoConfirmInput ?? '0.95');

  return {
    dryRun,
    minConfidenceScore,
    autoConfirmThreshold,
  };
}
