/**
 * Shared row cursor helpers for selected list rows.
 */

export const SELECTED_CURSOR = '\u25B8';
export const UNSELECTED_CURSOR = ' ';

export function getSelectionCursor(isSelected: boolean): string {
  return isSelected ? SELECTED_CURSOR : UNSELECTED_CURSOR;
}
