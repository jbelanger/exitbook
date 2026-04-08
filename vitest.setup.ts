// Runs before any test module is imported. Two environment tweaks keep the
// CLI's terminal-aware code paths deterministic under both local and CI runs:
//
// 1. `delete process.env.CI` — picocolors enables ANSI output whenever `CI` is
//    in the environment (captured once at module import), which makes
//    `stringContaining` assertions against rendered text fail in CI.
// 2. `NO_COLOR=1` — belt-and-braces: any other color library we pull in will
//    also respect this and stay monochrome.
//
// Clearing `CI` here also prevents `isInteractiveTerminal()` from being
// sabotaged in CI when a test only flips `process.stdin.isTTY` / `stdout.isTTY`.
delete process.env.CI;
process.env.NO_COLOR = '1';
