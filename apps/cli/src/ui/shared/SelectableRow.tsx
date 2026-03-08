/**
 * Shared wrapper for selectable list rows.
 */

import { Text } from 'ink';
import type { FC, ReactNode } from 'react';

import { getSelectionCursor } from './selection-cursor.js';

export interface SelectableRowProps {
  children: ReactNode;
  dimWhenUnselected?: boolean | undefined;
  isSelected: boolean;
}

export const SelectableRow: FC<SelectableRowProps> = ({ children, dimWhenUnselected = false, isSelected }) => {
  return (
    <Text
      bold={isSelected}
      dimColor={dimWhenUnselected && !isSelected}
    >
      {getSelectionCursor(isSelected)} {children}
    </Text>
  );
};
