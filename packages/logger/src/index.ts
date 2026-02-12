export {
  initLogger,
  getLogger,
  flushLoggers,
  type Logger,
  type Sink,
  type LogEntry,
  type LogLevel,
  type LoggerConfig,
} from './logger.js';
export { ConsoleSink } from './sinks/console.js';
export { BufferedSink, type BufferedSinkOptions } from './buffered-sink.js';
