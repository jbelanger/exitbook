/**
 * Shared UI utilities for Ink-based command interfaces
 */

export { ApiFooter } from './ApiFooter.jsx';
export { Divider } from './Divider.jsx';
export { createEventDrivenController, EventDrivenController, type LifecycleBridge } from './event-driven-controller.js';
export { EventRelay } from './event-relay.js';
export { FixedHeightDetail, type FixedDetailRow, type FixedHeightDetailProps } from './fixed-height-detail.jsx';
export {
  createProviderStats,
  getOrCreateProviderStats,
  type ApiCallStats,
  type ProviderApiStats,
} from './api-stats-types.js';
export { ConfirmPrompt, type ConfirmPromptProps } from './ConfirmPrompt.jsx';
export { formatDuration, formatWaitTime } from './format-duration.js';
export { PromptFlow, type PromptStep } from './PromptFlow.jsx';
export { SelectableRow, type SelectableRowProps } from './SelectableRow.jsx';
export { SelectPrompt, type SelectPromptProps, type SelectOption } from './SelectPrompt.jsx';
export { StatusIcon, statusIcon, type OperationStatus } from './status-icon.jsx';
export { TextPrompt, type TextPromptProps } from './TextPrompt.jsx';
export { TreeChars } from './tree-chars.js';

export {
  computeColumnWidth,
  computeColumnWidths,
  createColumns,
  padEnd,
  padStart,
  type Columns,
} from './table-utils.js';
export {
  arrayLines,
  calculateChromeLines,
  calculateVisibleRows,
  conditionalLines,
  type ChromeSections,
  type SectionLineCounter,
} from './chrome-layout.js';
export { getSelectionCursor, SELECTED_CURSOR, UNSELECTED_CURSOR } from './selection-cursor.js';
