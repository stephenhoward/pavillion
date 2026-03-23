import pino from 'pino';

const isProduction = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';

/**
 * Root pino logger instance.
 *
 * - Production: JSON output to stdout, default level 'info'
 * - Development: Pretty-printed output via pino-pretty, default level 'debug'
 * - Test: Silent by default (level 'silent') to keep test output clean
 *
 * Override with LOG_LEVEL environment variable.
 */
const logger = pino({
  level: process.env.LOG_LEVEL || (isTest ? 'silent' : (isProduction ? 'info' : 'debug')),
  ...(!isProduction && !isTest ? {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
      },
    },
  } : {}),
});

/**
 * Creates a child logger with a domain label.
 * This is a convenience wrapper over pino's child() method.
 *
 * Domain-specific context (entity IDs, etc.) should be added
 * at the call site via logger.child({ eventId }), not here.
 */
export function createLogger(domain: string): pino.Logger {
  return logger.child({ domain });
}

export default logger;
