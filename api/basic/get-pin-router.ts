import { APIGatewayProxyEventV2, Context } from 'aws-lambda'
import { Response, ValidationError } from './schema.js'

import { doAuth, getValidCredentials } from './helper/auth-basic.js'
import { logger, setLoggerWithLambdaRequest } from './helper/logger.js'
import { fetchGetPin } from './helper/fetchers.js'
import {
  validateEventParameters,
  validateRoutingConfiguration
} from './helper/validators.js'
import { sanitizeCid } from './helper/cid.js'
import { toResponse, toResponseError } from './helper/response.js'

/**
 * AWS API Gateway handler for GET /pins/${cid}
 * Collect the params and delegate to getPin to do the work
 *
 * We provide responses in Payload format v2.0
 * see: https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-develop-integrations-lambda.html#http-api-develop-integrations-lambda.proxy-format
 */
export async function handler(event: APIGatewayProxyEventV2, context: Context): Promise<Response> {
  const {
    CLUSTER_BASIC_AUTH_TOKEN: token = getValidCredentials(),
    LEGACY_CLUSTER_IPFS_URL: legacyClusterIpfsUrl = '',
    PICKUP_URL: pickupUrl = '',
    LOG_LEVEL: logLevel = 'info'
  } = process.env

  /* eslint-disable @typescript-eslint/strict-boolean-expressions */
  const cid = event.pathParameters?.cid ? sanitizeCid(event.pathParameters.cid) : ''

  logger.level = logLevel
  context.functionName = 'GET_PIN_ROUTER_LAMBDA'
  setLoggerWithLambdaRequest(event, context)

  logger.info({ code: 'INVOKE' }, 'get pin router invokation')

  if (!doAuth(event.headers.authorization)) {
    logger.error({ code: 'INVALID_AUTH', event }, 'User not authorized on get pin router')
    return toResponseError(401, 'UNAUTHORIZED')
  }

  /* eslint-disable @typescript-eslint/prefer-nullish-coalescing */
  /* eslint-disable @typescript-eslint/strict-boolean-expressions */
  let validationError: ValidationError | undefined = validateRoutingConfiguration({ legacyClusterIpfsUrl, pickupUrl })

  if (validationError != null) {
    logger.error({ err: validationError, code: validationError.code }, 'Validation config error on get pin router')
    return toResponseError(500, 'INTERNAL_SERVER_ERROR')
  }

  validationError = validateEventParameters({ cid })

  if (validationError) {
    logger.error({ err: validationError, code: validationError.code }, 'Validation event params error on get pin router')
    return toResponseError(400, 'BAD_REQUEST', validationError.message)
  }

  try {
    const pickupResponse = await fetchGetPin({ cid, endpoint: pickupUrl, isInternal: true, token })
    if (pickupResponse && (Object.values(pickupResponse?.peer_map).filter(pin => pin.status !== 'unpinned').length > 0)) {
      logger.info({ code: 'FROM_PICKUP', cid }, 'Get pin from pickup')
      return toResponse(pickupResponse)
    }
  } catch (err: any) {
    logger.error({ err, code: 'FROM_PICKUP' }, 'Error on get pin router - pickup')
  }

  try {
    const legacyClusterIpfsResponse = await fetchGetPin({ cid, endpoint: legacyClusterIpfsUrl, token })
    logger.info({ code: 'FROM_LEGACY', cid }, 'Get pin from legacy')
    return toResponse(legacyClusterIpfsResponse || {})
  } catch (err: any) {
    logger.error({ err, code: 'FROM_LEGACY' }, 'Error on get pin router - legacy')
  }
  return toResponseError(500, 'INTERNAL_SERVER_ERROR')
}
