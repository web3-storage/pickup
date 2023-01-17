import pino from 'pino'

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  serializers: {
    // eslint-disable-next-line
    err: (e) => `[${e.code || e.constructor.name}] ${e.message}\n${e.stack}`
  }
})
