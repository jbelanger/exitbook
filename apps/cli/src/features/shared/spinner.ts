import ora, { type Ora } from 'ora';

/**
 * Spinner wrapper that provides a consistent interface around Ora.
 */
interface SpinnerWrapper {
  readonly ora: Ora;
}

/**
 * Create a spinner for text mode output.
 * Returns undefined in JSON mode.
 */
export function createSpinner(text: string, isJsonMode: boolean): SpinnerWrapper | undefined {
  if (isJsonMode) {
    return undefined;
  }

  const oraSpinner = ora(text).start();

  return { ora: oraSpinner };
}

/**
 * Complete a spinner with optional message (success or failure).
 * Safe to call with undefined spinner (no-op).
 */
function completeSpinner(
  spinner: SpinnerWrapper | undefined,
  message: string | undefined,
  method: 'succeed' | 'fail' | 'stop'
): void {
  if (!spinner) {
    return;
  }

  if (message && method !== 'stop') {
    spinner.ora[method](message);
  } else {
    spinner.ora.stop();
  }
}

/**
 * Stop a spinner and mark as succeeded.
 * Safe to call with undefined spinner (no-op).
 */
export function stopSpinner(spinner: SpinnerWrapper | undefined, message?: string): void {
  completeSpinner(spinner, message, 'succeed');
}

/**
 * Stop a spinner with a failure message.
 * Safe to call with undefined spinner (no-op).
 */
export function failSpinner(spinner: SpinnerWrapper | undefined, message?: string): void {
  completeSpinner(spinner, message, 'fail');
}
