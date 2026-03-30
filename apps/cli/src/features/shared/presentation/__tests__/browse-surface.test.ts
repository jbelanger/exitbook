import { describe, expect, it } from 'vitest';

import {
  collapseEmptyExplorerToStatic,
  explorerDetailSurfaceSpec,
  explorerListSurfaceSpec,
  resolveBrowsePresentation,
  staticListSurfaceSpec,
} from '../browse-surface.js';

describe('resolveBrowsePresentation', () => {
  const interactive = { stdinIsTTY: true, stdoutIsTTY: true, ci: false } as const;
  const nonInteractive = { stdinIsTTY: true, stdoutIsTTY: false, ci: false } as const;

  it('prefers json over the surface default', () => {
    expect(resolveBrowsePresentation(explorerListSurfaceSpec('accounts-view'), { json: true }, interactive)).toEqual({
      commandId: 'accounts-view',
      kind: 'explorer-list',
      mode: 'json',
      staticKind: 'list',
    });
  });

  it('uses tui for explorer list surfaces on an interactive terminal', () => {
    expect(resolveBrowsePresentation(explorerListSurfaceSpec('accounts-view'), {}, interactive)).toEqual({
      commandId: 'accounts-view',
      kind: 'explorer-list',
      mode: 'tui',
      staticKind: 'list',
    });
  });

  it('falls back to static detail off-terminal for explorer detail surfaces', () => {
    expect(resolveBrowsePresentation(explorerDetailSurfaceSpec('accounts-view'), {}, nonInteractive)).toEqual({
      commandId: 'accounts-view',
      kind: 'explorer-detail',
      mode: 'static',
      staticKind: 'detail',
    });
  });

  it('keeps static list surfaces on static mode even on a tty', () => {
    expect(resolveBrowsePresentation(staticListSurfaceSpec('accounts'), {}, interactive)).toEqual({
      commandId: 'accounts',
      kind: 'static-list',
      mode: 'static',
      staticKind: 'list',
    });
  });
});

describe('collapseEmptyExplorerToStatic', () => {
  it('downgrades empty explorer presentations to static', () => {
    const presentation = resolveBrowsePresentation(
      explorerListSurfaceSpec('accounts-view'),
      {},
      { stdinIsTTY: true, stdoutIsTTY: true, ci: false }
    );

    expect(collapseEmptyExplorerToStatic(presentation, { hasNavigableItems: false })).toEqual({
      commandId: 'accounts-view',
      kind: 'explorer-list',
      mode: 'static',
      staticKind: 'list',
    });
  });

  it('keeps non-empty explorer presentations on tui', () => {
    const presentation = resolveBrowsePresentation(
      explorerListSurfaceSpec('accounts-view'),
      {},
      { stdinIsTTY: true, stdoutIsTTY: true, ci: false }
    );

    expect(collapseEmptyExplorerToStatic(presentation, { hasNavigableItems: true })).toBe(presentation);
  });
});
