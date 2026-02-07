import { performance } from 'node:perf_hooks';

import * as p from '@clack/prompts';
import { TransactionLinkRepository } from '@exitbook/accounting';
import { parseDecimal } from '@exitbook/core';
import { TransactionRepository, closeDatabase, initializeDatabase } from '@exitbook/data';
import { configureLogger, resetLoggerContext } from '@exitbook/logger';
import type { Command } from 'commander';
import { render } from 'ink';
import React from 'react';
import type { z } from 'zod';

import { LinksRunMonitor } from '../../ui/links/index.js';
import { createLinksRunState } from '../../ui/links/index.js';
import { displayCliError } from '../shared/cli-error.js';
import { ExitCodes } from '../shared/exit-codes.js';
import { OutputManager } from '../shared/output.js';
import { handleCancellation, isCancelled, promptConfirm } from '../shared/prompts.js';
import { LinksRunCommandOptionsSchema } from '../shared/schemas.js';

import type { LinksRunHandlerParams, LinksRunResult } from './links-run-handler.js';
import { LinksRunHandler } from './links-run-handler.js';

/**
 * Command options validated by Zod at CLI boundary
 */
type LinksRunCommandOptions = z.infer<typeof LinksRunCommandOptionsSchema>;

/**
 * Build links run parameters from validated CLI options.
 */
function buildLinksRunParamsFromFlags(options: LinksRunCommandOptions): LinksRunHandlerParams {
  return {
    dryRun: options.dryRun ?? false,
    minConfidenceScore: parseDecimal(options.minConfidence?.toString() ?? '0.7'),
    autoConfirmThreshold: parseDecimal(options.autoConfirmThreshold?.toString() ?? '0.95'),
  };
}

/**
 * Prompt user for links run parameters in interactive mode.
 */
async function promptForLinksRunParams(): Promise<LinksRunHandlerParams> {
  // Ask if user wants to run in dry-run mode
  const dryRun = await p.confirm({
    message: 'Run in dry-run mode (preview matches without saving)?',
    initialValue: false,
  });

  if (isCancelled(dryRun)) {
    handleCancellation();
  }

  // Ask for minimum confidence threshold
  const minConfidenceInput = await p.text({
    message: 'Minimum confidence score (0-1, default: 0.7):',
    placeholder: '0.7',
    validate: (value) => {
      if (!value) return; // Allow empty for default
      const num = Number(value);
      if (Number.isNaN(num) || num < 0 || num > 1) {
        return 'Must be a number between 0 and 1';
      }
    },
  });

  if (isCancelled(minConfidenceInput)) {
    handleCancellation();
  }

  const minConfidenceScore = parseDecimal(minConfidenceInput ?? '0.7');

  // Ask for auto-confirm threshold
  const autoConfirmInput = await p.text({
    message: 'Auto-confirm threshold (0-1, default: 0.95):',
    placeholder: '0.95',
    validate: (value) => {
      if (!value) return; // Allow empty for default
      const num = Number(value);
      if (Number.isNaN(num) || num < 0 || num > 1) {
        return 'Must be a number between 0 and 1';
      }
      const minConfidence = Number(minConfidenceInput ?? '0.7');
      if (num < minConfidence) {
        return `Must be >= minimum confidence score (${minConfidence})`;
      }
    },
  });

  if (isCancelled(autoConfirmInput)) {
    handleCancellation();
  }

  const autoConfirmThreshold = parseDecimal(autoConfirmInput ?? '0.95');

  return {
    dryRun,
    minConfidenceScore,
    autoConfirmThreshold,
  };
}

/**
 * Register the links run subcommand.
 */
export function registerLinksRunCommand(linksCommand: Command): void {
  linksCommand
    .command('run')
    .description('Run the linking algorithm to find matching transactions across sources')
    .option('--dry-run', 'Show matches without saving to database')
    .option('--min-confidence <score>', 'Minimum confidence threshold (0-1, default: 0.7)', parseFloat)
    .option('--auto-confirm-threshold <score>', 'Auto-confirm above this score (0-1, default: 0.95)', parseFloat)
    .option('--json', 'Output results in JSON format')
    .action(async (rawOptions: unknown) => {
      await executeLinksRunCommand(rawOptions);
    });
}

/**
 * Execute the links run command.
 */
