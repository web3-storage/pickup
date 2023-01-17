import pino from 'pino'

export const logger = pino({
  serializers: {
    // eslint-disable-next-line
    err: (e) => `[${e.code || e.constructor.name}] ${e.message}\n${e.stack}`
  }
})
