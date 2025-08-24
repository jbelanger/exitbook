import { isEmpty, omit } from 'moderndash';
import os from 'node:os';
import util from 'node:util';
import { LEVEL, MESSAGE, SPLAT } from 'triple-beam';
import type { LeveledLogMethod, Logger as WinstonLogger } from 'winston';
import winston, { format, transports } from 'winston';
import 'winston-daily-rotate-file';
import { fullFormat } from 'winston-error-format';
import { z } from 'zod';

// see https://github.com/winstonjs/winston?tab=readme-ov-file#using-custom-logging-levels
const logLevels = {
  audit: 0,
  debug: 4,
  error: 1,
  info: 3,
  trace: 5,
  warn: 2,
} as const;

const env = {
  auditLogDirname: z //
    .string()
    .trim()
    .min(1, { message: 'Invalid audit log directory name' })
    .default('logs')
    .parse(process.env.AUDIT_LOG_DIRNAME),
  auditLogEnabled: z //
    .string()
    .default('true')
    .transform((val: string) => val === 'true')
    .parse(process.env.AUDIT_LOG_ENABLED),
  auditLogFilename: z //
    .string()
    .trim()
    .min(1, { message: 'Invalid audit log file name' })
    .default('audit')
    .parse(process.env.AUDIT_LOG_FILENAME),
  logLevel: z //
    .string()
    .refine((val: string) => Object.keys(logLevels).includes(val), {
      message: 'Invalid log level',
    })
    .default('info')
    .parse(process.env.LOG_LEVEL),
} as const;

/**
 * A winston transport for logging messages to the console.
 */
const consoleTransport = new transports.Console();

/**
 * A winston transport for logging messages to a file that is rotated daily.
 */
const dailyRotateFileTransport = new transports.DailyRotateFile({
  //level: 'audit',
  dirname: env.auditLogDirname,
  //format: format.printf((info) => `${info.message}`),
  extension: `_${os.hostname()}.log`,
  filename: env.auditLogFilename,
  utc: true,
});

// Monitor new listener additions
dailyRotateFileTransport.on('newListener', event => {
  const currentCount = dailyRotateFileTransport.listenerCount(event);
  console.log(`New '${event}' listener added (total: ${currentCount + 1})`);
  console.log('Event added by:', new Error().stack);
});

/**
 * Formats a log label string to be a fixed length. When the label string
 * is longer than the specified size, it is truncated and prefixed by a
 * horizontal ellipsis (…).
 */
function formatLabel(label: string, size: number) {
  const str = label.padStart(size);
  return str.length <= size ? str : `…${str.slice(-size + 1)}`;
}

// required so typescript knows about log.audit(..), log.trace(..), etc
type LeveledLogMethods = {
  [level in keyof typeof logLevels]: LeveledLogMethod;
};
type Logger = WinstonLogger & LeveledLogMethods;

/**
 * Returns a logger for the specified logging category.
 */
export const getLogger = (category: string): Logger => {
  if (winston.loggers.has(category)) {
    return winston.loggers.get(category) as Logger;
  }

  const logger = winston.loggers.add(category, {
    format: format.combine(
      format.label({ label: category }),
      format.timestamp(),
      format.splat(),
      fullFormat(),
      format.printf(info => {
        const { label, level, message, timestamp, ...rest } = info;
        let formattedInfo = `${timestamp} ${level.toUpperCase().padStart(7)} --- [${formatLabel(`${label}`, 25)}]: ${message}`;

        if (!isEmpty(rest)) {
          const stripped = omit(rest, [LEVEL, MESSAGE, SPLAT]);
          formattedInfo += ` --- ${util.inspect(stripped, false, null, true)}`;
        }

        return formattedInfo;
      })
    ),
    level: env.logLevel,
    levels: logLevels,
    transports: [consoleTransport],
  });

  // Audit logs are persisted to disk to ensure that we
  // can retain a history record of important system events
  if (env.auditLogEnabled) {
    logger.add(dailyRotateFileTransport);
  }

  return logger as Logger;
};
