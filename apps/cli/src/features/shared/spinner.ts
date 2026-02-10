import { configureLogger, resetLoggerContext, type Spinner } from '@exitbook/logger';
import ora, { type Ora } from 'ora';

/**
 * Spinner wrapper that makes Ora compatible with the logger's Spinner interface.
 */
interface SpinnerWrapper extends Spinner {
  readonly ora: Ora;
}

/**
 * Create a spinner for text mode output.
 * Returns undefined in JSON mode.
 *
 * The spinner integrates with the logger so that log messages
 * display properly during spinner animation.
 */
export function createSpinner(text: string, isJsonMode: boolean): SpinnerWrapper | undefined {
  if (isJsonMode) {
    // Configure logger for JSON mode to prevent console pollution
    configureLogger({
      mode: 'json',
      sinks: {
        structured: 'file',
      },
    });
    return undefined;
  }

  const oraSpinner = ora(text).start();

  // Wrap Ora to match the logger's Spinner interface
  const wrapper: SpinnerWrapper = {
    ora: oraSpinner,
    message: (msg: string) => {
      oraSpinner.text = msg;
    },
    start: (msg?: string) => {
      if (msg) {
        oraSpinner.text = msg;
      }
      oraSpinner.start();
    },
    stop: (msg?: string) => {
      if (msg) {
        oraSpinner.text = msg;
      }
      oraSpinner.stop();
    },
  };

  // Configure logger to work with spinner
  configureLogger({
    mode: 'text',
    spinner: wrapper,
    verbose: false,
    sinks: {
      ui: true,
      structured: 'off', // Avoid duplicate console output while spinner is active
    },
  });

  return wrapper;
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

  resetLoggerContext();
}

/**
 * Stop a spinner and reset logger context.
 * Safe to call with undefined spinner (no-op).
 */
export function stopSpinner(spinner: SpinnerWrapper | undefined, message?: string): void {
  completeSpinner(spinner, message, 'succeed');
}

/**
 * Stop a spinner with a failure message and reset logger context.
 * Safe to call with undefined spinner (no-op).
 */
export function failSpinner(spinner: SpinnerWrapper | undefined, message?: string): void {
  completeSpinner(spinner, message, 'fail');
}
