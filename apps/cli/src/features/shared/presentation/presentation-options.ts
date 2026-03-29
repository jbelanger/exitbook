import type { Command } from 'commander';
import { z } from 'zod';

export const PresentationFlagSchema = z.object({
  json: z.boolean().optional(),
  text: z.boolean().optional(),
  tui: z.boolean().optional(),
});

export interface PresentationOptionConfig {
  jsonDescription?: string | undefined;
  textDescription?: string | undefined;
  tuiDescription?: string | undefined;
  includeJson?: boolean | undefined;
  includeText?: boolean | undefined;
  includeTui?: boolean | undefined;
}

export function addPresentationOptions(command: Command, config?: PresentationOptionConfig): Command {
  if (config?.includeJson !== false) {
    command.option('--json', config?.jsonDescription ?? 'Output results in JSON format');
  }

  if (config?.includeText !== false) {
    command.option('--text', config?.textDescription ?? 'Force human-readable text output');
  }

  if (config?.includeTui !== false) {
    command.option('--tui', config?.tuiDescription ?? 'Force the Ink interface');
  }

  return command;
}
