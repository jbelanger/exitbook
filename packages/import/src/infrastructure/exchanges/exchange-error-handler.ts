import type { Logger } from '@exitbook/shared-logger';
import { getErrorProperties, isErrorWithMessage, RateLimitError, ServiceError } from '@exitbook/shared-utils';

/**
 * Centralized error handling for exchange operations
 * Eliminates duplicate error handling code across adapters
 */
export class ServiceErrorHandler {
  /**
   * Extract retry after value from rate limit error
   */
  static extractRetryAfter(error: unknown): number {
    // Try to get retry after from CCXT error
    const errorProps = getErrorProperties(error);
    if (errorProps.retryAfter && typeof errorProps.retryAfter === 'number') {
      return errorProps.retryAfter;
    }

    // Try to extract from error message
    if (isErrorWithMessage(error)) {
      const retryMatch = error.message.match(/retry.{0,10}(\d+)/i);
      if (retryMatch) {
        return parseInt(retryMatch[1] ?? '2') * 1000; // Convert to milliseconds, fallback to 2 seconds
      }
    }

    // Default fallback
    return 2000; // 2 seconds
  }

  /**
   * Create a standardized error message
   */
  static formatErrorMessage(operation: string, exchangeId: string, originalMessage: string): string {
    return `Failed to ${operation} from ${exchangeId}: ${originalMessage}`;
  }

  /**
   * Handle errors and convert to appropriate exception types
   */
  static handle(error: unknown, operation: string, exchangeId: string, logger?: Logger): never {
    if (logger) {
      logger.error(
        `Exchange operation failed: ${operation} - Exchange: ${exchangeId}, Error: ${error instanceof Error ? error.message : 'Unknown error'}, Type: ${error instanceof Error ? error.constructor.name : 'Unknown'}`
      );
    }

    // Handle CCXT-specific errors
    if (this.isRateLimit(error)) {
      const retryAfter = this.extractRetryAfter(error);
      if (logger) {
        logger.warn(`Rate limit exceeded for ${exchangeId}, should retry after ${retryAfter}ms`);
      }

      throw new RateLimitError(
        `Rate limit exceeded: ${error instanceof Error ? error.message : 'Unknown error'}`,
        exchangeId,
        operation,
        retryAfter
      );
    }

    if (this.isNetworkError(error)) {
      throw new ServiceError(
        `Network error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        exchangeId,
        operation,
        error instanceof Error ? error : undefined
      );
    }

    if (this.isNotSupported(error)) {
      // For unsupported operations, we'll log it but create a specific error
      if (logger) {
        logger.warn(
          `Operation not supported: ${operation} - Exchange: ${exchangeId}, Error: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
      throw new ServiceError(
        `Operation not supported: ${error instanceof Error ? error.message : 'Unknown error'}`,
        exchangeId,
        operation,
        error instanceof Error ? error : undefined
      );
    }

    // Re-throw if it's already one of our custom errors
    if (error instanceof ServiceError || error instanceof RateLimitError) {
      throw error;
    }

    // Generic exchange error fallback
    throw new ServiceError(
      `Operation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      exchangeId,
      operation,
      error instanceof Error ? error : undefined
    );
  }

  /**
   * Check if error is an authentication error
   */
  static isAuthError(error: unknown): boolean {
    if (error instanceof Error) {
      if (error.name === 'AuthenticationError') {
        return true;
      }

      if (error.message) {
        const msg = error.message.toLowerCase();
        return (
          msg.includes('authentication') ||
          msg.includes('unauthorized') ||
          msg.includes('invalid api') ||
          msg.includes('api key')
        );
      }
    }

    return false;
  }

  /**
   * Check if error is a network error
   */
  static isNetworkError(error: unknown): boolean {
    if (error instanceof Error) {
      if (error.name === 'NetworkError') {
        return true;
      }

      if (error.message) {
        const msg = error.message.toLowerCase();
        return msg.includes('network') || msg.includes('timeout') || msg.includes('connection');
      }
    }

    return false;
  }

  /**
   * Check if error indicates operation is not supported
   */
  static isNotSupported(error: unknown): boolean {
    if (error instanceof Error) {
      if (error.name === 'NotSupported') {
        return true;
      }

      if (error.message) {
        const msg = error.message.toLowerCase();
        return msg.includes('not supported') || msg.includes('not implemented');
      }
    }

    return false;
  }

  /**
   * Check if error is a rate limit error
   */
  static isRateLimit(error: unknown): boolean {
    return (
      (error instanceof Error && error.name === 'RateLimitExceeded') ||
      (error instanceof Error && !!error.message && error.message.toLowerCase().includes('rate limit'))
    );
  }

  /**
   * Check if error is recoverable (should retry)
   */
  static isRecoverable(error: unknown): boolean {
    return (
      this.isRateLimit(error) ||
      this.isNetworkError(error) ||
      (error instanceof Error &&
        !!error.message &&
        (error.message.toLowerCase().includes('temporary') || error.message.toLowerCase().includes('try again')))
    );
  }

  /**
   * Log error details for debugging
   */
  static logErrorDetails(error: unknown, operation: string, exchangeId: string, logger: Logger): void {
    const errorProps = getErrorProperties(error);
    const details = {
      errorType: isErrorWithMessage(error) ? error.constructor.name : typeof error,
      exchange: exchangeId,
      message: errorProps.message,
      operation,
      stack: isErrorWithMessage(error) ? error.stack : undefined,
      // Include CCXT-specific details if available
      ...(errorProps.code !== undefined ? { code: errorProps.code } : {}),
      ...(errorProps.status !== undefined ? { status: errorProps.status } : {}),
      ...(errorProps.retryAfter !== undefined ? { retryAfter: errorProps.retryAfter } : {}),
    };

    logger.error(details, 'Detailed error information');
  }
}
