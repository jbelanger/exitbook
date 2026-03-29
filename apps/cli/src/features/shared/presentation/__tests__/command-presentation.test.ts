import { describe, expect, it } from 'vitest';

import {
  explorerPresentationSpec,
  resolvePresentationMode,
  snapshotPresentationSpec,
  workflowPresentationSpec,
} from '../command-presentation.js';

describe('resolvePresentationMode', () => {
  const interactive = { stdinIsTTY: true, stdoutIsTTY: true, ci: false } as const;
  const nonInteractive = { stdinIsTTY: true, stdoutIsTTY: false, ci: false } as const;

  it('prefers json over the role default', () => {
    expect(resolvePresentationMode(explorerPresentationSpec('accounts-view'), { json: true }, interactive)).toBe(
      'json'
    );
  });

  it('uses text override for explorer commands', () => {
    expect(resolvePresentationMode(explorerPresentationSpec('accounts-view'), { text: true }, interactive)).toBe(
      'text'
    );
  });

  it('uses the interactive default for explorer commands on a TTY', () => {
    expect(resolvePresentationMode(explorerPresentationSpec('accounts-view'), {}, interactive)).toBe('tui');
  });

  it('falls back to text for explorer commands off-terminal', () => {
    expect(resolvePresentationMode(explorerPresentationSpec('accounts-view'), {}, nonInteractive)).toBe('text');
  });

  it('keeps workflow commands on text-progress when text is requested', () => {
    expect(resolvePresentationMode(workflowPresentationSpec('import'), { text: true }, interactive)).toBe(
      'text-progress'
    );
  });

  it('rejects conflicting presentation flags', () => {
    expect(() =>
      resolvePresentationMode(explorerPresentationSpec('accounts-view'), { json: true, text: true }, interactive)
    ).toThrow('--json, --text, and --tui are mutually exclusive');
  });

  it('rejects tui for snapshot commands', () => {
    expect(() => resolvePresentationMode(snapshotPresentationSpec('accounts'), { tui: true }, interactive)).toThrow(
      '--tui is not supported for this command; use the explicit view command instead'
    );
  });
});
