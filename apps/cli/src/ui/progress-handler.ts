import type { ProviderEvent } from '@exitbook/blockchain-providers';
import type { ImportEvent, ProcessEvent } from '@exitbook/ingestion';
import { getLogger } from '@exitbook/logger';
import ora, { type Ora } from 'ora';
import pc from 'picocolors';

type CliEvent = ImportEvent | ProcessEvent | ProviderEvent;

/**
 * Handles real-time progress display for CLI operations.
 * Subscribes to event bus and writes to stderr for live updates.
 */
export class ProgressHandler {
  private readonly logger = getLogger('ProgressHandler');
  private lastBatchLog = 0;
  private readonly batchLogThrottleMs = 500; // Log batch progress max once per 500ms
  private spinner: Ora | undefined;
  private hasShownHeader = false;
  private providerEvents: { message: string; timestamp: number; type: string }[] = [];
  private batchStats = {
    new: 0,
    skipped: 0,
    total: 0,
    fetchedRun: 0,
  };

  /**
   * Handle an event from the event bus.
   * Writes progress updates to stderr (keeps stdout clean for command output).
   */
  handleEvent(event: CliEvent): void {
    try {
      switch (event.type) {
        case 'import.started':
          if (!this.hasShownHeader) {
            this.showHeader(event.sourceName, event.accountId, event.resuming);
            this.hasShownHeader = true;
          }
          this.spinner = ora({
            text: event.resuming ? 'Resuming import...' : 'Fetching transactions...',
            color: 'cyan',
            stream: process.stderr,
          }).start();
          break;

        case 'import.session.created':
          // Show header if this is the first event we receive
          if (!this.hasShownHeader && event.sourceName && event.accountId !== undefined) {
            this.showHeader(event.sourceName, event.accountId, false);
            this.hasShownHeader = true;
          }
          this.logSection('SESSION', pc.dim(`Created import session ${pc.bold(`#${event.sessionId}`)}`));
          break;

        case 'import.session.resumed':
          this.logSection(
            'SESSION',
            pc.dim(`Resuming from session ${pc.bold(`#${event.sessionId}`)} (cursor: ${event.fromCursor})`)
          );
          break;

        case 'import.batch': {
          // Throttle batch logs to avoid spam
          const now = Date.now();
          if (now - this.lastBatchLog < this.batchLogThrottleMs) {
            return;
          }
          this.lastBatchLog = now;

          // Update stats
          this.batchStats.new += event.batchInserted;
          this.batchStats.skipped += event.batchSkipped;
          this.batchStats.total = event.totalImported;
          this.batchStats.fetchedRun = event.totalFetchedRun;

          // Update spinner text
          if (this.spinner) {
            const newText = event.batchInserted > 0 ? pc.green(`+${event.batchInserted}`) : '';
            const skipText = event.batchSkipped > 0 ? pc.yellow(`${event.batchSkipped} skipped`) : '';
            const parts = [newText, skipText].filter(Boolean);
            const fetchedText = pc.dim(`fetched: ${event.totalFetchedRun}`);
            this.spinner.text = `Fetching transactions... ${parts.join(', ')} (total: ${pc.bold(String(event.totalImported))}, ${fetchedText})`;
          }
          break;
        }

        case 'import.warning':
          if (this.spinner) {
            this.spinner.warn(pc.yellow(`Warning: ${event.warning}`));
            this.spinner = ora({ text: 'Continuing...', color: 'cyan', stream: process.stderr }).start();
          } else {
            this.logToStderr(pc.yellow(`  ⚠ Warning: ${event.warning}`));
          }
          break;

        case 'import.completed': {
          // Stop spinner without showing a summary (batch summary will show details)
          if (this.spinner) {
            this.spinner.stop();
            this.spinner = undefined;
          }

          // Show batch stats summary if we had activity
          if (this.batchStats.new > 0 || this.batchStats.skipped > 0) {
            this.showBatchSummary();
          }

          // Show provider events if any
          if (this.providerEvents.length > 0) {
            this.showProviderEvents();
          }
          break;
        }

        case 'import.failed':
          if (this.spinner) {
            this.spinner.fail(pc.red(`Import failed: ${event.error}`));
            this.spinner = undefined;
          } else {
            this.logToStderr(pc.red(`✗ Import failed for ${event.sourceName}: ${event.error}`));
          }
          break;

        case 'process.started':
          this.logToStderr(''); // Empty line for spacing
          this.spinner = ora({
            text: `Processing ${pc.bold(String(event.totalRaw))} transactions...`,
            color: 'magenta',
            stream: process.stderr,
          }).start();
          break;

        case 'process.batch': {
          // Throttle batch logs
          const now = Date.now();
          if (now - this.lastBatchLog < this.batchLogThrottleMs) {
            return;
          }
          this.lastBatchLog = now;

          if (this.spinner) {
            this.spinner.text = `Processing... ${pc.bold(String(event.totalProcessed))} completed`;
          }
          break;
        }

        case 'process.completed': {
          const durationSec = (event.durationMs / 1000).toFixed(1);

          if (this.spinner) {
            if (event.errors.length > 0) {
              this.spinner.warn(
                pc.yellow(`Processed ${pc.bold(String(event.totalProcessed))} transactions`) +
                  pc.dim(` (${event.errors.length} errors, ${durationSec}s)`)
              );
            } else {
              this.spinner.succeed(
                pc.green(`Processed ${pc.bold(String(event.totalProcessed))} transactions`) +
                  pc.dim(` (${durationSec}s)`)
              );
            }
            this.spinner = undefined;
          }
          break;
        }

        case 'process.failed':
          if (this.spinner) {
            this.spinner.fail(pc.red(`Processing failed: ${event.error}`));
            this.spinner = undefined;
          } else {
            this.logToStderr(pc.red(`✗ Processing failed: ${event.error}`));
          }
          break;

        case 'process.skipped':
          this.logSection('PROCESSING', pc.dim(`Skipped: ${event.reason}`));
          break;

        // Provider selection & switching
        case 'provider.selection': {
          // Only show selection if it's noteworthy (not just initial selection)
          const selectedProvider = event.providers[0];
          if (selectedProvider && selectedProvider.reason === 'priority') {
            this.providerEvents.push({
              type: 'selection',
              message: `Selected ${pc.bold(event.selected)} for ${pc.dim(event.operation)}`,
              timestamp: Date.now(),
            });
          }
          break;
        }

        case 'provider.resume':
          this.providerEvents.push({
            type: 'resume',
            message: `Resumed with ${pc.bold(event.provider)} from ${pc.cyan(event.cursorType)} ${pc.dim(String(event.cursor))}`,
            timestamp: Date.now(),
          });
          break;

        case 'provider.cursor.adjusted':
          this.providerEvents.push({
            type: 'cursor',
            message: `Adjusted cursor: ${pc.cyan(event.cursorType)} ${event.originalCursor} → ${event.adjustedCursor} ${pc.dim(`(${event.reason})`)}`,
            timestamp: Date.now(),
          });
          break;

        case 'provider.failover':
          this.providerEvents.push({
            type: 'failover',
            message: pc.yellow(
              `Switched to ${pc.bold(event.to)} from ${pc.bold(event.from)}\n     ${pc.dim('Reason: ' + event.reason)}`
            ),
            timestamp: Date.now(),
          });
          break;

        case 'provider.rate_limited': {
          const retryInfo = event.retryAfterMs ? ` (retry in ${event.retryAfterMs}ms)` : '';
          this.providerEvents.push({
            type: 'rate_limit',
            message: pc.yellow(`⚠ Rate limited: ${pc.bold(event.provider)}${pc.dim(retryInfo)}`),
            timestamp: Date.now(),
          });
          break;
        }

        case 'provider.circuit_open':
          this.providerEvents.push({
            type: 'circuit',
            message: pc.red(`⚠ Circuit breaker: ${pc.bold(event.provider)} ${pc.dim(`(${event.reason})`)}`),
            timestamp: Date.now(),
          });
          break;

        case 'provider.backoff':
          this.providerEvents.push({
            type: 'backoff',
            message: pc.cyan(
              `↻ Backing off ${pc.bold(event.provider)}: attempt ${event.attemptNumber}, delay ${event.delayMs}ms`
            ),
            timestamp: Date.now(),
          });
          break;

        // Provider request events are too noisy for CLI - ignore them
        case 'provider.request.started':
        case 'provider.request.succeeded':
        case 'provider.request.failed':
          // Silently ignore - these are for telemetry systems
          break;

        default: {
          // TypeScript exhaustiveness check - will error if we miss an event type
          const _exhaustive: never = event;
          this.logger.warn({ event: _exhaustive }, 'Unhandled event type');
        }
      }
    } catch (err) {
      // Never let event handler errors crash the system
      this.logger.warn({ err, event }, 'Error handling event');
    }
  }

  /**
   * Write a line to stderr (keeps stdout clean for command output).
   */
  private logToStderr(message: string): void {
    process.stderr.write(`${message}\n`);
  }

  /**
   * Show header with import source information
   */
  private showHeader(sourceName: string, accountId: number, resuming: boolean): void {
    const title = resuming ? `Resuming import from ${sourceName}` : `Importing from ${sourceName}`;
    const width = Math.max(60, title.length + 4);
    const line = '─'.repeat(width);

    this.logToStderr('');
    this.logToStderr(pc.cyan(`┌${line}┐`));
    this.logToStderr(pc.cyan(`│ ${pc.bold(title.padEnd(width - 2))} │`));
    this.logToStderr(pc.cyan(`└${line}┘`));
    this.logToStderr('');
    this.logToStderr(pc.dim(`Account #${accountId}`));
    this.logToStderr('');
  }

  /**
   * Show batch statistics summary
   */
  private showBatchSummary(): void {
    this.logToStderr('');
    this.logSection('IMPORT SUMMARY', '');

    const labelWidth = 22;
    const formatLabel = (label: string) => label.padEnd(labelWidth, ' ');

    // Always show new transactions (even if 0)
    const newColor = this.batchStats.new > 0 ? pc.green : pc.dim;
    this.logToStderr(`  ${newColor('●')} ${formatLabel('New transactions:')} ${pc.bold(String(this.batchStats.new))}`);

    this.logToStderr(
      `  ${pc.cyan('●')} ${formatLabel('Fetched this run:')} ${pc.bold(String(this.batchStats.fetchedRun))}`
    );

    // Show duplicates if any
    if (this.batchStats.skipped > 0) {
      this.logToStderr(
        `  ${pc.yellow('●')} ${formatLabel('Duplicates skipped:')} ${pc.bold(String(this.batchStats.skipped))}`
      );
    }
  }

  /**
   * Show provider events that occurred during import
   */
  private showProviderEvents(): void {
    if (this.providerEvents.length === 0) return;

    this.logToStderr('');
    this.logSection('PROVIDER EVENTS', '');

    for (const evt of this.providerEvents) {
      this.logToStderr(`  ${evt.message}`);
    }
  }

  /**
   * Log a section header
   */
  private logSection(title: string, content: string): void {
    this.logToStderr(pc.dim(`${title}`));
    if (content) {
      this.logToStderr(content);
    }
  }
}
