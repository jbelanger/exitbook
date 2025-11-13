import type { Writable } from 'node:stream';

import type { CommonOptions } from '@clack/prompts';
import { isCI as isCIEnvironment, isTTY as isTTYCheck, log, unicodeOr } from '@clack/prompts';
import color from 'picocolors';

export interface TaskLogOptions extends CommonOptions {
  title: string;
  spacing?: number | undefined;
}

export interface TaskLogMessageOptions {
  raw?: boolean | undefined;
}

export interface TaskLogCompletionOptions {
  showLog?: boolean | undefined;
}

const S_BAR = unicodeOr('│', '|');
const S_STEP_SUBMIT = unicodeOr('◇', 'o');

export const taskLog = (opts: TaskLogOptions) => {
  const output: Writable = opts.output ?? process.stdout;
  const spacing = opts.spacing ?? 1;
  const secondarySymbol = color.gray(S_BAR);
  const isTTY = !isCIEnvironment() && isTTYCheck(output);

  const writeSpacer = () => {
    for (let i = 0; i < spacing; i++) {
      log.message('', { output, secondarySymbol, symbol: secondarySymbol, spacing: 0 });
    }
  };

  const writeStart = () => {
    log.message('', { output, secondarySymbol, symbol: secondarySymbol, spacing: 0 });
    log.message(opts.title, {
      output,
      secondarySymbol,
      symbol: color.green(S_STEP_SUBMIT),
      spacing: 0,
    });
    writeSpacer();
  };

  writeStart();

  const writeMessage = (message: string, mopts?: TaskLogMessageOptions) => {
    if (message.length === 0) {
      return;
    }

    const formatted = mopts?.raw === true ? message : color.dim(message);
    log.message(formatted, { output, secondarySymbol, symbol: secondarySymbol, spacing: 0 });
  };

  const writeGroupHeader = (header: string) => {
    if (header.length === 0) {
      return;
    }

    log.message(color.bold(header), { output, secondarySymbol, symbol: secondarySymbol, spacing: 0 });
  };

  const clearLine = (): void => {
    if (!isTTY) {
      return;
    }

    output.write('\u001b[2K\r');
  };

  const writeCompletion = (symbol: string, message: string) => {
    writeSpacer();
    log.message(message, { output, secondarySymbol, symbol, spacing: 0 });
  };

  return {
    message(msg: string, mopts?: TaskLogMessageOptions) {
      clearLine();
      writeMessage(msg, mopts);
    },
    group(name: string) {
      let headerPrinted = false;
      return {
        message(msg: string, mopts?: TaskLogMessageOptions) {
          clearLine();
          if (!headerPrinted && name.length > 0) {
            writeGroupHeader(name);
            headerPrinted = true;
          }
          writeMessage(msg, mopts);
        },
        error(message: string) {
          writeCompletion(color.red('■'), message);
        },
        success(message: string) {
          writeCompletion(color.green('◆'), message);
        },
      };
    },
    error(message: string) {
      writeCompletion(color.red('■'), message);
    },
    success(message: string) {
      writeCompletion(color.green('◆'), message);
    },
  };
};
