export interface TerminalInteractivitySnapshot {
  readonly stdinIsTTY: boolean;
  readonly stdoutIsTTY: boolean;
  readonly ci: boolean;
}

export class NonInteractiveTuiError extends Error {
  constructor(snapshot: TerminalInteractivitySnapshot) {
    super(buildNonInteractiveTuiMessage(snapshot));
    this.name = 'NonInteractiveTuiError';
  }
}

export function readTerminalInteractivitySnapshot(): TerminalInteractivitySnapshot {
  return {
    stdinIsTTY: process.stdin.isTTY === true,
    stdoutIsTTY: process.stdout.isTTY === true,
    ci: Boolean(process.env['CI']),
  };
}

export function isInteractiveTerminal(
  snapshot: TerminalInteractivitySnapshot = readTerminalInteractivitySnapshot()
): boolean {
  return snapshot.stdinIsTTY && snapshot.stdoutIsTTY && !snapshot.ci;
}

export function createNonInteractiveTuiError(
  snapshot: TerminalInteractivitySnapshot = readTerminalInteractivitySnapshot()
): NonInteractiveTuiError {
  return new NonInteractiveTuiError(snapshot);
}

function buildNonInteractiveTuiMessage(snapshot: TerminalInteractivitySnapshot): string {
  const reasons: string[] = [];

  if (!snapshot.stdinIsTTY) {
    reasons.push('stdin is not a TTY');
  }

  if (!snapshot.stdoutIsTTY) {
    reasons.push('stdout is not a TTY');
  }

  if (snapshot.ci) {
    reasons.push('CI is set');
  }

  const reasonText = reasons.length > 0 ? ` (${reasons.join(', ')})` : '';

  return `Interactive TUI requires a terminal${reasonText}. Re-run in a terminal, or use a non-interactive output mode when available.`;
}