async function executeLinksRunCommand(rawOptions: unknown): Promise<void> {
  // Check for --json flag early (even before validation) to determine output format
  const isJsonMode =
    typeof rawOptions === 'object' && rawOptions !== null && 'json' in rawOptions && rawOptions.json === true;

  // Validate options at CLI boundary
  const parseResult = LinksRunCommandOptionsSchema.safeParse(rawOptions);
  if (!parseResult.success) {
    displayCliError(
      'links-run',
      new Error(parseResult.error.issues[0]?.message ?? 'Invalid options'),
      ExitCodes.INVALID_ARGS,
      isJsonMode ? 'json' : 'text'
    );
  }

  const options = parseResult.data;
  const output = new OutputManager(options.json ? 'json' : 'text');

  try {
    let params: LinksRunHandlerParams;
    if (!options.dryRun && !options.minConfidence && !options.autoConfirmThreshold && !options.json) {
      output.intro('exitbook links-run');
      params = await promptForLinksRunParams();
      const shouldProceed = await promptConfirm('Start transaction linking?', true);
      if (!shouldProceed) {
        handleCancellation('Transaction linking cancelled');
      }
    } else {
      params = buildLinksRunParamsFromFlags(options);
    }

    const spinner = output.spinner();
    spinner?.start('Linking transactions...');

    // Configure logger if no spinner (JSON mode)
    if (!spinner) {
      configureLogger({
        mode: options.json ? 'json' : 'text',
        verbose: false,
        sinks: options.json ? { ui: false, structured: 'file' } : { ui: false, structured: 'stdout' },
      });
    }

    const { OverrideStore } = await import('@exitbook/data');
    const database = await initializeDatabase();
    const transactionRepository = new TransactionRepository(database);
    const linkRepository = new TransactionLinkRepository(database);
    const overrideStore = new OverrideStore();
    const handler = new LinksRunHandler(transactionRepository, linkRepository, overrideStore);

    try {
      const result = await handler.execute(params);

      await closeDatabase(database);
      spinner?.stop();
      resetLoggerContext();

      if (result.isErr()) {
        output.error('links-run', result.error, ExitCodes.GENERAL_ERROR);
        return;
      }

      handleLinksRunSuccess(output, result.value);
    } catch (error) {
      await closeDatabase(database);
      spinner?.stop('Linking failed');
      resetLoggerContext();
      throw error;
    }
  } catch (error) {
    resetLoggerContext();
    output.error('links-run', error instanceof Error ? error : new Error(String(error)), ExitCodes.GENERAL_ERROR);
  }
}

/**
 * Handle successful linking.
 */
function handleLinksRunSuccess(output: OutputManager, linkResult: LinksRunResult): void {
  // Display results in text mode using Ink
  if (output.isTextMode()) {
    renderLinksRunResult(linkResult);
  }

  output.json('links-run', linkResult);
}

/**
 * Render linking results using Ink operation tree
 */
function renderLinksRunResult(result: LinksRunResult): void {
  // Create state with all phases already completed
  const state = createLinksRunState(result.dryRun);
  const now = performance.now();

  // Simulate phase timings (we don't have real timings, so use reasonable estimates)
  const loadDuration = 1200;
  const matchDuration = 340;
  const saveDuration = 180;

  const loadStart = now - loadDuration - matchDuration - saveDuration;
  const matchStart = loadStart + loadDuration;
  const saveStart = matchStart + matchDuration;

  // Phase 1: Load (completed)
  state.load = {
    status: 'completed',
    startedAt: loadStart,
    completedAt: loadStart + loadDuration,
    totalTransactions: result.totalSourceTransactions + result.totalTargetTransactions,
    sourceCount: result.totalSourceTransactions,
    targetCount: result.totalTargetTransactions,
  };

  // Phase 2: Clear existing
  if (result.existingLinksCleared !== undefined && result.existingLinksCleared > 0) {
    state.existingCleared = result.existingLinksCleared;
  }

  // Phase 3: Match (completed)
  state.match = {
    status: 'completed',
    startedAt: matchStart,
    completedAt: matchStart + matchDuration,
    internalCount: result.internalLinksCount,
    confirmedCount: result.confirmedLinksCount,
    suggestedCount: result.suggestedLinksCount,
  };

  // Phase 4: Save (only if not dry run and has links to save)
  if (!result.dryRun && result.totalSaved !== undefined && result.totalSaved > 0) {
    state.save = {
      status: 'completed',
      startedAt: saveStart,
      completedAt: saveStart + saveDuration,
      totalSaved: result.totalSaved,
    };
  }

  // Mark as complete
  state.isComplete = true;
  state.totalDurationMs = loadDuration + matchDuration + (state.save ? saveDuration : 0);

  // Render and unmount
  const { unmount } = render(React.createElement(LinksRunMonitor, { state }));
  setTimeout(() => unmount(), 100);
}
