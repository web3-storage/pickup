import { APIGatewayProxyEventV2, Context } from 'aws-lambda'
import { ClusterGetResponseBody, Response, ValidationError } from './schema.js'

import { doAuth, getValidCredentials } from './helper/auth-basic.js'
import { logger, setLoggerWithLambdaRequest } from './helper/logger.js'
import { fetchGetPins } from './helper/fetchers.js'
import {
  validateGetPinsParameters,
  validateRoutingConfiguration
} from './helper/validators.js'
import { sanitizeCid } from './helper/cid.js'
import { toResponseError, toResponseFromString } from './helper/response.js'

/**
 * AWS API Gateway handler for GET /pins/${cid}
 * Collect the params and delegate to getPin to do the work
 *
 * We provide responses in Payload format v2.0
 * see: https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-develop-integrations-lambda.html#http-api-develop-integrations-lambda.proxy-format
 */
export async function handler (event: APIGatewayProxyEventV2, context: Context): Promise<Response> {
  const {
    CLUSTER_BASIC_AUTH_TOKEN: token = getValidCredentials(),
    LEGACY_CLUSTER_IPFS_URL: legacyClusterIpfsUrl = '',
    PICKUP_URL: pickupUrl = '',
    LOG_LEVEL: logLevel = 'info'
  } = process.env

  /* eslint-disable @typescript-eslint/prefer-nullish-coalescing */
  /* eslint-disable @typescript-eslint/strict-boolean-expressions */
  const cids = event.queryStringParameters?.cids
    ? event.queryStringParameters.cids.split(',').map(cid => sanitizeCid(cid))
    : []

  logger.level = logLevel
  context.functionName = 'GET_PINS_ROUTER_LAMBDA'
  setLoggerWithLambdaRequest(event, context)

  logger.info({ code: 'INVOKE' }, 'get pins router invokation')

  /* eslint-disable @typescript-eslint/strict-boolean-expressions */
  if (!doAuth(event.headers.authorization)) {
    logger.error({ code: 'INVALID_AUTH', event }, 'User not authorized on get pins router')
    return toResponseError(401, 'UNAUTHORIZED')
  }

  logger.trace({ cids }, 'Pins requested')

  /* eslint-disable @typescript-eslint/prefer-nullish-coalescing */
  /* eslint-disable @typescript-eslint/strict-boolean-expressions */
  let validationError: ValidationError | undefined = validateRoutingConfiguration({ legacyClusterIpfsUrl, pickupUrl })

  if (validationError != null) {
    logger.error({ err: validationError, code: validationError.code }, 'Validation config error on get pin router')
    return toResponseError(500, 'INTERNAL_SERVER_ERROR')
  }

  validationError = validateGetPinsParameters({ cids: event.queryStringParameters?.cids })

  if (validationError) {
    logger.error({ err: validationError, code: validationError.code }, 'Validation event params error on get pin router')
    return toResponseError(400, 'BAD_REQUEST', validationError.message)
  }

  let cidsNotFoundInPickup: any[] = []
  let cidsFoundInPickup: Record<string, ClusterGetResponseBody> = {}
  try {
    logger.trace('Get from pickup')
    const pickupResponse = await fetchGetPins({ cids, endpoint: pickupUrl, isInternal: true, token })

    logger.trace(pickupResponse, 'Pickup response')

    if (pickupResponse) {
      cidsFoundInPickup = pickupResponse
        .filter(item => (Object.values(item.peer_map).filter(pin => pin.status !== 'unpinned').length > 0))
        .reduce((acc: Record<string, ClusterGetResponseBody>, next) => {
          acc[next.cid] = next
          return acc
        }, {})

      logger.trace(cidsFoundInPickup, 'Cids found in pickup')

      cidsNotFoundInPickup = cids.filter(cid => !cidsFoundInPickup[cid])

      logger.trace(cidsNotFoundInPickup, 'Cids not found in pickup')

      if (cidsNotFoundInPickup.length === 0) {
        logger.info({ code: 'FROM_PICKUP', cids }, 'Get pins from pickup')
        return toResponseFromString(pickupResponse.map(pin => JSON.stringify(pin)).join('\n'))
      }
    }
  } catch (err: any) {
    logger.error({ err, code: 'FROM_PICKUP' }, 'Error on get pins router - pickup')
    cidsNotFoundInPickup = cids
  }

  try {
    const legacyClusterIpfsResponse = await fetchGetPins({
      cids: cidsNotFoundInPickup,
      endpoint: legacyClusterIpfsUrl,
      token
    })

    logger.trace(legacyClusterIpfsResponse, 'Legacy response')

    const cidsFoundInLegacy = legacyClusterIpfsResponse?.reduce((acc: Record<string, ClusterGetResponseBody>, next) => {
      acc[next.cid] = next
      return acc
    }, {})

    logger.trace(cidsFoundInLegacy, 'Found in legacy response')

    const returnContent = cids
      .map(cid => cidsFoundInPickup[cid] ? JSON.stringify(cidsFoundInPickup[cid]) : JSON.stringify(cidsFoundInLegacy[cid]))
      .join('\n')

    logger.info({ code: 'FROM_LEGACY', cids }, 'Get pins from legacy')
    return toResponseFromString(returnContent)
  } catch (err: any) {
    logger.error({ err, code: 'FROM_LEGACY' }, 'Error on get pins router - legacy')
  }

  return toResponseError(500, 'INTERNAL_SERVER_ERROR')
}
