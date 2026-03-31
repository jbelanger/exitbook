// TODO(cli-phase-0-5): Move the actual option/output-format implementation here after command migrations complete.
export {
  detectCliOutputFormat,
  detectCliTokenOutputFormat,
  type CliOutputFormat,
} from '../features/shared/cli-output-format.js';
export {
  parseCliBrowseOptionsResult,
  parseCliBrowseRootInvocationResult,
  parseCliCommandOptionsResult,
  type CliBrowseRootInvocation,
} from '../features/shared/command-options.js';
