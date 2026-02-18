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

// ─── createColumns ───────────────────────────────────────────────────────────

type Align = 'left' | 'right';

interface ColumnDef<T> {
  format: (item: T) => string;
  align?: Align | undefined;
  minWidth?: number | undefined;
  /** Hard cap: values longer than maxWidth are truncated before padding. */
  maxWidth?: number | undefined;
}

export interface Columns<T, K extends string> {
  widths: Record<K, number>;
  format: (item: T) => Record<K, string>;
}

/**
 * Compute column widths and return a formatter that produces pre-padded strings.
 *
 * Combines width computation + padding into a single step so callers don't need
 * separate width interfaces, getter functions, or manual padEnd/padStart calls.
 *
 * @example
 * ```ts
 * const cols = createColumns(items, {
 *   name:  { format: (i) => i.name, minWidth: 10 },
 *   count: { format: (i) => `${i.count}`, align: 'right', minWidth: 5 },
 * });
 * // In row component:
 * const { name, count } = cols.format(item);
 * ```
 */
export function createColumns<T, K extends string>(items: T[], defs: Record<K, ColumnDef<T>>): Columns<T, K> {
  const widths = {} as Record<K, number>;
  const entries = Object.entries(defs) as [K, ColumnDef<T>][];

  for (const [key, def] of entries) {
    const rawWidth = computeColumnWidth(items, def.format, def.minWidth ?? 0);
    widths[key] = def.maxWidth !== undefined ? Math.min(rawWidth, def.maxWidth) : rawWidth;
  }

  return {
    widths,
    format(item: T): Record<K, string> {
      const result = {} as Record<K, string>;
      for (const [key, def] of entries) {
        const raw = def.format(item);
        const width = widths[key];
        const clipped = raw.length > width ? raw.substring(0, width) : raw;
        result[key] = def.align === 'right' ? clipped.padStart(width) : clipped.padEnd(width);
      }
      return result;
    },
  };
}
