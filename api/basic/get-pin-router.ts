import { APIGatewayProxyEventV2, Context } from 'aws-lambda'
import { Response } from './schema.js'

import { doAuth, getValidCredentials } from './helper/auth-basic.js'
import { logger, withLambdaRequest } from './helper/logger.js'
import { fetchGetPin } from './helper/fetchers.js'
import {
  validateEventParameters,
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

  logger.info('Get pin request')

  await new Promise(functionTime => setTimeout(functionTime, 40000))

  const authError = doAuth(event.headers.authorization)
  if (authError != null) return authError

  /* eslint-disable @typescript-eslint/strict-boolean-expressions */
  const cid = event.pathParameters?.cid ? sanitizeCid(event.pathParameters.cid) : ''

  /* eslint-disable @typescript-eslint/prefer-nullish-coalescing, @typescript-eslint/strict-boolean-expressions */
  const validationError: Response | undefined =
    validateRoutingConfiguration({
      legacyClusterIpfsUrl,
      pickupUrl
    }) ||
    validateEventParameters({ cid })

  if (validationError != null) {
    return { statusCode: validationError.statusCode, body: JSON.stringify(validationError.body) }
  }

  try {
    const pickupResponse = await fetchGetPin({ cid, endpoint: pickupUrl, isInternal: true, token })

    if (pickupResponse.statusCode === 200 && (Object.values(pickupResponse.body?.peer_map).filter(pin => pin.status !== 'unpinned').length > 0)) {
      return { ...pickupResponse, body: JSON.stringify(pickupResponse.body) }
    }

    const legacyClusterIpfsResponse = await fetchGetPin({ cid, endpoint: legacyClusterIpfsUrl, token })

    return { ...legacyClusterIpfsResponse, body: JSON.stringify(legacyClusterIpfsResponse.body) }
  } catch (error) {
    console.log(error)
    return { statusCode: 500, body: JSON.stringify({ error: { reason: 'INTERNAL_SERVER_ERROR' } }) }
  }
}
