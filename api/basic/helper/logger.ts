import pino from 'pino'
import { LambdaContext, LambdaEvent, lambdaRequestTracker, pinoLambdaDestination } from 'pino-lambda'

const destination = pinoLambdaDestination()
export const logger = pino({
  serializers: {
    err: (e) => `[${e.code || e.constructor.name}] ${e.message}\n${e.stack}`
  }
}, destination)

export const setLoggerWithLambdaRequest = lambdaRequestTracker({
  requestMixin: (event: LambdaEvent, context: LambdaContext) => {
    return {
      source: context.functionName,
      host: event.headers?.host,
      pathParameters: event.pathParameters,
      queryStringParameters: event.queryStringParameters,
      records: event.Records
    }
  }
})
