import { APIGatewayProxyEventV2, Context } from 'aws-lambda'
import { ClusterStatusResponse, Response } from './schema.js'

import { doAuth, getValidCredentials } from './helper/auth-basic.js'
import { logger, withLambdaRequest } from './helper/logger.js'
import { fetchGetPins } from './helper/fetchers.js'
import {
  validateGetPinsParameters,
  validateRoutingConfiguration
} from './helper/validators.js'
import { sanitizeCid } from './helper/cid.js'

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

  logger.level = logLevel
  withLambdaRequest(event, context)

  logger.info('Get pins request')

  const authError = doAuth(event.headers.authorization)
  if (authError != null) return authError

  /* eslint-disable @typescript-eslint/prefer-nullish-coalescing, @typescript-eslint/strict-boolean-expressions */
  const validationError: Response | undefined =
    validateRoutingConfiguration({
      legacyClusterIpfsUrl,
      pickupUrl
    }) ||
    validateGetPinsParameters({ cids: event.queryStringParameters?.cids || '' })

  if (validationError != null) {
    return { statusCode: validationError.statusCode, body: JSON.stringify(validationError.body) }
  }

  logger.trace('Parameters are valid')

  try {
    /* eslint-disable @typescript-eslint/prefer-nullish-coalescing */
    /* eslint-disable @typescript-eslint/strict-boolean-expressions */
    const cids = event.queryStringParameters?.cids
      ? event.queryStringParameters.cids.split(',').map(cid => sanitizeCid(cid))
      : []

    logger.trace('Get from pickup')
    const pickupResponse = await fetchGetPins({ cids, endpoint: pickupUrl, isInternal: true, token })

    logger.trace(pickupResponse, 'Pickup response')

    const foundInPickup = pickupResponse.body?.filter(item => (Object.values(item.peer_map).filter(pin => pin.status !== 'unpinned').length > 0)).reduce((acc: Record<string, ClusterStatusResponse>, next) => {
      acc[next.cid] = next
      return acc
    }, {})

    logger.trace(foundInPickup, 'Found in pickup')

    const cidNotFound = pickupResponse.body?.filter(item =>
      (Object.values(item.peer_map)
        .filter(pin => pin.status !== 'unpinned').length === 0)
    ).map(item => item.cid)

    logger.trace(cidNotFound, 'Cid not found in pickup')

    if (!cidNotFound.length && pickupResponse.body.length === cids.length) {
      return {
        statusCode: 200,
        body: pickupResponse.body.map(pin => JSON.stringify(pin)).join('\n')
      }
    }

    const legacyClusterIpfsResponse = await fetchGetPins({
      cids: cidNotFound,
      endpoint: legacyClusterIpfsUrl,
      token
    })

    logger.trace(legacyClusterIpfsResponse, 'Legacy response')

    const foundInLegacy = legacyClusterIpfsResponse.body?.reduce((acc: Record<string, ClusterStatusResponse>, next) => {
      acc[next.cid] = next
      return acc
    }, {})

    logger.trace(foundInLegacy, 'Found in legacy response')

    const returnContent = cids.map(cid =>
      (foundInPickup[cid] && (Object.values(foundInPickup[cid].peer_map)
        .filter(pin => pin.status !== 'unpinned').length > 0))
        ? foundInPickup[cid]
        : foundInLegacy[cid]
    ).map(pin => JSON.stringify(pin)).join('\n')

    return {
      statusCode: 200,
      body: returnContent
    }
  } catch (error) {
    logger.error(error)
    return { statusCode: 500, body: JSON.stringify({ error: { reason: 'INTERNAL_SERVER_ERROR' } }) }
  }
}
