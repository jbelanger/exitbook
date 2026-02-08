# Commander.js to oclif Migration Plan

## Context

**Problem**: The CLI currently uses Commander.js for command parsing, with manual JSON/text mode handling, dual error patterns (OutputManager + displayCliError), and 500+ lines of custom boilerplate. The codebase is mid-migration from @clack/prompts to Ink for rendering.

**Why Change**: oclif provides built-in --json flag support, standardized error handling, auto-generated help, TypeScript-first design, and eliminates the custom OutputManager/error handling code. With 13 command groups and 30+ subcommands, exitbook is in oclif's sweet spot for complex CLI applications.

**Key Insight**: oclif handles CLI structure/parsing/flags (replaces Commander), while Ink handles rendering (complements existing UI). They don't overlap - oclif would integrate with existing Ink components (PromptFlow, LinksRunMonitor, LinksViewApp, IngestionMonitor).

**Current State**:

- Migrated to Ink: links, import, reprocess (use PromptFlow, IngestionMonitor)
- Still using OutputManager: balance, prices, export, clear, transactions, accounts, cost-basis, list-blockchains
- All commands use Commander.js + manual Zod validation

## Approach: Two-Phase Migration (SELECTED)

**Phase 1: Complete Ink Migration (Week 1-2)**

- Migrate remaining commands from OutputManager to Ink pattern (balance, prices, export, clear, transactions, accounts, cost-basis, list-blockchains)
- Eliminates dual display patterns before introducing oclif
- Establishes consistent rendering layer across all commands
- Less rework (avoid touching commands twice)

**Phase 2: Migrate to oclif (Week 3-6)**

- With consistent Ink-based display layer in place
- Focus solely on command structure migration (Commander → oclif)
- Lower risk for financial system (incremental changes)
- Clearer validation of oclif integration patterns

**Why this approach**: Separating concerns (display layer vs CLI framework) reduces complexity and risk. After Phase 1, we'll have a single rendering pattern (Ink), making oclif integration straightforward.

## Implementation Plan

### Phase 1: Complete Ink Migration (Weeks 1-2)

**Goal**: Migrate all remaining commands from OutputManager + @clack/prompts to Ink pattern, establishing a consistent display layer.

**Commands to migrate**:

- `balance` - Uses OutputManager spinner + table display
- `prices view` - Uses OutputManager + table formatting
- `prices enrich` - Uses OutputManager spinner + progress
- `prices set` - Uses OutputManager + prompts
- `prices set-fx` - Uses OutputManager + prompts
- `export` - Uses OutputManager spinner + success message
- `clear` - Uses OutputManager + confirmation prompt
- `transactions view` - Uses OutputManager + table display
- `accounts view` - Uses OutputManager + table display
- `cost-basis` - Uses OutputManager + table display

**Pattern to follow** (from migrated commands):

1. Replace `OutputManager` with direct Ink rendering
2. Use `PromptFlow` for sequential prompts (replacing @clack/prompts)
3. Configure logger early with mode ('json' | 'text')
4. Use `displayCliError()` for validation errors
5. Handle SIGINT gracefully for long-running operations
6. Support both JSON and text modes

**Example migration** (balance command):

**Before** (OutputManager pattern):

```typescript
const output = new OutputManager(options.json ? 'json' : 'text');
const spinner = output.spinner();
spinner.start('Fetching balances...');
const result = await fetchBalances();
spinner.stop('Balances fetched');
output.table(result);
```

**After** (Ink pattern):

```typescript
const useInk = !options.json;
configureLogger({ mode: options.json ? 'json' : 'text' });

if (useInk) {
  // Render Ink component for progress/display
  render(React.createElement(BalanceMonitor, { onComplete: handleResult }));
} else {
  // JSON mode - direct execution
  const result = await fetchBalances();
  console.log(JSON.stringify({ balances: result }));
}
```

**Deliverable**: All commands use consistent Ink pattern, OutputManager class removed.

### Phase 2: Migrate to oclif (Weeks 3-6)

### Prerequisites

- [ ] Phase 1 complete (all commands use Ink)
- [ ] Add integration tests for current CLI behavior
- [ ] Document all command signatures and examples
- [ ] Create feature branch: `feat/oclif-migration`

### Step 1: Add oclif Dependencies (1 day)

**File**: `/Users/joel/Dev/exitbook/apps/cli/package.json`

```bash
pnpm add @oclif/core
pnpm remove commander
```

Add oclif configuration:

```json
{
  "oclif": {
    "bin": "exitbook",
    "dirname": "exitbook",
    "commands": "./dist/commands",
    "topicSeparator": " "
  }
}
```

Create entry points:

- `bin/run.js` - Production entry point
- `bin/dev.js` - Development entry point (tsx)

### Step 2: Create Command Directory Structure (1 day)

