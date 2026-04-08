/**
 * Helpers for tests that exercise terminal-aware code paths (Ink mounting,
 * static fallback rendering, etc.).
 *
 * `isInteractiveTerminal()` checks `stdin.isTTY && stdout.isTTY && !CI`, so
 * tests that want to simulate "user is at an interactive terminal" need to
 * flip both isTTY flags AND clear `CI`. Forgetting any one of these is the
 * usual cause of "passes locally, fails in CI" flakes.
 *
 * `vitest.setup.ts` already deletes `process.env.CI` once at worker startup,
 * but we re-delete here so the helper is self-sufficient and can't be undone
 * by an earlier test that set `CI` for some other reason.
 */
export function setTerminalInteractivity(isInteractive: boolean): void {
  Object.defineProperty(process.stdin, 'isTTY', {
    configurable: true,
    value: isInteractive,
  });
  Object.defineProperty(process.stdout, 'isTTY', {
    configurable: true,
    value: isInteractive,
  });
  delete process.env['CI'];
}

/**
 * Snapshot the current `isTTY` descriptors for `stdin` and `stdout` so a test
 * can restore them after fiddling. Pair with `restoreTerminalInteractivity`.
 */
export function captureTerminalInteractivity(): {
  stdin: PropertyDescriptor | undefined;
  stdout: PropertyDescriptor | undefined;
} {
  return {
    stdin: Object.getOwnPropertyDescriptor(process.stdin, 'isTTY'),
    stdout: Object.getOwnPropertyDescriptor(process.stdout, 'isTTY'),
  };
}

export function restoreTerminalInteractivity(snapshot: {
  stdin: PropertyDescriptor | undefined;
  stdout: PropertyDescriptor | undefined;
}): void {
  if (snapshot.stdin) {
    Object.defineProperty(process.stdin, 'isTTY', snapshot.stdin);
  }
  if (snapshot.stdout) {
    Object.defineProperty(process.stdout, 'isTTY', snapshot.stdout);
  }
}
