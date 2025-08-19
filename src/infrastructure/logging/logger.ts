import fs from 'fs';
import path from 'path'; // Only need path, not dirname from path
import winston from 'winston';
import type { LogContext } from '../../core/types/index';

// No __filename or __dirname at top level to avoid conflicts in Jest

export class Logger {
  private winston: winston.Logger;
  private component: string;

  constructor(component: string) {
    this.component = component;

    // Ensure log directory exists
    const logDir = path.join(process.cwd(), 'data', 'logs');
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    this.winston = winston.createLogger({
      level: process.env.LOG_LEVEL || 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
      ),
      defaultMeta: { component },
      transports: [
        // Console output with colors
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.timestamp({ format: 'HH:mm:ss' }),
            winston.format.printf(({ timestamp, level, message, component, ...meta }) => {
              const metaStr = Object.keys(meta).length > 0 ? JSON.stringify(meta, null, 2) : '';
              return `${timestamp} [${component}] ${level}: ${message} ${metaStr}`;
            })
          )
        }),

        // Error log file
        new winston.transports.File({
          filename: path.join(logDir, 'error.log'),
          level: 'error',
          maxsize: 5242880, // 5MB
          maxFiles: 5
        }),

        // Combined log file
        new winston.transports.File({
          filename: path.join(logDir, 'combined.log'),
          maxsize: 10485760, // 10MB
          maxFiles: 10
        }),

        // Balance verification specific log
        new winston.transports.File({
          filename: path.join(logDir, 'balance-verification.log'),
          level: 'info',
          maxsize: 5242880, // 5MB
          maxFiles: 5,
          format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.json(),
            winston.format((info) => {
              // Only log balance-related entries to this file
              return (info.operation && typeof info.operation === 'string' && info.operation.includes('balance')) || info.component === 'BalanceVerifier' ? info : false;
            })()
          )
        }),

        // Import operations log
        new winston.transports.File({
          filename: path.join(logDir, 'import.log'),
          level: 'info',
          maxsize: 5242880, // 5MB
          maxFiles: 5,
          format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.json(),
            winston.format((info) => {
              // Only log import-related entries to this file
              return (info.operation && typeof info.operation === 'string' && info.operation.includes('import')) || info.component === 'TransactionImporter' ? info : false;
            })()
          )
        })
      ]
    });
  }

  info(message: string, context?: LogContext) {
    this.winston.info(message, { ...context, component: this.component });
  }

  warn(message: string, context?: LogContext) {
    this.winston.warn(message, { ...context, component: this.component });
  }

  error(message: string, context?: LogContext) {
    this.winston.error(message, { ...context, component: this.component });
  }

  debug(message: string, context?: LogContext) {
    this.winston.debug(message, { ...context, component: this.component });
  }

  // Specialized logging methods for common operations
  logImportStart(exchange: string, operation: string) {
    this.info(`Starting ${operation} for ${exchange}`, {
      exchange,
      operation: `import_${operation}`,
      timestamp: Date.now()
    });
  }

  logImportComplete(exchange: string, operation: string, count: number, duration: number) {
    this.info(`Completed ${operation} for ${exchange}`, {
      exchange,
      operation: `import_${operation}`,
      count,
      duration,
      timestamp: Date.now()
    });
  }

  logImportError(exchange: string, operation: string, error: Error) {
    this.error(`Failed ${operation} for ${exchange}`, {
      exchange,
      operation: `import_${operation}`,
      error: error.message,
      stack: error.stack,
      timestamp: Date.now()
    });
  }

  logBalanceVerification(exchange: string, currency: string, result: any) {
    const level = result.status === 'mismatch' ? 'warn' : 'info';
    const message = `Balance verification ${result.status} for ${exchange} ${currency}`;

    this.winston.log(level, message, {
      exchange,
      currency,
      operation: 'balance_verification',
      liveBalance: result.liveBalance,
      calculatedBalance: result.calculatedBalance,
      difference: result.difference,
      percentageDiff: result.percentageDiff,
      status: result.status,
      timestamp: Date.now()
    });
  }

  logBalanceDiscrepancy(exchange: string, currency: string, discrepancy: any) {
    this.error(`Significant balance discrepancy detected`, {
      exchange,
      currency,
      operation: 'balance_verification_error',
      ...discrepancy,
      timestamp: Date.now()
    });
  }

  logDuplicateTransaction(transactionId: string, exchange: string) {
    this.debug(`Duplicate transaction skipped`, {
      transactionId,
      exchange,
      operation: 'duplicate_detection',
      timestamp: Date.now()
    });
  }

  // Method to change log level at runtime
  setLogLevel(level: string) {
    this.winston.level = level;
    this.info(`Log level changed to ${level}`);
  }

  // Method to flush logs (useful for testing)
  async flush(): Promise<void> {
    return new Promise((resolve) => {
      this.winston.on('finish', resolve);
      this.winston.end();
    });
  }
} 