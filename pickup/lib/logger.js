import pino from 'pino'

/**
 * Create the logger
 *
 * @type {*|Logger<{serializers: {err: (function(*): string)}, level: (string|string)}>}
 */
export const logger = pino({
  level: process.env.LOG_LEVEL || 'info'
})
