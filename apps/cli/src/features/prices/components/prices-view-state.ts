/**
 * Prices view TUI state
 */

import type {
  AssetBreakdownEntry,
  MissingPriceMovement,
  PriceCoverageDetail,
  ViewPricesResult,
} from '../prices-view-utils.js';

/**
 * Coverage mode state (read-only)
 */
export interface PricesViewCoverageState {
  mode: 'coverage';
  coverage: PriceCoverageDetail[];
  summary: ViewPricesResult['summary'];
  selectedIndex: number;
  scrollOffset: number;
  assetFilter?: string | undefined;
  sourceFilter?: string | undefined;
  /** Set by reducer when user presses Enter — picked up by useEffect to load missing data */
  drillDownAsset?: string | undefined;
  error?: string | undefined;
}

/**
 * Missing mode state (with inline set-price)
 */
export interface PricesViewMissingState {
  mode: 'missing';
  movements: MissingPriceMovement[];
  assetBreakdown: AssetBreakdownEntry[];
  selectedIndex: number;
  scrollOffset: number;
  resolvedRows: Set<string>;
  activeInput?:
    | { rowIndex: number; submitted?: boolean | undefined; validationError?: string | undefined; value: string }
    | undefined;
  assetFilter?: string | undefined;
  sourceFilter?: string | undefined;
  error?: string | undefined;
  /** When present, enables Esc-to-go-back to coverage mode */
  parentCoverageState?: PricesViewCoverageState | undefined;
}

/**
 * Discriminated union of coverage/missing state
 */
export type PricesViewState = PricesViewCoverageState | PricesViewMissingState;

/**
 * Create initial coverage view state
 */
export function createCoverageViewState(
  coverage: PriceCoverageDetail[],
  summary: ViewPricesResult['summary'],
  assetFilter?: string,
  sourceFilter?: string
): PricesViewCoverageState {
  return {
    mode: 'coverage',
    coverage,
    summary,
    selectedIndex: 0,
    scrollOffset: 0,
    assetFilter,
    sourceFilter,
  };
}

/**
 * Create initial missing view state
 */
export function createMissingViewState(
  movements: MissingPriceMovement[],
  assetBreakdown: AssetBreakdownEntry[],
  assetFilter?: string,
  sourceFilter?: string
): PricesViewMissingState {
  return {
    mode: 'missing',
    movements,
    assetBreakdown,
    selectedIndex: 0,
    scrollOffset: 0,
    resolvedRows: new Set(),
    activeInput: undefined,
    assetFilter,
    sourceFilter,
    error: undefined,
  };
}

/**
 * Build a unique key for a missing movement row.
 */
export function missingRowKey(movement: MissingPriceMovement): string {
  return `${movement.transactionId}:${movement.assetSymbol}:${movement.direction}`;
}
