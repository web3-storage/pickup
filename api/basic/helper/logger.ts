import pino from 'pino'
import { LambdaContext, LambdaEvent, lambdaRequestTracker, pinoLambdaDestination } from 'pino-lambda'

const destination = pinoLambdaDestination()
export const logger = pino(destination)

export const withLambdaRequest = lambdaRequestTracker({
  requestMixin: (event: LambdaEvent, _context?: LambdaContext) => {
    const cid = event.pathParameters?.cid ?? ''
    const origins = event.queryStringParameters?.origins?.split(',') ?? []

    return {
      host: event.headers?.host,
      cid,
      // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
      ...(origins.length ? { origins } : {})
    }
  }
})
