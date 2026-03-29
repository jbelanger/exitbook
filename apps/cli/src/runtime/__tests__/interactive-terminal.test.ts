import { describe, expect, it } from 'vitest';

import { createNonInteractiveTuiError, isInteractiveTerminal } from '../interactive-terminal.js';

describe('isInteractiveTerminal', () => {
  it('returns true only when stdin and stdout are TTYs and CI is not set', () => {
    expect(isInteractiveTerminal({ stdinIsTTY: true, stdoutIsTTY: true, ci: false })).toBe(true);
    expect(isInteractiveTerminal({ stdinIsTTY: false, stdoutIsTTY: true, ci: false })).toBe(false);
    expect(isInteractiveTerminal({ stdinIsTTY: true, stdoutIsTTY: false, ci: false })).toBe(false);
    expect(isInteractiveTerminal({ stdinIsTTY: true, stdoutIsTTY: true, ci: true })).toBe(false);
  });
});

describe('createNonInteractiveTuiError', () => {
  it('explains why Ink cannot start', () => {
    const error = createNonInteractiveTuiError({ stdinIsTTY: true, stdoutIsTTY: false, ci: true });

    expect(error.message).toContain('stdout is not a TTY');
    expect(error.message).toContain('CI is set');
  });
});
