import {
  isInteractiveTerminal,
  readTerminalInteractivitySnapshot,
  type TerminalInteractivitySnapshot,
} from '../../../runtime/interactive-terminal.js';

import type { CommandEntrypointRole, CommandIntent, PresentationMode } from './presentation-mode.js';

export interface CommandPresentationSpec {
  commandId: string;
  intent: CommandIntent;
  role: CommandEntrypointRole;
  interactiveDefaultMode: Extract<PresentationMode, 'tui' | 'text' | 'text-progress'>;
  nonTuiOverrideMode: Extract<PresentationMode, 'text' | 'text-progress'>;
  fallbackNonInteractiveMode: Extract<PresentationMode, 'text' | 'text-progress'>;
}

export interface RawPresentationOptions {
  json?: boolean | undefined;
  text?: boolean | undefined;
  tui?: boolean | undefined;
}

export function snapshotPresentationSpec(commandId: string): CommandPresentationSpec {
  return {
    commandId,
    intent: 'browse',
    role: 'snapshot',
    interactiveDefaultMode: 'text',
    nonTuiOverrideMode: 'text',
    fallbackNonInteractiveMode: 'text',
  };
}

export function explorerPresentationSpec(commandId: string): CommandPresentationSpec {
  return {
    commandId,
    intent: 'browse',
    role: 'explorer',
    interactiveDefaultMode: 'tui',
    nonTuiOverrideMode: 'text',
    fallbackNonInteractiveMode: 'text',
  };
}

export function workflowPresentationSpec(commandId: string): CommandPresentationSpec {
  return {
    commandId,
    intent: 'workflow',
    role: 'workflow',
    interactiveDefaultMode: 'text-progress',
    nonTuiOverrideMode: 'text-progress',
    fallbackNonInteractiveMode: 'text-progress',
  };
}

export function mutatePresentationSpec(commandId: string): CommandPresentationSpec {
  return {
    commandId,
    intent: 'mutate',
    role: 'mutate',
    interactiveDefaultMode: 'text',
    nonTuiOverrideMode: 'text',
    fallbackNonInteractiveMode: 'text',
  };
}

export function exportPresentationSpec(commandId: string): CommandPresentationSpec {
  return {
    commandId,
    intent: 'export',
    role: 'export',
    interactiveDefaultMode: 'text',
    nonTuiOverrideMode: 'text',
    fallbackNonInteractiveMode: 'text',
  };
}

export function resolvePresentationMode(
  spec: CommandPresentationSpec,
  rawOptions: unknown,
  snapshot: TerminalInteractivitySnapshot = readTerminalInteractivitySnapshot()
): PresentationMode {
  const options = readRawPresentationOptions(rawOptions);
  const flagCount = [options.json === true, options.text === true, options.tui === true].filter(Boolean).length;

  if (flagCount > 1) {
    throw new Error('--json, --text, and --tui are mutually exclusive');
  }

  if (options.json === true) {
    return 'json';
  }

  if (options.tui === true) {
    if (spec.role === 'workflow' || spec.role === 'explorer' || spec.role === 'destructive-review') {
      return 'tui';
    }

    throw new Error('--tui is not supported for this command; use the explicit view command instead');
  }

  if (options.text === true) {
    return spec.nonTuiOverrideMode;
  }

  if (spec.role === 'snapshot' || spec.role === 'mutate' || spec.role === 'export') {
    return 'text';
  }

  if (!isInteractiveTerminal(snapshot)) {
    return spec.fallbackNonInteractiveMode;
  }

  return spec.interactiveDefaultMode;
}

function readRawPresentationOptions(rawOptions: unknown): RawPresentationOptions {
  if (typeof rawOptions !== 'object' || rawOptions === null) {
    return {};
  }

  const options = rawOptions as Record<string, unknown>;

  return {
    json: options['json'] === true ? true : undefined,
    text: options['text'] === true ? true : undefined,
    tui: options['tui'] === true ? true : undefined,
  };
}
