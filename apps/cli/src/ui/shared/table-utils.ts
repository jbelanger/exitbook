/**
 * Utilities for dynamic table column width calculation.
 */

/**
 * Compute the maximum width needed for a column based on formatted values.
 *
 * @param items - The items to measure
 * @param formatter - Function that formats an item to a string for this column
 * @param minWidth - Minimum width for the column
 * @returns The maximum width needed
 *
 * @example
 * ```ts
 * const widths = {
 *   value: computeColumnWidth(positions, (p) => formatCurrency(p.value, 'USD'), 'USD 0.00'.length),
 *   allocation: computeColumnWidth(positions, (p) => p.allocationPct ? `${p.allocationPct}%` : '--', 3),
 * };
 * ```
 */
export function computeColumnWidth<T>(items: T[], formatter: (item: T) => string, minWidth = 0): number {
  let maxWidth = minWidth;

  for (const item of items) {
    const formatted = formatter(item);
    maxWidth = Math.max(maxWidth, formatted.length);
  }

  return maxWidth;
}

/**
 * Compute widths for multiple columns at once.
 *
 * @param items - The items to measure
 * @param columnDefs - Column definitions with formatters and min widths
 * @returns Object with computed widths for each column
 *
 * @example
 * ```ts
 * const widths = computeColumnWidths(positions, {
 *   value: { format: (p) => formatCurrency(p.value, 'USD'), minWidth: 'USD 0.00'.length },
 *   allocation: { format: (p) => p.pct ? `${p.pct}%` : '--', minWidth: 3 },
 * });
 * // widths.value === 12
 * // widths.allocation === 5
 * ```
 */
export function computeColumnWidths<T, K extends string>(
  items: T[],
  columnDefs: Record<K, { format: (item: T) => string; minWidth?: number | undefined }>
): Record<K, number> {
  const result = {} as Record<K, number>;

  for (const [key, def] of Object.entries(columnDefs) as [
    K,
    { format: (item: T) => string; minWidth?: number | undefined },
  ][]) {
    result[key] = computeColumnWidth(items, def.format, def.minWidth ?? 0);
  }

  return result;
}

/**
 * Pad a string to a specific width (right-aligned).
 *
 * @param value - The string to pad
 * @param width - The target width
 * @returns The padded string
 */
export function padStart(value: string, width: number): string {
  return value.padStart(width);
}

/**
 * Pad a string to a specific width (left-aligned).
 *
 * @param value - The string to pad
 * @param width - The target width
 * @returns The padded string
 */
export function padEnd(value: string, width: number): string {
  return value.padEnd(width);
}