**New structure**: `src/commands/` with oclif convention

```
src/
  commands/
    links/
      run.ts          # class LinksRun extends Command
      view.ts
      confirm.ts
      reject.ts
    prices/
      view.ts
      enrich.ts
      set.ts
      set-fx.ts
    import.ts
    balance.ts
    export.ts
    reprocess.ts
    clear.ts
    list-blockchains.ts
    benchmark-rate-limit.ts
    accounts/
      view.ts
    transactions/
      view.ts
    cost-basis.ts
```

**Keep existing**:

- `src/handlers/` - Business logic (unchanged)
- `src/utils/` - Pure functions (unchanged)
- `src/ui/` - Ink components (unchanged)

### Step 3: Migrate Simple Commands First (2-3 days)

Start with stateless, non-interactive commands as proof of concept.

**Example**: `list-blockchains` command

**Current**: `/Users/joel/Dev/exitbook/apps/cli/src/features/list-blockchains/list-blockchains.ts`

**New**: `src/commands/list-blockchains.ts`

```typescript
import { Command } from '@oclif/core';
import { getAvailableBlockchains } from '@exitbook/blockchain-providers';

export default class ListBlockchains extends Command {
  static description = 'List supported blockchain networks';

  static enableJsonFlag = true; // Built-in --json support

  async run(): Promise<unknown> {
    const blockchains = getAvailableBlockchains();

    if (this.jsonEnabled()) {
      return { blockchains };
    }

    // Text mode - format output
    this.log('Supported blockchains:');
    blockchains.forEach((chain) => this.log(`  - ${chain}`));

    return { blockchains };
  }
}
```

**Commands to migrate first**:

1. `list-blockchains` (simplest - just data listing)
2. `clear` (simple - confirmation + action)
3. `balance` (data display with options)

### Step 4: Migrate Interactive Commands (3-4 days)

**Example**: `links run` with Ink integration

**Current**: `/Users/joel/Dev/exitbook/apps/cli/src/features/links/links-run.ts`

**New**: `src/commands/links/run.ts`

```typescript
import { Command, Flags } from '@oclif/core';
import { render } from 'ink';
import React from 'react';
import { LinksRunHandler } from '../../handlers/links/links-run-handler.js';
import { PromptFlow } from '../../ui/shared/PromptFlow.js';
import { LinksRunMonitor } from '../../ui/links/links-run-components.js';
import { LinksRunCommandOptionsSchema } from '../../schemas/links-schemas.js';

export default class LinksRun extends Command {
  static description = 'Run the linking algorithm to find matching transactions';

  static enableJsonFlag = true;

  static flags = {
    dryRun: Flags.boolean({
      description: 'Show matches without saving to database',
      default: false,
    }),
    minConfidence: Flags.custom<number>({
      parse: async (input) => parseFloat(input),
      description: 'Minimum confidence threshold (0-1)',
      default: 0.7,
    })(),
    autoConfirmThreshold: Flags.custom<number>({
      parse: async (input) => parseFloat(input),
      description: 'Auto-confirm threshold for high-confidence matches',
      default: 0.95,
    })(),
  };

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --dry-run',
    '<%= config.bin %> <%= command.id %> --min-confidence 0.8',
  ];

  async run(): Promise<unknown> {
    const { flags } = await this.parse(LinksRun);

    // Validate with Zod (cross-field validation)
    const validated = LinksRunCommandOptionsSchema.parse(flags);

    if (this.jsonEnabled()) {
      // JSON mode - no Ink rendering
      return await this.executeHandler(validated);
    }

    // Text/TUI mode - use Ink
    return await this.executeWithInk(validated);
  }

  private async executeHandler(params: LinksRunParams) {
    const handler = new LinksRunHandler(params);
    const result = await handler.execute();

    if (result.isErr()) {
      this.error(result.error.message, { exit: 1 });
    }

    return result.value;
  }

  private async executeWithInk(params: LinksRunParams): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const { unmount } = render(
        React.createElement(LinksRunMonitor, {
          params,
          onComplete: (result) => {
            unmount();
            if (result.isErr()) {
              this.error(result.error.message, { exit: 1 });
            }
            resolve(result.value);
          },
        })
      );
    });
  }
}
```

**Key changes**:

- `enableJsonFlag = true` - oclif handles --json automatically
- `this.jsonEnabled()` - check if JSON mode active
- `this.error()` - standardized error handling
- `this.parse()` - type-safe flag parsing
- Zod validation after parsing for cross-field checks
- Ink rendering unchanged

**Commands to migrate**:

1. `links run` (complex - prompts + monitor)
2. `links view` (complex - interactive TUI)
3. `import` (complex - IngestionMonitor dashboard)
4. `reprocess` (similar to import)
5. `prices enrich` (progress display)

