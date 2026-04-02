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
function computeColumnWidth<T>(items: T[], formatter: (item: T) => string, minWidth = 0): number {
  let maxWidth = minWidth;

  for (const item of items) {
    const formatted = formatter(item);
    maxWidth = Math.max(maxWidth, formatted.length);
  }

  return maxWidth;
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
  alignments: Record<K, Align>;
  widths: Record<K, number>;
  format: (item: T) => Record<K, string>;
}

type TextTableColumnOrder<K extends string> = readonly K[];

interface TextTableOptions<K extends string> {
  alignments?: Partial<Record<K, Align>> | undefined;
  gap?: string | undefined;
}

/**
 * Compute column widths and return a formatter that produces pre-padded strings.
 *
 * Combines width computation + padding into a single step so callers don't need
 * separate width interfaces, getter functions, or manual padEnd/padStart calls.
 *
 * @example
 * ```ts
 * const columns = createColumns(items, {
 *   name:  { format: (i) => i.name, minWidth: 10 },
 *   count: { format: (i) => `${i.count}`, align: 'right', minWidth: 5 },
 * });
 * // In row component:
 * const { name, count } = columns.format(item);
 * ```
 */
export function createColumns<T, K extends string>(items: T[], defs: Record<K, ColumnDef<T>>): Columns<T, K> {
  const alignments = {} as Record<K, Align>;
  const widths = {} as Record<K, number>;
  const entries = Object.entries(defs) as [K, ColumnDef<T>][];

  for (const [key, def] of entries) {
    alignments[key] = def.align ?? 'left';
    const rawWidth = computeColumnWidth(items, def.format, def.minWidth ?? 0);
    widths[key] = def.maxWidth !== undefined ? Math.min(rawWidth, def.maxWidth) : rawWidth;
  }

  return {
    alignments,
    widths,
    format(item: T): Record<K, string> {
      const result = {} as Record<K, string>;
      for (const [key, def] of entries) {
        const raw = def.format(item);
        const width = widths[key];
        const clipped = raw.length > width ? raw.substring(0, width) : raw;
        result[key] = alignTablePart(clipped, width, alignments[key]);
      }
      return result;
    },
  };
}

export function buildTextTableHeader<K extends string>(
  widths: Record<K, number>,
  labels: Record<K, string>,
  order: TextTableColumnOrder<K>,
  options?: TextTableOptions<K>
): string {
  return joinTextTableParts(
    order.map((key) => alignTablePart(labels[key], widths[key], options?.alignments?.[key] ?? 'left')),
    options
  );
}

export function buildTextTableRow<K extends string>(
  formatted: Record<K, string>,
  order: TextTableColumnOrder<K>,
  options?: TextTableOptions<K>
): string {
  return joinTextTableParts(
    order.map((key) => formatted[key]),
    options
  );
}

function alignTablePart(value: string, width: number, align: Align): string {
  return align === 'right' ? value.padStart(width) : value.padEnd(width);
}

function joinTextTableParts(parts: string[], options?: { gap?: string | undefined }): string {
  return parts.join(options?.gap ?? ' ').trimEnd();
}
