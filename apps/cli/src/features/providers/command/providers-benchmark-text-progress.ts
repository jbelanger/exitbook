import pc from 'picocolors';

import { formatSuccessLine } from '../../../cli/success.js';
import { isInteractiveTerminal } from '../../../runtime/interactive-terminal.js';
import { createSpinner, failSpinner, stopSpinner, type SpinnerWrapper } from '../../shared/spinner.js';

import type { BenchmarkProgressEvent, BenchmarkResult } from './benchmark-tool.js';
import type { BenchmarkParams } from './providers-benchmark-utils.js';
import { buildConfigOverride } from './providers-benchmark-utils.js';

interface ProvidersBenchmarkTextProgressInput {
  currentRateLimit: unknown;
  interactive?: boolean | undefined;
  log?: (message?: string) => void;
  params: BenchmarkParams;
  providerName: string;
}

export class ProvidersBenchmarkTextProgress {
  private activeSpinner: SpinnerWrapper | undefined;
  private readonly interactive: boolean;
  private readonly logLine: (message?: string) => void;
  private burstSectionPrinted = false;

  constructor(private readonly input: ProvidersBenchmarkTextProgressInput) {
    this.interactive = input.interactive ?? isInteractiveTerminal();
    this.logLine = input.log ?? console.log;
  }

  begin(): void {
    const { currentRateLimit, params, providerName } = this.input;

    this.logLine(
      `Benchmark ${pc.cyan(providerName)} ${pc.dim('·')} ${params.blockchain} ${pc.dim('·')} ${pc.yellow('running')}`
    );
    this.logLine('');
    this.logLine(pc.dim('Provider Info'));
    this.logLine(`  ${pc.dim('Current rate limit:')} ${formatInlineJson(currentRateLimit)}`);
    this.logLine(`  ${pc.dim('Requests per test:')} ${params.numRequests}`);
    this.logLine(`  ${pc.dim('Burst testing:')} ${params.skipBurst ? 'disabled' : 'enabled'}`);
    this.logLine('');
    this.logLine(pc.dim('Sustained Rate Tests'));
  }

  onProgress(event: BenchmarkProgressEvent): void {
    switch (event.type) {
      case 'sustained-start':
        this.startActiveStep(formatSustainedLabel(event.rate));
        return;
      case 'sustained-complete':
        this.completeActiveStep(event.success, buildSustainedOutcome(event.rate, event.responseTimeMs));
        return;
      case 'cooldown-start':
        this.logLine(pc.dim(`  · waiting ${event.seconds}s ${formatCooldownReason(event.reason)}`));
        return;
      case 'cooldown-heartbeat':
        this.logLine(pc.dim(`    ${event.secondsRemaining}s remaining`));
        return;
      case 'cooldown-complete':
        return;
      case 'burst-start':
        this.ensureBurstSection();
        this.startActiveStep(formatBurstLabel(event.limit));
        return;
      case 'burst-complete':
        this.completeActiveStep(event.success, formatBurstLabel(event.limit));
        return;
    }
  }

  complete(result: BenchmarkResult): void {
    this.dispose();

    this.logLine('');
    this.logLine(formatSuccessLine('Benchmark complete'));
    this.logLine('');
    this.logLine(`${pc.dim('Max safe rate:')} ${pc.bold(`${result.maxSafeRate} req/sec`)}`);
    this.logLine('');
    this.logLine(pc.dim('Recommended configuration (80% safety margin):'));
    this.logLine(formatIndentedJson(result.recommended));
    this.logLine('');
    this.logLine(pc.dim('To update the configuration, edit:'));
    this.logLine('  apps/cli/config/blockchain-explorers.json');
    this.logLine('');
    this.logLine(pc.dim(`Example override for ${this.input.providerName}:`));
    this.logLine(
      formatIndentedJson(buildConfigOverride(this.input.params.blockchain, this.input.providerName, result.recommended))
    );
  }

  error(message: string): void {
    if (this.activeSpinner) {
      failSpinner(this.activeSpinner, 'benchmark failed');
      this.activeSpinner = undefined;
    }

    this.logLine('');
    this.logLine(pc.red(`✗ Error: ${message}`));
  }

  dispose(): void {
    stopSpinner(this.activeSpinner);
    this.activeSpinner = undefined;
  }

  private ensureBurstSection(): void {
    if (this.burstSectionPrinted) {
      return;
    }

    this.burstSectionPrinted = true;
    this.logLine('');
    this.logLine(pc.dim('Burst Limit Tests'));
  }

  private startActiveStep(label: string): void {
    this.dispose();

    if (this.interactive) {
      this.activeSpinner = createSpinner(`  ${label}`, false);
      return;
    }

    this.logLine(pc.dim(`  · ${label}`));
  }

  private completeActiveStep(success: boolean, message: string): void {
    if (this.activeSpinner) {
      if (success) {
        stopSpinner(this.activeSpinner, `  ${message}`);
      } else {
        failSpinner(this.activeSpinner, `  ${message}`);
      }
      this.activeSpinner = undefined;
      return;
    }

    const icon = success ? pc.green('✓') : pc.red('✗');
    this.logLine(`  ${icon} ${message}`);
  }
}

function buildSustainedOutcome(rate: number, responseTimeMs: number | undefined): string {
  const response = responseTimeMs !== undefined ? `   avg ${responseTimeMs.toFixed(0)}ms` : '';
  return `${formatSustainedLabel(rate)}${response}`;
}

function formatSustainedLabel(rate: number): string {
  return `${rate} req/sec`.padEnd(14);
}

function formatBurstLabel(limit: number): string {
  return `${limit} req/min`.padEnd(14);
}

function formatCooldownReason(reason: 'before-burst' | 'next-rate'): string {
  return reason === 'before-burst' ? 'before burst tests' : 'before next rate test';
}

function formatInlineJson(value: unknown): string {
  const json = JSON.stringify(value);
  return json ?? String(value);
}

function formatIndentedJson(value: unknown): string {
  const json = JSON.stringify(value, undefined, 2) ?? String(value);
  return json
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');
}
