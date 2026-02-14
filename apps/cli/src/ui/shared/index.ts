/**
 * Shared UI utilities for Ink-based command interfaces
 */

export { ApiFooter } from './ApiFooter.js';
export { Divider } from './Divider.js';
export { createEventDrivenController, EventDrivenController, type LifecycleBridge } from './event-driven-controller.js';
export { EventRelay } from './event-relay.js';
export {
  createProviderStats,
  getOrCreateProviderStats,
  type ApiCallStats,
  type ProviderApiStats,
} from './api-stats-types.js';
export { ConfirmPrompt, type ConfirmPromptProps } from './ConfirmPrompt.js';
export { formatDuration, formatWaitTime } from './format-duration.js';
export { PromptFlow, type PromptStep } from './PromptFlow.js';
export { SelectPrompt, type SelectPromptProps, type SelectOption } from './SelectPrompt.js';
export { StatusIcon, statusIcon, type OperationStatus } from './status-icon.js';
export { TextPrompt, type TextPromptProps } from './TextPrompt.js';
export { TreeChars } from './tree-chars.js';

export { computeColumnWidth, computeColumnWidths, padEnd, padStart } from './table-utils.js';
export {
  arrayLines,
  calculateChromeLines,
  calculateVisibleRows,
  conditionalLines,
  type ChromeSections,
  type SectionLineCounter,
} from './chrome-layout.js';
export { getSelectionCursor, SELECTED_CURSOR, UNSELECTED_CURSOR } from './selection-cursor.js';
