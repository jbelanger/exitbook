import * as p from '@clack/prompts';
import { Decimal } from 'decimal.js';

import { handleCancellation, isCancelled } from '../shared/prompts.ts';

import type { LinkHandlerParams } from './link-utils.ts';

/**
 * Prompt user for link parameters in interactive mode.
 */
export async function promptForLinkParams(): Promise<LinkHandlerParams> {
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

  const minConfidenceScore = new Decimal(minConfidenceInput || '0.7');

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
      const minConfidence = Number(minConfidenceInput || '0.7');
      if (num < minConfidence) {
        return `Must be >= minimum confidence score (${minConfidence})`;
      }
    },
  });

  if (isCancelled(autoConfirmInput)) {
    handleCancellation();
  }

  const autoConfirmThreshold = new Decimal(autoConfirmInput || '0.95');

  return {
    dryRun,
    minConfidenceScore,
    autoConfirmThreshold,
  };
}