### Step 5: Integrate Zod Schemas with oclif Flags (2 days)

**Current**: `/Users/joel/Dev/exitbook/apps/cli/src/features/shared/schemas.ts`

**Strategy**: Two-layer validation

1. Basic parsing via oclif Flags (types, coercion)
2. Complex validation via Zod (cross-field, refinements)

**Example** (from LinksRunCommandOptionsSchema):

```typescript
// oclif flags handle basic parsing
static flags = {
  minConfidence: Flags.custom<number>({
    parse: async (input) => {
      const num = parseFloat(input);
      if (isNaN(num)) throw new Error('Must be a number');
      return num;
    },
  })(),
  autoConfirmThreshold: Flags.custom<number>({
    parse: async (input) => {
      const num = parseFloat(input);
      if (isNaN(num)) throw new Error('Must be a number');
      return num;
    },
  })(),
};

// Zod handles cross-field validation
async run() {
  const { flags } = await this.parse(LinksRun);

  // This validates: autoConfirmThreshold >= minConfidence
  const validated = LinksRunCommandOptionsSchema.parse(flags);
}
```

**Keep Zod for**:

- Cross-field validation
- Complex refinements
- Union discriminated types
- Domain-specific validation

**Use oclif Flags for**:

- Type coercion (string → number)
- Required vs optional
- Default values
- Basic format validation

### Step 6: Replace Error Handling (1 day)

**Remove files**:

- `/Users/joel/Dev/exitbook/apps/cli/src/features/shared/output.ts` (OutputManager - 187 lines)
- `/Users/joel/Dev/exitbook/apps/cli/src/features/shared/cli-error.ts` (displayCliError - 46 lines)

**Replace with oclif patterns**:

```typescript
// Validation error
if (!isValid) {
  this.error('Invalid configuration', { exit: ExitCodes.CONFIG_ERROR });
}

// Runtime error (Result type)
if (result.isErr()) {
  this.error(result.error.message, { exit: ExitCodes.GENERAL_ERROR });
}

// Warning (doesn't exit)
this.warn('Using cached data - may be stale');

// Success in JSON mode
return { status: 'success', data: {...} };
```

**Benefits**:

- Automatic JSON formatting when --json flag present
- Consistent error structure across all commands
- Exit codes handled declaratively
- 233 lines of custom error code removed

### Step 7: Update Main Entry Point (1 day)

**Current**: `/Users/joel/Dev/exitbook/apps/cli/src/index.ts`

- Commander program registration
- Manual command imports
- Custom error handling

**New**: oclif auto-discovers commands

```typescript
#!/usr/bin/env node
import { run } from '@oclif/core';

run(process.argv.slice(2)).catch(async (error) => {
  const { handle } = await import('@oclif/core/handle');
  return handle(error);
});
```

**Configuration**: Commands auto-registered from `src/commands/` directory structure.

### Step 8: Update Development Scripts (1 day)

**File**: `/Users/joel/Dev/exitbook/apps/cli/package.json`

```json
{
  "scripts": {
    "dev": "tsx --env-file-if-exists=../../.env bin/dev.js",
    "build": "tsc -b",
    "prepack": "pnpm build",
    "test": "vitest run"
  },
  "bin": {
    "exitbook": "./bin/run.js"
  }
}
```

**Development command** (unchanged user experience):

```bash
pnpm run dev import --exchange kraken --csv-dir ./exports/kraken
```

### Step 9: Testing & Validation (3-4 days)

**Test coverage**:

1. **Unit tests**: Each command class with mocked dependencies
2. **Integration tests**: Full CLI execution with real data
3. **Parity tests**: Verify identical behavior to Commander version

**Example test** (`links-run.test.ts`):

```typescript
import { test, expect } from 'vitest';
import { runCommand } from '@oclif/test';

test('links run --dry-run', async () => {
  const { stdout } = await runCommand(['links', 'run', '--dry-run']);
  expect(stdout).toContain('Dry run mode');
});

test('links run --json', async () => {
  const { stdout } = await runCommand(['links', 'run', '--json']);
  const result = JSON.parse(stdout);
  expect(result).toHaveProperty('matches');
});
```

**Validation checklist**:

- [ ] All commands available via `pnpm run dev --help`
- [ ] JSON mode produces valid JSON for all commands
- [ ] Text mode renders Ink components correctly
- [ ] Error handling preserves exit codes
- [ ] Help text accurate and complete
- [ ] Interactive prompts work (Ctrl+C, Enter, etc.)

### Step 10: Documentation & Cleanup (2 days)

**Update files**:

- `/Users/joel/Dev/exitbook/CLAUDE.md` - Update CLI usage section
- `/Users/joel/Dev/exitbook/README.md` - Update command examples
- Package documentation

**Remove legacy code**:

