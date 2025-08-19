// @ts-ignore - CCXT types compatibility
import ccxt from 'ccxt';
import { AuthenticationError, ServiceError, RateLimitError } from '../core/types/index';
import { Logger } from '../infrastructure/logging';


/**
 * Centralized error handling for exchange operations
 * Eliminates duplicate error handling code across adapters
 */
export class ServiceErrorHandler {
  /**
   * Handle errors and convert to appropriate exception types
   */
  static handle(error: any, operation: string, exchangeId: string, logger?: Logger): never {
    if (logger) {
      logger.error(`Exchange operation failed: ${operation}`, {
        exchange: exchangeId,
        error: error instanceof Error ? error.message : 'Unknown error',
        type: error instanceof Error ? error.constructor.name : 'Unknown'
      });
    }

    // Handle CCXT-specific errors
    if (this.isRateLimit(error)) {
      const retryAfter = this.extractRetryAfter(error);
      if (logger) {
        logger.warn(`Rate limit exceeded for ${exchangeId}, should retry after ${retryAfter}ms`);
      }

      throw new RateLimitError(
        `Rate limit exceeded: ${error.message}`,
        exchangeId,
        operation,
        retryAfter
      );
    }

    if (this.isAuthError(error)) {
      throw new AuthenticationError(
        `Authentication failed: ${error.message}`,
        exchangeId,
        operation
      );
    }

    if (this.isNetworkError(error)) {
      throw new ServiceError(
        `Network error: ${error.message}`,
        exchangeId,
        operation,
        error
      );
    }

    if (this.isNotSupported(error)) {
      // For unsupported operations, we'll log it but create a specific error
      if (logger) {
        logger.warn(`Operation not supported: ${operation}`, {
          exchange: exchangeId,
          error: error.message
        });
      }
      throw new ServiceError(
        `Operation not supported: ${error.message}`,
        exchangeId,
        operation,
        error
      );
    }

    // Re-throw if it's already one of our custom errors
    if (error instanceof ServiceError ||
      error instanceof RateLimitError ||
      error instanceof AuthenticationError) {
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
   * Check if error is a rate limit error
   */
  static isRateLimit(error: any): boolean {
    return error instanceof ccxt.RateLimitExceeded ||
      error.name === 'RateLimitExceeded' ||
      (error.message && error.message.toLowerCase().includes('rate limit'));
  }

  /**
   * Check if error is an authentication error
   */
  static isAuthError(error: any): boolean {
    return error instanceof ccxt.AuthenticationError ||
      error.name === 'AuthenticationError' ||
      (error.message && (
        error.message.toLowerCase().includes('authentication') ||
        error.message.toLowerCase().includes('unauthorized') ||
        error.message.toLowerCase().includes('invalid api') ||
        error.message.toLowerCase().includes('api key')
      ));
  }

  /**
   * Check if error is a network error
   */
  static isNetworkError(error: any): boolean {
    return error instanceof ccxt.NetworkError ||
      error.name === 'NetworkError' ||
      (error.message && (
        error.message.toLowerCase().includes('network') ||
        error.message.toLowerCase().includes('timeout') ||
        error.message.toLowerCase().includes('connection')
      ));
  }

  /**
   * Check if error indicates operation is not supported
   */
  static isNotSupported(error: any): boolean {
    return error instanceof ccxt.NotSupported ||
      error.name === 'NotSupported' ||
      (error.message && (
        error.message.toLowerCase().includes('not supported') ||
        error.message.toLowerCase().includes('not implemented')
      ));
  }

  /**
   * Extract retry after value from rate limit error
   */
  static extractRetryAfter(error: any): number {
    // Try to get retry after from CCXT error
    if (error.retryAfter && typeof error.retryAfter === 'number') {
      return error.retryAfter;
    }

    // Try to extract from error message
    const retryMatch = error.message?.match(/retry.{0,10}(\d+)/i);
    if (retryMatch) {
      return parseInt(retryMatch[1]) * 1000; // Convert to milliseconds
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
   * Log error details for debugging
   */
  static logErrorDetails(error: any, operation: string, exchangeId: string, logger: Logger): void {
    const details = {
      operation,
      exchange: exchangeId,
      errorType: error.constructor.name,
      message: error.message,
      stack: error.stack,
      // Include CCXT-specific details if available
      ...(error.code && { code: error.code }),
      ...(error.status && { status: error.status }),
      ...(error.retryAfter && { retryAfter: error.retryAfter })
    };

    logger.error('Detailed error information', details);
  }

  /**
   * Check if error is recoverable (should retry)
   */
  static isRecoverable(error: any): boolean {
    return this.isRateLimit(error) ||
      this.isNetworkError(error) ||
      (error.message && (
        error.message.toLowerCase().includes('temporary') ||
        error.message.toLowerCase().includes('try again')
      ));
  }
}