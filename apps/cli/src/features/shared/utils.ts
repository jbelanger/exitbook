/**
 * Shared CLI utilities.
 */

/**
 * Check if the provided options object has the json flag set to true.
 * Used for early detection of output format before full validation.
 */
export function isJsonMode(options: unknown): boolean {
  return (
    typeof options === 'object' && options !== null && 'json' in options && (options as { json: unknown }).json === true
  );
}