- Command registration files (`links.ts`, `prices.ts`, etc.)
- OutputManager class
- displayCliError function
- Manual help text

**Add oclif plugins** (optional):

```bash
pnpm add @oclif/plugin-autocomplete
pnpm add @oclif/plugin-update
pnpm add @oclif/plugin-help
```

## Critical Files

### To Modify

- `/Users/joel/Dev/exitbook/apps/cli/src/index.ts` - Main entry point
- `/Users/joel/Dev/exitbook/apps/cli/package.json` - Dependencies, config, scripts
- `/Users/joel/Dev/exitbook/apps/cli/src/features/shared/schemas.ts` - Integrate with oclif Flags

### To Remove

- `/Users/joel/Dev/exitbook/apps/cli/src/features/shared/output.ts` - OutputManager (187 lines)
- `/Users/joel/Dev/exitbook/apps/cli/src/features/shared/cli-error.ts` - displayCliError (46 lines)
- All command registration files (13 files like `links.ts`, `prices.ts`)

### To Create

- `bin/run.js` - oclif production entry
- `bin/dev.js` - oclif development entry
- `src/commands/**/*.ts` - 30+ command class files

### Unchanged

- `/Users/joel/Dev/exitbook/apps/cli/src/handlers/**/*` - Business logic
- `/Users/joel/Dev/exitbook/apps/cli/src/utils/**/*` - Pure functions
- `/Users/joel/Dev/exitbook/apps/cli/src/ui/**/*` - Ink components

## Risks & Mitigations

### Risk: Breaking existing workflows

**Mitigation**: Comprehensive integration tests before migration, feature flag for rollback

### Risk: Ink components don't work with oclif

**Mitigation**: oclif is framework-agnostic; proven Ink integration exists ([example](https://medium.com/syngenta-digitalblog/elevating-interactivity-in-command-line-applications-to-the-next-level-67cfa83a336))

### Risk: JSON mode behavior changes

**Mitigation**: oclif's `enableJsonFlag` provides identical behavior; test parity

### Risk: Financial data corruption during migration

**Mitigation**: Read-only commands first (list, view), write commands later after validation

### Risk: Performance regression

**Mitigation**: Benchmark command execution time before/after migration

## Success Criteria

- [ ] All 30+ commands migrated to oclif
- [ ] `pnpm test` passes (unit + integration tests)
- [ ] JSON mode parity validated for all commands
- [ ] Text mode renders Ink components correctly
- [ ] Help text auto-generated and accurate
- [ ] Exit codes preserved
- [ ] Development workflow unchanged (`pnpm run dev ...`)
- [ ] 500+ lines of boilerplate removed (OutputManager + error handling)
- [ ] TypeScript errors eliminated (no `rawOptions: unknown`)

## Timeline

### Phase 1: Complete Ink Migration (Weeks 1-2)

**Week 1**: Migrate simple commands (balance, clear, list-blockchains, transactions, accounts, cost-basis)
**Week 2**: Migrate complex commands (prices-enrich, export)

- **Deliverable**: All commands use Ink pattern, OutputManager fully removed

### Phase 2: oclif Migration (Weeks 3-6)

**Week 3**: Setup + simple commands (list-blockchains, clear, balance)
**Week 4**: Interactive commands + Zod integration (links, import, prices)
**Week 5**: Testing + validation (integration tests, parity checks)
**Week 6**: Documentation + cleanup (remove Commander, update docs)

- **Deliverable**: Full oclif migration, Commander.js removed

**Total**: 6 weeks

### Milestones

- End of Week 2: Single rendering pattern (Ink), ready for Phase 2
- End of Week 4: Core oclif commands working, proof of concept validated
- End of Week 6: Full migration complete, production-ready

## Verification

After migration, test end-to-end:

```bash
# Development commands (text mode)
pnpm run dev list-blockchains
pnpm run dev links run --dry-run
pnpm run dev import --exchange kraken --csv-dir ./test-data
pnpm run dev prices view --asset BTC --display-currency USD

# JSON mode
pnpm run dev links run --json
pnpm run dev balance --json

# Interactive flows
pnpm run dev links view  # Should render TUI
pnpm run dev links run   # Should use PromptFlow

# Error handling
pnpm run dev links run --min-confidence 2.0  # Should error gracefully
pnpm run dev import --exchange invalid       # Should show helpful error

# Help text
pnpm run dev --help
pnpm run dev links --help
pnpm run dev links run --help
```

Test exit codes:

```bash
pnpm run dev links run --invalid-flag
echo $?  # Should be non-zero

pnpm run dev list-blockchains
echo $?  # Should be 0
```

Run full test suite:

```bash
pnpm build           # Type check all packages
pnpm test            # Unit tests
pnpm test:e2e        # Integration tests (requires .env keys)
```
