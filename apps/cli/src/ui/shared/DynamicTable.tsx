import { Box, Text } from 'ink';

import { getSelectionCursor } from './selection-cursor.js';
import { computeColumnWidths, padEnd, padStart } from './table-utils.js';

export interface TableColumn<T> {
  key: string;
  align?: 'left' | 'right';
  format: (item: T) => string;
  minWidth?: number | undefined;
}

export interface DynamicTableProps<T> {
  getRowKey: (item: T, index: number) => string;
  items: T[];
  selectedIndex: number;
  scrollOffset: number;
  visibleRows: number;
  columns: TableColumn<T>[];
}

/**
 * Shared dynamic-width table renderer for Ink list views.
 */
export function DynamicTable<T>({
  getRowKey,
  items,
  selectedIndex,
  scrollOffset,
  visibleRows,
  columns,
}: DynamicTableProps<T>) {
  const widths = computeColumnWidths(
    items,
    Object.fromEntries(
      columns.map((column) => [
        column.key,
        {
          format: (item: T) => column.format(item),
          minWidth: column.minWidth,
        },
      ])
    )
  );

  const startIndex = scrollOffset;
  const endIndex = Math.min(startIndex + visibleRows, items.length);
  const visible = items.slice(startIndex, endIndex);

  return (
    <Box flexDirection="column">
      {visible.map((item, windowIndex) => {
        const actualIndex = startIndex + windowIndex;
        const isSelected = actualIndex === selectedIndex;
        const cursor = getSelectionCursor(isSelected);
        const row = columns
          .map((column) => {
            const value = column.format(item);
            const width = widths[column.key] ?? value.length;
            return column.align === 'right' ? padStart(value, width) : padEnd(value, width);
          })
          .join('  ');

        return (
          <Text
            key={getRowKey(item, actualIndex)}
            bold={isSelected}
          >
            {cursor} {row}
          </Text>
        );
      })}
    </Box>
  );
}
