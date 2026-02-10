/**
 * Environment setup for CLI - must be imported before any other modules
 *
 * File logging is enabled by default for CLI.
 * Users can explicitly enable/disable via CLI_FILE_LOG_ENABLED env var.
 * The LOGGER_FILE_LOG_ENABLED env var should NOT be set in .env files for CLI usage.
 */

// Only override if not explicitly set via CLI_FILE_LOG_ENABLED
// This allows users to control CLI file logging independently from other contexts
if (process.env['CLI_FILE_LOG_ENABLED'] !== undefined) {
  process.env['LOGGER_FILE_LOG_ENABLED'] = process.env['CLI_FILE_LOG_ENABLED'];
} else {
  // Default to enabled for CLI
  process.env['LOGGER_FILE_LOG_ENABLED'] = 'true';
}
