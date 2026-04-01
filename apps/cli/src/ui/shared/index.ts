/**
 * Shared UI utilities for Ink-based command interfaces
 */

export { ApiFooter } from './api-footer.jsx';
export { Divider } from './divider.jsx';
export { createEventDrivenController, EventDrivenController, type LifecycleBridge } from './event-driven-controller.js';
export { EventRelay } from './event-relay.js';
export { FixedHeightDetail } from './fixed-height-detail.jsx';
export { createProviderStats, type ApiCallStats, type ProviderApiStats } from './api-stats-types.js';
export { formatDuration, formatWaitTime } from './format-duration.js';
export { SelectableRow } from './selectable-row.jsx';
export { StatusIcon, statusIcon, type OperationStatus } from './status-icon.jsx';
export { TreeChars } from './tree-chars.js';

export { buildTextTableHeader, buildTextTableRow, createColumns, type Columns } from './table-utils.js';
export { calculateChromeLines, calculateVisibleRows, conditionalLines } from './chrome-layout.js';
export { getSelectionCursor } from './selection-cursor.js';
