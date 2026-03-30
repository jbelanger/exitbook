import {
  isInteractiveTerminal,
  readTerminalInteractivitySnapshot,
  type TerminalInteractivitySnapshot,
} from '../../../runtime/interactive-terminal.js';

import type { PresentationMode } from './presentation-mode.js';

export type StaticSurfaceKind = 'list' | 'detail';

export type BrowseSurfaceKind = 'static-list' | 'static-detail' | 'explorer-list' | 'explorer-detail';

export interface BrowseSurfaceSpec {
  commandId: string;
  kind: BrowseSurfaceKind;
}

export interface ResolvedBrowsePresentation {
  commandId: string;
  kind: BrowseSurfaceKind;
  mode: Extract<PresentationMode, 'json' | 'static' | 'tui'>;
  staticKind: StaticSurfaceKind;
}

interface RawBrowseOptions {
  json?: boolean | undefined;
}

export interface ExplorerNavigability {
  hasNavigableItems: boolean;
  shouldCollapseEmptyExplorer: boolean;
}

export function staticListSurfaceSpec(commandId: string): BrowseSurfaceSpec {
  return {
    commandId,
    kind: 'static-list',
  };
}

export function staticDetailSurfaceSpec(commandId: string): BrowseSurfaceSpec {
  return {
    commandId,
    kind: 'static-detail',
  };
}

export function explorerListSurfaceSpec(commandId: string): BrowseSurfaceSpec {
  return {
    commandId,
    kind: 'explorer-list',
  };
}

export function explorerDetailSurfaceSpec(commandId: string): BrowseSurfaceSpec {
  return {
    commandId,
    kind: 'explorer-detail',
  };
}

export function resolveBrowsePresentation(
  spec: BrowseSurfaceSpec,
  rawOptions: unknown,
  snapshot: TerminalInteractivitySnapshot = readTerminalInteractivitySnapshot()
): ResolvedBrowsePresentation {
  const mode = readRawBrowseOptions(rawOptions).json === true ? 'json' : resolveHumanBrowseMode(spec, snapshot);

  return {
    commandId: spec.commandId,
    kind: spec.kind,
    mode,
    staticKind: getStaticSurfaceKind(spec.kind),
  };
}

export function collapseEmptyExplorerToStatic(
  presentation: ResolvedBrowsePresentation,
  navigability: ExplorerNavigability
): ResolvedBrowsePresentation {
  if (presentation.mode !== 'tui' || navigability.hasNavigableItems || !navigability.shouldCollapseEmptyExplorer) {
    return presentation;
  }

  return {
    ...presentation,
    mode: 'static',
  };
}

function resolveHumanBrowseMode(
  spec: BrowseSurfaceSpec,
  snapshot: TerminalInteractivitySnapshot
): Extract<PresentationMode, 'static' | 'tui'> {
  if (spec.kind === 'static-list' || spec.kind === 'static-detail') {
    return 'static';
  }

  return isInteractiveTerminal(snapshot) ? 'tui' : 'static';
}

function getStaticSurfaceKind(kind: BrowseSurfaceKind): StaticSurfaceKind {
  return kind === 'static-detail' || kind === 'explorer-detail' ? 'detail' : 'list';
}

function readRawBrowseOptions(rawOptions: unknown): RawBrowseOptions {
  // Defensive on purpose: this helper sits at the CLI boundary and accepts raw
  // option payloads from command handlers, even though current callers all come
  // from Commander-parsed objects.
  if (typeof rawOptions !== 'object' || rawOptions === null) {
    return {};
  }

  const options = rawOptions as Record<string, unknown>;

  return {
    json: options['json'] === true ? true : undefined,
  };
}
